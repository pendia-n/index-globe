import { useEffect, useState } from 'react'
import { call, field } from './client'
import type { User } from './client'
import { Copy, Form, Input } from './forms'
import { BunkerFeePanel } from './bunker-fee-panel'
import { BunkerDocumentPanel } from './bunker-document-panel'
import { BunkerSettlement } from './bunker-settlement'
import type { Fulfilment, FulfilmentEvent } from './bunker-fulfilment'

type Port = { code: string; name: string; time_zone: string; active: number }
type Enquiry = {
  id: string; company_name: string; work_email: string | null; port: string; grade: string
  quantity_kg: number; arrival_at: number; end_at: number; buyer_company_id: string | null; declined_at: number | null; assigned_by: string | null
}
const statuses = {
  checking: 'Checking coverage',
  assigned: 'Assigned to your company workspace',
  declined: 'Unable to support this request',
}
export function BunkerIntake() {
  const [ports, setPorts] = useState<Port[]>([])
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const [status, setStatus] = useState<keyof typeof statuses | null>(null)
  const [requestKey, setRequestKey] = useState('')
  useEffect(() => {
    setRequestKey(crypto.randomUUID())
    call<{ ports: Port[] }>('bunkerPorts').then(result => setPorts(result.ports)).catch(err => setError(err.message))
  }, [])
  return <section className="auth-panel">
    <h1>Request marine fuel</h1>
    <p>Send your delivery requirements. Teder checks availability before any offer or order is confirmed.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {receipt ? <div className="notice">
      <strong>Request received</strong><p>Save this receipt to check progress.</p>
      <code className="code">{receipt}</code><Copy value={receipt}>Copy receipt</Copy>
    </div> : <Form submit="Submit bunker request" disabled={!requestKey || !ports.length} onSubmit={async data => {
      const result = await call<{ receipt: string }>('bunkerSubmit', {
        requestKey, company: field(data, 'company'), email: field(data, 'email'), port: field(data, 'port'),
        grade: field(data, 'grade'), quantityKg: Math.round(Number(field(data, 'tonnes')) * 1000),
        arrivalAt: Date.parse(field(data, 'arrival') + 'Z'), endAt: Date.parse(field(data, 'end') + 'Z'),
      })
      setReceipt(result.receipt)
    }}>
      <Input label="Legal company name" name="company" autoComplete="organization" maxLength={120} />
      <Input label="Work email" name="email" type="email" autoComplete="email" maxLength={254} />
      <label>Delivery port<select name="port" required defaultValue="">
        <option value="">Choose a port</option>
        {ports.map(port => <option value={port.code} key={port.code}>{port.name}{port.active ? '' : ' · coverage enquiry'}</option>)}
      </select></label>
      <label>Fuel grade<select name="grade"><option value="VLSFO">VLSFO</option><option value="MGO">Marine gas oil</option></select></label>
      <Input label="Metric tonnes" name="tonnes" type="number" min=".001" max="50000" step=".001" />
      <div className="pair">
        <Input label="Delivery starts · UTC" name="arrival" type="datetime-local" />
        <Input label="Delivery ends · UTC" name="end" type="datetime-local" />
      </div>
    </Form>}
    <h2>Check a request</h2>
    <Form submit="Check status" onSubmit={async data => {
      setStatus(null)
      const result = await call<{ status: keyof typeof statuses }>('bunkerTrack', { receipt: field(data, 'receipt').trim() })
      setStatus(result.status)
    }}>
      <Input label="Receipt" name="receipt" defaultValue={receipt} key={receipt} maxLength={36} />
    </Form>
    {status && <p role="status">{statuses[status]}{status === 'assigned' && <> · <a href="/workspace/bunkers">Open workspace</a></>}</p>}
  </section>
}

