import { field } from './client'
import { Form, Input, Notes } from './forms'
import type { Fulfilment, FulfilmentEvent } from './bunker-fulfilment'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (cents: number) => usd.format(cents / 100)
const amount = (data: FormData) => Math.round(Number(field(data, 'amount')) * 100)
const date = (value: number) => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const labels: Record<string, string> = {
  nominate: 'Nomination recorded', report: 'Supplier reported delivery', deliveryReview: 'Buyer reviewed delivery',
  invoice: 'Supplier recorded invoice', pay: 'Buyer reported payment', receipt: 'Supplier reviewed payment',
}

export function BunkerSettlement({ record, events, buyer, allowed, apply }: {
  record: Fulfilment
  events: FulfilmentEvent[]
  buyer: boolean
  allowed: boolean
  apply: (data: Record<string, unknown>) => Promise<void>
}) {
  const f = record
  const canAct = allowed && f.closed_at === null
  const balance = (f.invoice_cents ?? 0) - f.confirmed_cents
  const formKey = f.revision
  return <section>
    <h3>{f.closed_at ? 'Order closed' : 'Delivery and settlement'}</h3>
    {f.nomination && <p>Nomination · {f.nomination}</p>}
    {canAct && !buyer && !f.delivery_state &&
      <Form key={'nomination' + formKey} submit={f.nomination ? 'Update nomination' : 'Record nomination'} onSubmit={data =>
        apply({ step: 'nominate', reference: field(data,'reference') })
      }><Input label="Supplier nomination reference" name="reference" maxLength={300} defaultValue={f.nomination ?? ''} /></Form>}
    {canAct && !buyer && f.nomination && (!f.delivery_state || f.delivery_state === 'disputed') &&
      <Form key={'report' + formKey} submit={f.delivery_ref ? 'Submit corrected delivery' : 'Report delivery'} onSubmit={data =>
        apply({ step: 'report', delivery: field(data,'delivery'), meter: field(data,'meter'), quality: field(data,'quality'),
          kg: Math.round(Number(field(data,'tonnes')) * 1000) })
      }>
        <Input label="Delivered tonnes" name="tonnes" type="number" min="0" max="50000" step=".001" />
        <Input label="Supplier delivery note reference" name="delivery" maxLength={300} />
        <Input label="Quantity evidence reference" name="meter" maxLength={300} />
        <Input label="Quality evidence reference" name="quality" maxLength={300} />
      </Form>}
    {f.delivery_ref && <div className="notice">
      <p>Delivery {f.delivery_state} · {(f.delivered_kg ?? 0) / 1000} tonnes</p>
      <p>References · {f.delivery_ref} · {f.meter_ref} · {f.quality_ref}</p>
      {f.delivery_note && <p>{f.delivery_note}</p>}
    </div>}
    {canAct && buyer && f.delivery_state === 'reported' &&
      <Form submit="Save delivery decision" onSubmit={data => apply({ step:'deliveryReview', result:field(data,'result'), note:field(data,'note') })}>
        <label>Delivery decision<select required name="result"><option value="">Choose a decision</option><option value="accepted">Accept delivery</option><option value="disputed">Dispute delivery</option></select></label>
        <Notes label="Decision and reason" name="note" maxLength={1200} />
      </Form>}
    {canAct && !buyer && f.delivery_state === 'accepted' && !f.invoice_ref &&
      <Form submit="Record supplier invoice" onSubmit={data => apply({ step:'invoice', reference:field(data,'invoice'), amount:amount(data),
        dueAt:Date.parse(field(data,'due') + 'T23:59:59Z') })}>
        <Input label="Supplier invoice number" name="invoice" maxLength={300} />
        <Input label="Invoice amount · USD" name="amount" type="number" min=".01" step=".01" />
        <Input label="Payment due date · UTC" name="due" type="date" />
      </Form>}
    {f.invoice_ref && <div className="notice">
      <p>Invoice {f.invoice_ref} · {money(f.invoice_cents ?? 0)} · Due {date(f.due_at ?? 0)}</p>
      <p>Confirmed received {money(f.confirmed_cents)} · Balance {money(balance)}</p>
      <p>Buyer and supplier arrange payment directly. This workspace records their confirmations.</p>
      {f.payment_ref && <p>Payment {f.payment_state} · {money(f.payment_cents ?? 0)} · {f.payment_ref}</p>}
      {f.payment_note && <p>{f.payment_note}</p>}
    </div>}
    {canAct && buyer && balance > 0 && f.payment_state !== 'reported' &&
      <Form key={'payment' + formKey} submit="Report bank payment" onSubmit={data => apply({ step:'pay', reference:field(data,'payment'), amount:amount(data) })}>
        <Input label="Bank payment reference" name="payment" maxLength={300} />
        <Input label="Amount sent · USD" name="amount" type="number" min=".01" max={balance / 100} step=".01" />
      </Form>}
    {canAct && !buyer && f.payment_state === 'reported' &&
      <Form submit="Save payment decision" onSubmit={data => apply({ step:'receipt', result:field(data,'result'), note:field(data,'note') })}>
        <label>Receipt decision<select required name="result"><option value="">Choose a decision</option><option value="received">Confirm funds received</option><option value="disputed">Report discrepancy</option></select></label>
        <Notes label="Receipt note or discrepancy" name="note" maxLength={1200} />
      </Form>}
    {f.closed_at && <p>Closed {date(f.closed_at)} after delivery acceptance and receipt of the full invoice amount.</p>}
    {events.length > 0 && <details><summary>Order history</summary><ul className="records">{events.map(event =>
      <li key={event.revision}><b>{labels[event.event] ?? event.event}</b> · {date(event.created_at)}<p>{event.details}</p></li>
    )}</ul></details>}
  </section>
}
