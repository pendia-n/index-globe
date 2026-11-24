import { z } from 'zod'

const reference = z.string().trim().min(1).max(300)
const order = z.object({ orderId: z.uuid() })
const headers = { 'Cache-Control': 'private, no-store' }

export async function bunkerFees(
  db: D1Database,
  user: { id: string; company_id: string; bunker_operator: number },
  action: string,
  body: unknown,
  now: number,
) {
  const { orderId } = order.parse(body)
  const access = await db.prepare(`SELECT e.buyer_company_id,q.supplier_id,f.closed_at,
    CASE WHEN e.assigned_by=? AND EXISTS (
      SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL) THEN 1 ELSE 0 END coordinator
    FROM bunker_orders o JOIN bunker_enquiries e ON e.id=o.enquiry_id JOIN bunker_quotes q ON q.id=o.quote_id
    JOIN bunker_fulfilment f ON f.order_id=o.id WHERE o.id=?`).bind(user.id,user.id,orderId)
    .first<{ buyer_company_id: string; supplier_id: string; closed_at: number|null; coordinator: number }>()
  const operator = !!user.bunker_operator && !!access?.coordinator
  const parties = [access?.buyer_company_id, access?.supplier_id]
  if (!access || (!operator && !parties.includes(user.company_id))) {
    return Response.json({ error:'Order not found.' }, {status:404,headers})
  }
  if (action === 'bunkerFee') {
    const fee = await db.prepare(`SELECT o.invoice_ref,o.amount_cents,o.issued_at,o.payment_ref,o.reported_at,o.received_at
      FROM bunker_service_fees o WHERE order_id=? AND (payer_company_id=? OR ?=1)`)
      .bind(orderId,user.company_id,Number(operator)).first()
    return Response.json({ fee, operator, closed: access.closed_at !== null }, {headers})
  }
  if (action === 'bunkerFeeIssue' || action === 'bunkerFeeReceive') {
    if (!operator) return Response.json({ error:'The assigned Teder operator handles service billing.' },{status:403,headers})
  }
  let mutation: D1PreparedStatement
  const liveOperator = 'EXISTS(SELECT 1 FROM bunker_operators WHERE user_id=? AND revoked_at IS NULL)'
  if (action === 'bunkerFeeIssue') {
    const input = z.object({ payer:z.enum(['buyer','supplier']), reference, amount:z.number().int().positive().max(10000000000) }).parse(body)
    mutation = db.prepare(`INSERT INTO bunker_service_fees (order_id,payer_company_id,invoice_ref,amount_cents,issued_at,issued_by)
      SELECT f.order_id,?,?,?,?,? FROM bunker_fulfilment f WHERE f.order_id=? AND f.closed_at IS NOT NULL
      AND ${liveOperator} ON CONFLICT DO NOTHING`)
      .bind(input.payer==='buyer'?access.buyer_company_id:access.supplier_id,input.reference,input.amount,now,user.id,orderId,user.id)
  } else if (action === 'bunkerFeeReport') {
    const input = z.object({ reference }).parse(body)
    mutation = db.prepare(`UPDATE bunker_service_fees SET payment_ref=?,reported_at=?,reported_by=?
      WHERE order_id=? AND payer_company_id=? AND received_at IS NULL
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND company_id=? AND disabled_at IS NULL AND role IN ('owner','operator'))`)
      .bind(input.reference,now,user.id,orderId,user.company_id,user.id,user.company_id)
  } else {
    const input = z.object({ reference }).parse(body)
    mutation = db.prepare(`UPDATE bunker_service_fees SET received_by=?,received_at=?
      WHERE order_id=? AND payment_ref=? AND received_at IS NULL AND ${liveOperator}`)
      .bind(user.id,now,orderId,input.reference,user.id)
  }
  if (!(await mutation.run()).meta.changes) {
    return Response.json({ error:'Service fee action unavailable. Refresh and check the invoice or payment reference.' },{status:409,headers})
  }
  return Response.json({ok:true},{headers})
}