export function BunkerEnquiries({ user }: { user: User }) {
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null)
  const [error, setError] = useState('')
  async function refresh() {
    const result = await call<{ enquiries: Enquiry[] }>('bunkerEnquiries')
    setEnquiries(result.enquiries)
  }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [])
  return <section className="workspace">
    <h1>{user.bunker_operator ? 'Bunker enquiries' : 'Marine fuel requests'}</h1>
    <p><a href="/bunker">Submit or track a request</a></p>
    {user.bunker_operator && <PortOperations />}
    {error && <p role="alert" className="error">{error}</p>}
    {!error && enquiries === null && <p role="status">Loading requests…</p>}
    {enquiries?.length === 0 && <p>There are no requests here yet.</p>}
    {enquiries?.map(enquiry => <article className="boxed" key={enquiry.id}>
      <h2>{enquiry.port} · {enquiry.grade} · {enquiry.quantity_kg / 1000} t</h2>
      <p>{enquiry.company_name}{enquiry.work_email && ' · ' + enquiry.work_email}</p>
      <p>{new Date(enquiry.arrival_at).toISOString()} to {new Date(enquiry.end_at).toISOString()}</p>
      <p>{statuses[enquiry.declined_at ? 'declined' : enquiry.buyer_company_id ? 'assigned' : 'checking']}</p>
      {enquiry.buyer_company_id === user.company_id || (user.bunker_operator && enquiry.buyer_company_id && enquiry.assigned_by === user.id) || (!user.bunker_operator && !enquiry.declined_at) ?
        <p><a href={'/workspace/bunkers/' + enquiry.id}>Open fuel request</a></p> : null}
      {user.bunker_operator && !enquiry.buyer_company_id && !enquiry.declined_at && <>
        <Form submit="Assign to buyer workspace" onSubmit={async data => {
          await call('bunkerAssign', { enquiryId: enquiry.id, buyer: field(data, 'buyer') })
          await refresh()
        }}><Input label="Buyer workspace owner’s username" name="buyer" maxLength={32} /></Form>
        <Form submit="Decline request" onSubmit={async () => {
          await call('bunkerDecline', { enquiryId: enquiry.id })
          await refresh()
        }}><label className="check"><input type="checkbox" required /> Confirm this request cannot be supported.</label></Form>
      </>}
    </article>)}
  </section>
}

type Quote = { id: string; supplier_id: string; revision: number; kind: string; price_cents_per_tonne: number; extras_cents: number; terms: string; expires_at: number }
type Supplier = { id: string; name: string }
type Detail = {
  enquiry: { grade: string; port: string; active: number; quantity_kg: number; arrival_at: number; end_at: number; vessel: string | null; imo: string | null; specification: string | null }
  buyer: boolean
  coordinator: boolean
  broker: boolean
  assignment: { broker_company_id: string; name: string } | null
  brokerCandidates: Supplier[]
  brokerActivity: { event: string; note: string; occurred_at: number }[]
  eligible: Supplier[]
  invitations: { supplier_id: string; name: string }[]
  quotes: Quote[]
  fulfilments: Fulfilment[]
  fulfilmentEvents: (FulfilmentEvent & { order_id: string })[]
  orders: { id: string; quote_id: string; status: string; response_reference: string | null }[]
}
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const displayTime = (date: number) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC'

