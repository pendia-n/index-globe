import { useEffect, useState } from 'react'
import { call, field } from './client'
import type { User } from './client'
import { Copy, Form, Input } from './forms'

type Port = { code: string; name: string; time_zone: string; active: number }
type Enquiry = {
  id: string; company_name: string; work_email: string | null; port: string; grade: string
  quantity_kg: number; arrival_at: number; end_at: number; buyer_company_id: string | null; declined_at: number | null
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
    {error && <p role="alert" className="error">{error}</p>}
    {!error && enquiries === null && <p role="status">Loading requests…</p>}
    {enquiries?.length === 0 && <p>There are no requests here yet.</p>}
    {enquiries?.map(enquiry => <article className="boxed" key={enquiry.id}>
      <h2>{enquiry.port} · {enquiry.grade} · {enquiry.quantity_kg / 1000} t</h2>
      <p>{enquiry.company_name}{enquiry.work_email && ' · ' + enquiry.work_email}</p>
      <p>{new Date(enquiry.arrival_at).toISOString()} to {new Date(enquiry.end_at).toISOString()}</p>
      <p>{statuses[enquiry.declined_at ? 'declined' : enquiry.buyer_company_id ? 'assigned' : 'checking']}</p>
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
