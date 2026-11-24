import { z } from 'zod'

const reference = z.string().trim().min(1).max(300)
const reason = z.string().trim().min(1).max(1200)
const cents = z.number().int().positive().max(100000000000)
const command = z.discriminatedUnion('step', [
  z.object({ step: z.literal('nominate'), reference }),
  z.object({ step: z.literal('report'), delivery: reference, meter: reference, quality: reference, kg: z.number().int().nonnegative().max(50000000) }),
  z.object({ step: z.literal('deliveryReview'), result: z.enum(['disputed','accepted']), note: reason }),
  z.object({ step: z.literal('invoice'), reference, amount: cents, dueAt: z.number().int().max(4102444800000) }),
  z.object({ step: z.literal('pay'), reference, amount: cents }),
  z.object({ step: z.literal('receipt'), result: z.enum(['disputed','received']), note: reason }),
])
const update = z.object({ orderId: z.uuid(), revision: z.number().int().nonnegative(), change: command })

export type Fulfilment = {
  order_id: string
  revision: number
  nomination: string | null
  delivery_ref: string | null
  meter_ref: string | null
  quality_ref: string | null
  delivered_kg: number | null
  delivery_state: 'reported' | 'disputed' | 'accepted' | null
  delivery_note: string | null
  invoice_ref: string | null
  invoice_cents: number | null
  due_at: number | null
  confirmed_cents: number
  payment_ref: string | null
  payment_cents: number | null
  payment_state: 'reported' | 'disputed' | 'received' | null
  payment_note: string | null
  closed_at: number | null
}
export type FulfilmentEvent = { revision: number; event: string; details: string; created_at: number }

function conflict() {
  return Response.json({ error: 'This action is unavailable for the current order state. Refresh and review the outstanding step.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } })
}

export async function applyBunkerFulfilment(
  db: D1Database,
  user: { id: string; company_id: string },
  payload: unknown,
  now: number,
) {
  const { orderId, revision, change } = update.parse(payload)
  const current = await db.prepare(`SELECT f.*,e.buyer_company_id,q.supplier_id
    FROM bunker_fulfilment f JOIN bunker_orders o ON o.id=f.order_id
    JOIN bunker_enquiries e ON e.id=o.enquiry_id JOIN bunker_quotes q ON q.id=o.quote_id
    WHERE o.id=? AND (e.buyer_company_id=? OR q.supplier_id=?)`)
    .bind(orderId, user.company_id, user.company_id)
    .first<Fulfilment & { buyer_company_id: string; supplier_id: string }>()
  if (!current) return Response.json({ error: 'Order not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  if (current.revision !== revision || current.closed_at !== null) return conflict()
  const buyer = current.buyer_company_id === user.company_id
  let fields: Partial<Fulfilment>
  let detail: string
  switch (change.step) {
    case 'nominate':
      if (buyer || current.delivery_state) return conflict()
      fields = { nomination: change.reference }
      detail = change.reference
      break
    case 'report':
      if (buyer || !current.nomination || (current.delivery_state && current.delivery_state !== 'disputed')) return conflict()
      fields = {
        delivery_ref: change.delivery, meter_ref: change.meter, quality_ref: change.quality,
        delivered_kg: change.kg, delivery_state: 'reported', delivery_note: null,
      }
      detail = `${change.kg} kg · delivery note ${change.delivery} · meter ${change.meter} · quality ${change.quality}`
      break
    case 'deliveryReview':
      if (!buyer || current.delivery_state !== 'reported') return conflict()
      fields = { delivery_state: change.result, delivery_note: change.note }
      detail = `${change.result} · ${change.note}`
      break
    case 'invoice':
      if (buyer || current.delivery_state !== 'accepted' || current.invoice_ref || change.dueAt < now) return conflict()
      fields = { invoice_ref: change.reference, invoice_cents: change.amount, due_at: change.dueAt }
      detail = `${change.reference} · ${change.amount} USD cents`
      break
    case 'pay': {
      const remaining = (current.invoice_cents ?? 0) - current.confirmed_cents
      if (!buyer || current.delivery_state !== 'accepted' || current.payment_state === 'reported' || change.amount > remaining) return conflict()
      const known = await db.prepare('SELECT 1 FROM bunker_received_payments WHERE order_id=? AND reference=?')
        .bind(orderId, change.reference).first()
      if (known) return conflict()
      fields = { payment_ref: change.reference, payment_cents: change.amount, payment_state: 'reported', payment_note: null }
      detail = `${change.reference} · ${change.amount} USD cents reported`
      break
    }
    case 'receipt': {
      if (buyer || current.payment_state !== 'reported' || current.payment_cents === null) return conflict()
      fields = { payment_state: change.result, payment_note: change.note }
      if (change.result === 'received') {
        fields.confirmed_cents = current.confirmed_cents + current.payment_cents
        if (fields.confirmed_cents === current.invoice_cents && current.delivery_state === 'accepted') fields.closed_at = now
      }
      detail = `${change.result} · ${current.payment_ref} · ${current.payment_cents} USD cents · ${change.note}`
      break
    }
  }
  const entries = Object.entries(fields)
  const [result] = await db.batch([
    db.prepare(`UPDATE bunker_fulfilment SET ${entries.map(([column]) => column + '=?').join(',')}, revision=revision+1
      WHERE order_id=? AND revision=? AND closed_at IS NULL AND EXISTS (
        SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND c.id=?
        AND u.disabled_at IS NULL AND u.role IN ('owner','operator') AND c.status='approved')`)
      .bind(...entries.map(([, value]) => value), orderId, revision, user.id, user.company_id),
    db.prepare(`INSERT INTO bunker_fulfilment_events (order_id, revision, actor_id, event, details, created_at)
      SELECT ?,?,?,?,?,? WHERE changes()=1`).bind(orderId, revision + 1, user.id, change.step, detail, now),
  ])
  if (!result.meta.changes) return conflict()
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