export function BunkerTender({ user, id }: { user: User; id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setDetail(await call<Detail>('bunkerDetail', { enquiryId: id })) }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [id])
  async function act(action: string, data: Record<string, unknown>) {
    await call(action, { enquiryId: id, ...data })
    await refresh()
  }
  if (!detail) return <p role={error ? 'alert' : 'status'}>{error || 'Loading fuel request…'}</p>
  const { enquiry, buyer, coordinator, broker, assignment, brokerCandidates, brokerActivity, invitations, quotes, orders, fulfilments, fulfilmentEvents } = detail
  const open = !orders.some(order => ['confirmed', 'selected'].includes(order.status)) && enquiry.arrival_at > Date.now()
  const approved = !coordinator && user.status === 'approved' && ['owner','trader'].includes(user.role)
  const remaining = detail.eligible.filter(s => !invitations.some(i => i.supplier_id === s.id))
  return <section className="workspace">
    <a href="/workspace/bunkers">Marine fuel requests</a>
    <h1>{enquiry.port} · {enquiry.grade}</h1>
    <p>{enquiry.quantity_kg / 1000} metric tonnes · {displayTime(enquiry.arrival_at)} to {displayTime(enquiry.end_at)}</p>
    <p>{enquiry.vessel ? `${enquiry.vessel} · IMO ${enquiry.imo}` : 'Vessel details pending'}</p>
    <p>{enquiry.specification}</p>
    {!enquiry.active && <p role="status">This port is currently accepting coverage enquiries. Offers require an active route.</p>}
    {!approved && !coordinator && <p>Company trading approval is required to take action on this request.</p>}
    {(buyer || broker) && <section className="boxed">
      <h2>Broker coordination</h2>
      <p>{assignment ? 'Assigned broker · ' + assignment.name : 'No broker is assigned.'}</p>
      {buyer && approved && user.role === 'owner' && (assignment ?
        <Form submit="Revoke broker access" onSubmit={data => act('bunkerRevokeBroker',{note:field(data,'reason')})}>
          <Input label="Reason for revoking access" name="reason" maxLength={600} />
        </Form> : brokerCandidates.length > 0 && <Form submit="Appoint broker" onSubmit={data =>
          act('bunkerAppointBroker',{brokerId:field(data,'broker'),note:field(data,'mandate')})}>
          <label>Eligible broker<select name="broker">{brokerCandidates.map(candidate =>
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          <Input label="Buyer mandate and scope" name="mandate" maxLength={600} />
        </Form>)}
      {assignment && user.status === 'approved' && ['owner','trader','operator'].includes(user.role) &&
        <Form submit="Add coordination note" onSubmit={data => act('bunkerBrokerNote',{note:field(data,'note')})}>
          <Input label="Note for buyer and broker" name="note" maxLength={1000} />
        </Form>}
      {brokerActivity.length > 0 && <details><summary>Broker activity</summary><ul className="records">{brokerActivity.map((event,index) =>
        <li key={event.occurred_at + ':' + index}><strong>{event.event}</strong> · {displayTime(event.occurred_at)}<p>{event.note}</p></li>
      )}</ul></details>}
    </section>}
    {(buyer || broker) && approved && !invitations.length && open && <Form submit="Save vessel and terms" onSubmit={data => act('bunkerPrepare', {
      vessel: field(data,'vessel'), imo: field(data,'imo'), specification: field(data,'specification'),
    })}>
      <Input label="Vessel name" name="vessel" maxLength={120} defaultValue={enquiry.vessel ?? ''} />
      <Input label="IMO number" name="imo" pattern="[0-9]{7}" inputMode="numeric" defaultValue={enquiry.imo ?? ''} />
      <Input label="Fuel specification, quantity tolerance and delivery instructions" name="specification" maxLength={1700} defaultValue={enquiry.specification ?? ''} />
    </Form>}
    {(buyer || broker) && approved && enquiry.vessel && enquiry.active && open && (remaining.length ? <Form submit="Invite supplier" onSubmit={data =>
      act('bunkerInvite', { supplierId: field(data,'supplier') })
    }><label>Eligible supplier<select name="supplier" required>{remaining.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></Form> :
      <p>There are no additional eligible suppliers for this port.</p>)}
    {invitations.map(invitation => {
      const versions = quotes.filter(quote => quote.supplier_id === invitation.supplier_id)
      const latest = versions[0]
      return <article className="boxed" key={invitation.supplier_id}>
        <h2>{invitation.name}</h2>
        {versions.length === 0 && <p>Awaiting a quote</p>}
        {versions.map(quote => <div key={quote.id}>
          <h3>Revision {quote.revision} · {quote.kind}</h3>
          <p>{usd.format(quote.price_cents_per_tonne / 100)} per tonne · extras {usd.format(quote.extras_cents / 100)}</p>
          <p>Estimated total {usd.format((quote.price_cents_per_tonne * enquiry.quantity_kg / 1000 + quote.extras_cents) / 100)} · Valid through {displayTime(quote.expires_at)}</p>
          <p>{quote.terms}</p>
        </div>)}
        {approved && !broker && enquiry.active && open && (!buyer || latest) && <Form key={latest?.id} submit={buyer ? 'Send counteroffer' : 'Submit quote'} onSubmit={data => act('bunkerQuote', {
          supplierId: invitation.supplier_id, revision: latest?.revision ?? 0, kind: buyer ? 'counter' : field(data,'kind'),
          price: Math.round(Number(field(data,'price')) * 100), extras: Math.round(Number(field(data,'extras')) * 100),
          terms: field(data,'terms'), expiresAt: Date.parse(field(data,'expiry') + 'Z'),
        })}>
          {!buyer && <label>Quote type<select name="kind"><option value="indicative">Indicative</option><option value="firm">Firm</option></select></label>}
          <Input label="Delivered price per tonne · USD" name="price" type="number" min=".01" step=".01" />
          <Input label="Additional charges · USD" name="extras" type="number" min="0" step=".01" defaultValue="0" />
          <Input label="Valid until · UTC" name="expiry" type="datetime-local" />
          <Input label="Payment terms and operational conditions" name="terms" maxLength={1700} />
        </Form>}
        {buyer && approved && open && enquiry.active && user.role === 'owner' && latest?.kind === 'firm' && latest.expires_at > Date.now() &&
          <Form submit="Select firm offer" onSubmit={() => act('bunkerSelect', { quoteId: latest.id })}>
            <label className="check"><input type="checkbox" required /> I have checked the delivered price, credit terms, and delivery conditions.</label>
          </Form>}
      </article>
    })}
    {orders.map(order => {
      const settlement = fulfilments.find(f => f.order_id === order.id)
      return <article className="boxed" key={order.id}>
      <h2>Order · {order.status}</h2>
      <p>{order.response_reference}</p>
      {order.status === 'selected' && approved && !broker && user.role === 'owner' && <Form submit={buyer ? 'Withdraw selection' : 'Record supplier decision'} onSubmit={data =>
        act('bunkerRespond',{ orderId: order.id, result: buyer ? 'withdrawn' : field(data,'result'), reference: field(data,'reference') })
      }>
        {!buyer && <label>Supplier decision<select name="result" required><option value="">Choose a decision</option><option value="confirmed">Confirm order</option><option value="declined">Decline order</option></select></label>}
        <Input label={buyer ? 'Reason for withdrawal' : 'Confirmation reference or reason for decline'} name="reference" maxLength={300} />
      </Form>}
      {settlement && !coordinator && <BunkerDocumentPanel orderId={order.id} buyer={buyer}
        canUpload={user.status === 'approved' && ['owner','operator'].includes(user.role)} />}
      {settlement && <BunkerSettlement record={settlement} events={fulfilmentEvents.filter(event => event.order_id === order.id)}
        buyer={buyer} allowed={!coordinator && user.status === 'approved' && ['owner','operator'].includes(user.role)}
        apply={change => act('bunkerFulfil', { orderId: order.id, revision: settlement.revision, change })} />}
      {settlement && <BunkerFeePanel key={settlement.revision} orderId={order.id}
        canReport={!coordinator && ['owner','operator'].includes(user.role)} />}
    </article>})}
  </section>
}


function PortOperations() {
  const [ports, setPorts] = useState<Port[]>([])
  const [message, setMessage] = useState('')
  async function refresh() { setPorts((await call<{ ports: Port[] }>('bunkerPorts')).ports) }
  useEffect(() => { refresh().catch(err => setMessage(err.message)) }, [])
  if (!ports.length) return message ? <p role="alert">{message}</p> : null
  const options = ports.map(p => <option key={p.code} value={p.code}>{p.name} · {p.active ? 'active' : 'coverage enquiries'}</option>)
  return <section className="boxed">
    <h2>Port coverage</h2>
    <Form submit="Save port status" onSubmit={async fields => {
      await call('bunkerCoverage', { port: field(fields,'port'), enabled: field(fields,'state') === 'active' })
      setMessage('Port status saved.')
      await refresh()
    }}>
      <label>Port<select name="port">{options}</select></label>
      <label>Availability<select name="state"><option value="enquiry">Coverage enquiries only</option><option value="active">Enable requests for quotes</option></select></label>
    </Form>
    <Form submit="Save supplier eligibility" onSubmit={async fields => {
      await call('bunkerApproveSupplier', { port: field(fields,'port'), supplier: field(fields,'supplier'),
        licence: field(fields,'licence'), validUntil: Date.parse(field(fields,'expiry') + 'T23:59:59Z') })
      setMessage('Supplier eligibility saved.')
    }}>
      <label>Supplier port<select name="port">{options}</select></label>
      <Input label="Supplier workspace owner username" name="supplier" maxLength={32} />
      <Input label="Verified supplier licence reference" name="licence" maxLength={200} />
      <Input label="Licence valid until · UTC" name="expiry" type="date" />
    </Form>
    <Form submit="Save broker eligibility" onSubmit={async fields => {
      await call('bunkerApproveBroker',{ port: field(fields,'port'), broker:field(fields,'broker'), authority:field(fields,'authority'),
        validUntil:Date.parse(field(fields,'expiry') + 'T23:59:59Z') })
      setMessage('Broker eligibility saved.')
    }}>
      <label>Broker port<select name="port">{options}</select></label>
      <Input label="Broker workspace owner username" name="broker" maxLength={32} />
      <Input label="Verified authority reference" name="authority" maxLength={300} />
      <Input label="Broker authority valid until · UTC" name="expiry" type="date" />
    </Form>
    {message && <p role="status">{message}</p>}
  </section>
}
