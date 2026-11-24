import { field } from './client'
import { Form, Input, Notes } from './forms'
import type { Fulfilment, FulfilmentEvent } from './bunker-fulfilment'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (cents: number) => usd.format(cents / 100)
const amount = (data: FormData) => Math.round(Number(field(data, 'amount')) * 100)
const date = (value: number) => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const labels: Record<string, string> = {
  nominate: 'Nomination recorded', delay: 'Supplier reported a delay', cancelProposal: 'Cancellation proposed', cancelDecision: 'Cancellation reviewed', voidInvoice: 'Supplier voided invoice', report: 'Supplier reported delivery', deliveryReview: 'Buyer reviewed delivery',
  invoice: 'Supplier recorded invoice', pay: 'Buyer reported payment', receipt: 'Supplier reviewed payment',
}

export function BunkerSettlement({ record, events, buyer, allowed, canCancel, apply }: {
  record: Fulfilment
  events: FulfilmentEvent[]
  buyer: boolean
  allowed: boolean
  canCancel: boolean
  apply: (data: Record<string, unknown>) => Promise<void>
}) {
  const f = record
  const canAct = allowed && f.closed_at === null && f.cancelled_at === null && !f.cancellation_side
  const openCancellation = canCancel && f.closed_at === null && f.cancelled_at === null && !f.delivery_state
  const proposedByMe = f.cancellation_side === (buyer ? 'buyer' : 'supplier')
  const balance = (f.invoice_cents ?? 0) - f.confirmed_cents
  const formKey = f.revision
  return <section>
    <h3>{f.cancelled_at ? 'Order cancelled by agreement' : f.closed_at ? 'Order closed' : 'Delivery and settlement'}</h3>
    {f.cancelled_at && <p>Cancellation accepted {date(f.cancelled_at)} · {f.cancellation_note}</p>}
    {f.cancellation_side && <div className="notice"><b>Cancellation proposed by {f.cancellation_side}</b><p>{f.cancellation_note}</p></div>}
    {openCancellation && (f.cancellation_side ?
      <Form submit={proposedByMe ? 'Retract cancellation proposal' : 'Save cancellation decision'} onSubmit={data =>
        apply({step:'cancelDecision',result:proposedByMe?'retract':field(data,'resolution'),note:field(data,'note')})
      }>
        {!proposedByMe && <label>Cancellation decision<select name="resolution" defaultValue="" required>
          <option value="">Choose a decision</option><option value="accept">Accept cancellation</option><option value="decline">Keep order open</option>
        </select></label>}
        <Notes label="Cancellation decision details" name="note" maxLength={1200} />
      </Form> :
      <details><summary>Propose cancellation</summary><Form submit="Send cancellation proposal" onSubmit={data =>
        apply({step:'cancelProposal',note:field(data,'note')})
      }>
        <Notes label="Reason and agreed cancellation terms" name="note" maxLength={1200} />
        <p>The other party must accept. Confirm any contractual charges outside Teder before agreeing.</p>
      </Form></details>)}
    {f.nomination && <p>Nomination · {f.nomination}{f.nomination_eta && ' · ETA ' + date(f.nomination_eta)}</p>}
    {f.delay_note && <p className="notice"><b>Delivery delayed</b> · {f.delay_note}</p>}
    {canAct && !buyer && !f.delivery_state &&
      <Form key={'nomination' + formKey} submit={f.nomination ? 'Update nomination' : 'Record nomination'} onSubmit={data =>
        apply({ step: 'nominate', reference: field(data,'reference'), eta:field(data,'eta') ? Date.parse(field(data,'eta')+'Z') : undefined })
      }><Input label="Supplier nomination reference" name="reference" maxLength={300} defaultValue={f.nomination ?? ''} />
        <Input label="Expected delivery · UTC" name="eta" type="datetime-local" required={false} defaultValue={f.nomination_eta ? new Date(f.nomination_eta).toISOString().slice(0,16) : ''} />
      </Form>}
    {canAct && !buyer && f.nomination && !f.delivery_state && <details><summary>Notify buyer of a delay</summary>
      <Form submit="Report delivery delay" onSubmit={data => apply({step:'delay',note:field(data,'note')})}>
        <Notes label="Delay reason and expected next update" name="note" maxLength={1200} />
      </Form>
    </details>}
    {canAct && !buyer && f.nomination && !f.delay_note && (!f.delivery_state || f.delivery_state === 'disputed') &&
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
    {canAct && !buyer && f.invoice_ref && f.confirmed_cents === 0 && f.payment_state !== 'reported' &&
      <details><summary>Correct supplier invoice</summary><Form submit="Void invoice" onSubmit={data => apply({step:'voidInvoice',note:field(data,'note')})}>
        <Notes label="Reason for voiding the invoice" name="note" maxLength={1200} />
      </Form></details>}
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
