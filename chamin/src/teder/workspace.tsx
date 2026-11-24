import { useEffect, useState } from 'react'
import { call, field, localTime, time } from './client'
import type { User } from './client'
import { Copy, Form, Input, Notes } from './forms'
import { findRegistry, jurisdictionName } from './registries'
import { sources } from './products'

type BuyRequest = { id: string; buyer_id: string; buyer_name: string; seller_name: string; point: string; requirements: string; kw: number; start_at: number; end_at: number; closes_at: number; deal_id: string | null; tender_id: string | null; source: keyof typeof sources | null; tender_closed: number; supplier_count: number }
type Offer = { id: string; revision: number; kind: string; price_cents: number; terms: string; expires_at: number }
type Deal = { id: string; offer_id: string; agreement_ref: string | null; buyer_signed_at: number | null; seller_signed_at: number | null; schedule_ref: string | null; scheduler_name: string | null; current_delivery_id: string | null; delivery_status: string | null; review_note: string | null; settlement_ref: string | null }
type Delivery = { id: string; measured_wh: number; issuer: string; evidence_ref: string; reported_at: number; readings_wh: string | null }
type Comparison = { request_id: string; seller_name: string; seller_status: string; offer_id: string | null; price_cents: number | null; kind: string | null; expires_at: number | null; terms: string | null; deal_id: string | null }
type Supplier = { id: string; name: string; country: string | null }
type TeamData = { members: { username: string; role: string }[]; invites: { invite_id: string; role: string; expires_at: number }[]; seatLimit: number }
type Detail = { comparison: Comparison[]; request: BuyRequest; deal: Deal | null; offers: Offer[]; deliveries: Delivery[]; events: { id: string; kind: string; detail: string; occurred_at: number }[] }
type Company = { id: string; name: string; registration: string; country: string | null; registry_region: string | null; registry_number: string | null; issuing_registry: string | null; application_id: string; contact_email: string; registry_reference: string; authority_reference: string }
type Application = { contact_email: string; registry_reference: string; authority_reference: string; submitted_at: number; decision: string | null; decision_note: string | null }
function quantity(r: BuyRequest) { return r.kw * (r.end_at - r.start_at) / 3600000 / 1000 }
const decimal = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 6 })
const price = new Intl.NumberFormat('en-SG', { currency: 'SGD', style: 'currency' })
function heading(text: string) { return text.replace(/_/g, ' ') }

export function Workspace({ user, path }: { user: User; path: string }) {
  if (path === '/workspace/team') return <Team user={user} />
  if (path === '/workspace/review') return <Review user={user} />
  if (path.startsWith('/workspace/requests/')) return <RequestDetail user={user} requestId={path.split('/')[3]} />
  return <Overview user={user} />
}

function Overview({ user }: { user: User }) {
  const [requests, setRequests] = useState<BuyRequest[] | null>(null)
  const [error, setError] = useState('')
  const [create, setCreate] = useState(false)
  useEffect(() => {
    call<{ requests: BuyRequest[] }>('overview').then(data => setRequests(data.requests)).catch(err => setError(err.message))
  }, [])
  const canTrade = user.status === 'approved' && ['owner','trader'].includes(user.role)
  const buyerTenders = new Set<string>()
  const visibleRequests = requests?.filter(request => {
    if (!request.tender_id || request.buyer_id !== user.company_id) return true
    if (buyerTenders.has(request.tender_id)) return false
    buyerTenders.add(request.tender_id)
    return true
  })
  return <section className="workspace">
    <div className="section-head"><div><span className="eyebrow">Power trading / Singapore pilot</span><h1>{user.company_name}</h1></div>
      {canTrade && <button type="button" onClick={() => setCreate(!create)}>{create ? 'Close request form' : 'New supply request'}</button>}</div>
    <div className="notice"><strong>{user.status === 'approved' ? 'Company approved' : user.status === 'rejected' ? 'Trading access declined' : 'Company review pending'}</strong>
      <p>{user.status === 'approved' ? 'Invite suppliers to quote on the same delivery requirement.' : 'A reviewer needs to confirm your company and trading authority before you can submit offers or open requests.'}</p></div>
    {user.workspace_kind === 'customer' && user.status !== 'approved' && <CompanyApplication user={user} />}
    {create && <CreateTender />}
    <h2>Private requests and deals</h2>
    {error ? <p role="alert" className="error">{error}</p> : !requests ? <p role="status">Loading requests…</p> :
      requests.length === 0 ? <div className="empty"><strong>No requests yet</strong><p>{canTrade ? 'Create a supply request or ask a buyer to invite your company.' : 'Requests will appear when an approved buyer invites your company.'}</p></div> :
      <ul className="records">{visibleRequests?.map(r => <li key={r.id}><a href={'/workspace/requests/' + r.id}>
        <strong>{r.point}</strong><span>{r.buyer_id === user.company_id ? r.supplier_count > 1 ? r.supplier_count + ' invited suppliers' : 'Buying from ' + r.seller_name : 'Selling to ' + r.buyer_name}</span>
        <span>{decimal.format(quantity(r))} MWh · {time(r.start_at)}</span><b>{r.deal_id ? 'Deal' : r.tender_closed ? 'Award completed' : r.closes_at < Date.now() ? 'Closed' : 'Open request'}</b>
      </a></li>)}</ul>}
  </section>
}

function CreateTender() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    call<{ suppliers: Supplier[] }>('suppliers').then(result => setSuppliers(result.suppliers)).catch(err => setError(err.message))
  }, [])
  return <section className="boxed"><h2>New supply request</h2>
    {error ? <p className="error" role="alert">{error}</p> : suppliers === null ? <p role="status">Loading suppliers…</p> : !suppliers.length ?
      <p>No other approved companies are available in the pilot yet.</p> :
      <Form submit="Send private request" disabled={!selected.length} onSubmit={async data => {
        const result = await call<{ requestId: string }>('request', {
          supplierIds: selected, source: field(data, 'source'), point: field(data, 'point'), kw: Number(field(data, 'kw')),
          requirements: field(data, 'requirements'), startAt: localTime(field(data, 'start')),
          endAt: localTime(field(data, 'end')), closesAt: localTime(field(data, 'close')),
        })
        location.assign('/workspace/requests/' + result.requestId)
      }}>
        <fieldset className="supplier-picker"><legend>Invite suppliers</legend>
          <p>Choose up to ten approved companies. Each supplier sees only its own conversation.</p>
          {suppliers.map(supplier => <label className="check" key={supplier.id}>
            <input type="checkbox" checked={selected.includes(supplier.id)} disabled={selected.length === 10 && !selected.includes(supplier.id)}
              onChange={event => {
                const checked = event.target.checked
                setSelected(current => checked ? [...current, supplier.id] : current.filter(value => value !== supplier.id))
              }} />{supplier.name}{supplier.country && ' · ' + (findRegistry(supplier.country)?.name ?? supplier.country)}
          </label>)}
        </fieldset>
        <div className="pair"><Input label="Grid delivery point" name="point" maxLength={120} />
          <label>Requested generation source<select name="source">{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="pair"><Input label="Delivery starts · Singapore time" type="datetime-local" name="start" step={1800} /><Input label="Delivery ends · Singapore time" type="datetime-local" name="end" step={1800} /></div>
        <div className="pair"><Input label="Offer deadline · Singapore time" name="close" type="datetime-local" /><Input label="Committed power · kW" name="kw" type="number" min={1} max={1000000} /></div>
        <Notes label="Supply and shortfall requirements" name="requirements" />
      </Form>}
  </section>
}

function Team({ user }: { user: User }) {
  const [link, setLink] = useState('')
  const [data, setData] = useState<TeamData | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setData(await call<TeamData>('team')) }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [])
  const used = (data?.members.length ?? 0) + (data?.invites.length ?? 0)
  return <section className="workspace"><span className="eyebrow">{user.company_name}</span><h1>Company access</h1>
    <dl><dt>Username</dt><dd>{user.username}</dd><dt>Workspace role</dt><dd>{user.role}</dd><dt>Trading access</dt><dd>{user.status}</dd></dl>
    {error && <p className="error" role="alert">{error}</p>}
    {data && <section className="boxed"><h2>Team seats</h2><p>{data.members.length} of {data.seatLimit} seats occupied{user.role === 'owner' && ' · ' + data.invites.length + ' reserved by invitations'}</p>
      <ul className="records team-records">{data.members.map(member => <li key={member.username}><strong>{member.username}</strong><span>{member.role}</span></li>)}</ul>
      {data.invites.length > 0 && <><h3>Outstanding invitations</h3><ul className="records team-records">{data.invites.map(invite =>
        <li key={invite.invite_id}><span>{invite.role} · expires {time(invite.expires_at)}</span><Form submit="Revoke invitation" onSubmit={async () => {
          await call('revokeInvite', { inviteId: invite.invite_id })
          setLink('')
          await refresh()
        }}><span className="sr-only">Invitation for a {invite.role}</span></Form></li>)}</ul></>}
    </section>}
    {user.role === 'owner' && user.workspace_kind === 'customer' && data && <section className="boxed"><h2>Invite a teammate</h2><p>{used >= data.seatLimit ? 'All five seats are occupied or reserved. Revoke an unused invitation to make its seat available.' : 'Each person gets their own account. Share the single-use link privately. It expires in 24 hours.'}</p>
      <Form submit="Create invitation" disabled={used >= data.seatLimit} onSubmit={async form => {
        setLink((await call<{ link: string }>('invite', { role: field(form, 'role') })).link)
        await refresh()
      }}>
        <label>Role<select name="role"><option value="trader">Trader · requests and offers</option><option value="operator">Operator · delivery records</option><option value="viewer">Viewer · read access</option></select></label>
      </Form>{link && <><p className="code">{link}</p><Copy value={link}>Copy invitation link</Copy></>}</section>}
  </section>
}

function CompanyApplication({ user }: { user: User }) {
  const [history, setHistory] = useState<Application[] | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setHistory((await call<{ applications: Application[] }>('companyApplication')).applications) }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [])
  const recent = history?.[0]
  const submit = user.role === 'owner' && user.status !== 'approved' && !!history && (!recent || recent.decision === 'rejected')
  return <section className="boxed">
    <h2>Company verification</h2>
    {error && <p className="error" role="alert">{error}</p>}
    {recent && <p role="status">{recent.decision === 'rejected' ? 'Changes required' : recent.decision === 'approved' ? 'Approved' : 'Under review'}</p>}
    {!!history?.length && <details open={recent?.decision === 'rejected'}><summary>Application history</summary>
      <ul className="records">{history.map((application,index) => <li key={application.submitted_at + ':' + index}>
        <b>{application.decision ?? 'Pending'}</b> · {time(application.submitted_at)}
        {application.decision_note && <p>{application.decision_note}</p>}
      </li>)}</ul>
    </details>}
    {submit && <Form submit={recent ? 'Resubmit for review' : 'Submit for review'} onSubmit={async data => {
      await call('submitCompanyApplication',{ email:field(data,'email'), registry:field(data,'registry'), authority:field(data,'authority') })
      await refresh()
    }}>
      <p>Provide the registry record and how Teder can independently confirm your authority to act for this company.</p>
      <Input label="Business contact email" name="email" type="email" maxLength={254} defaultValue={recent?.contact_email} />
      <Input label="Registry record reference or URL" name="registry" maxLength={500} defaultValue={recent?.registry_reference} />
      <Input label="Evidence of your authority to represent the company" name="authority" maxLength={500} defaultValue={recent?.authority_reference} />
    </Form>}
  </section>
}

function Review({ user }: { user: User }) {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setCompanies((await call<{ companies: Company[] }>('reviewList')).companies) }
  useEffect(() => { if (user.reviewer) refresh().catch(err => setError(err.message)) }, [user.reviewer])
  if (!user.reviewer) return <section className="workspace"><h1>Reviewer access required</h1><a href="/workspace">Back to workspace</a></section>
  return <section className="workspace"><span className="eyebrow">Trading access</span><h1>Company reviews</h1>
    <p>Independently confirm legal identity and representative authority. Record the reason for your decision. Port and supplier eligibility are managed separately.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {companies?.length === 0 && <p>No companies to review.</p>}
    {companies?.map(c => <section key={c.id} className="boxed"><h2>{c.name}</h2><p>{c.country ? jurisdictionName(c.country) + (c.issuing_registry || c.registry_region ? ' · ' + (c.issuing_registry ?? c.registry_region) : '') : 'Registry not recorded'} · {c.registry_number ?? c.registration}</p>
      <dl><dt>Business email</dt><dd>{c.contact_email}</dd><dt>Registry evidence</dt><dd>{c.registry_reference}</dd><dt>Authority evidence</dt><dd>{c.authority_reference}</dd></dl>
      <Form submit="Save review" onSubmit={async data => { await call('review', { companyId: c.id, applicationId: c.application_id, result: field(data, 'result'), note: field(data, 'note') }); await refresh() }}>
        <label>Decision<select name="result" required defaultValue=""><option value="">Choose a decision</option><option value="approved">Approve trading</option><option value="rejected">Decline trading</option></select></label>
        <Notes label="Review evidence or reason" name="note" maxLength={500} />
      </Form></section>)}
  </section>
}

function RequestDetail({ user, requestId }: { user: User; requestId: string }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setData(await call<Detail>('detail', { requestId })) }
  useEffect(() => { refresh().catch(err => setError(err.message)) }, [requestId])
  if (!data) return <section className="workspace"><a href="/workspace">← Requests</a><p role={error ? 'alert' : 'status'}>{error || 'Loading request…'}</p></section>
  const { request: r, deal, offers, comparison } = data
  const latest = offers[0] as Offer | undefined
  const buyer = r.buyer_id === user.company_id
  const canTrade = user.status === 'approved' && ['owner','trader'].includes(user.role)
  const owner = user.status === 'approved' && user.role === 'owner'
  const canOperate = user.status === 'approved' && ['owner','operator'].includes(user.role)
  const open = !deal && !r.tender_closed && r.closes_at > Date.now()
  async function act(action: string, args: Record<string, unknown>) { await call(action, args); await refresh() }
  return <section className="workspace">
    <a href="/workspace">← Requests</a>
    <div className="section-head"><div><span className="eyebrow">{r.buyer_name} → {r.seller_name}</span><h1>{r.point}</h1></div><span className="status">{deal ? 'Deal' : open ? 'Open request' : r.tender_closed ? 'Award completed' : 'Closed'}</span></div>
    <div className="delivery-band"><div><strong>{decimal.format(r.kw / 1000)} MW</strong><span>Committed power</span></div><div><strong>{decimal.format(quantity(r))} MWh</strong><span>Contract window volume</span></div></div>
    <p>{time(r.start_at)} → {time(r.end_at)}</p>{r.source && <p>Requested source · {sources[r.source]}</p>}<p>{r.requirements}</p><small>Offer deadline {time(r.closes_at)}</small>
    {buyer && comparison.length > 1 && <section><h2>Compare supplier replies</h2><div className="offer-comparison">
      {comparison.map(item => <article key={item.request_id} aria-current={item.request_id === requestId}>
        <h3>{item.seller_name}</h3>
        <p><b>{item.deal_id ? 'Selected offer' : item.seller_status !== 'approved' ? 'Supplier unavailable' : item.kind ? heading(item.kind) : 'Awaiting offer'}</b></p>
        {item.price_cents !== null && <p>{price.format(item.price_cents / 100)} / MWh</p>}
        {item.terms && <p>{item.terms}</p>}
        {item.expires_at && <p><small>{item.expires_at < Date.now() ? 'Expired' : 'Valid until ' + time(item.expires_at)}</small></p>}
        {item.request_id !== requestId && <a href={'/workspace/requests/' + item.request_id}>{item.deal_id ? 'Open selected deal' : 'Open negotiation'}</a>}
      </article>)}
    </div></section>}
    <h2>{buyer && comparison.length > 1 ? 'Negotiation with ' + r.seller_name : 'Offer history'}</h2>
    {offers.length === 0 && <p className="empty">No offers submitted yet.</p>}
    <ul className="records offers">{offers.map((o, i) => <li key={o.id}>
      <strong>Version {o.revision} · {heading(o.kind)}</strong><span>{price.format(o.price_cents / 100)} / MWh</span><p>{o.terms}</p>
      <small>{deal?.offer_id === o.id ? 'Selected · ' : i > 0 ? 'Superseded · ' : o.expires_at < Date.now() ? 'Expired · ' : ''}Valid until {time(o.expires_at)}</small>
    </li>)}</ul>
    {canTrade && open && (!buyer || latest) && <section className="boxed"><h2>{buyer ? 'Counteroffer' : 'Submit an offer'}</h2>
      <Form key={latest?.revision ?? 0} submit={buyer ? 'Send counteroffer' : 'Send offer'} onSubmit={async d => act('offer', {
        requestId, expected: latest?.revision ?? 0, kind: buyer ? 'counter' : field(d, 'kind'),
        priceCents: Math.round(Number(field(d, 'price')) * 100), expiresAt: localTime(field(d, 'expiry')), terms: field(d, 'terms')
      })}>
        {!buyer && <label>Offer type<select name="kind"><option value="firm">Firm · eligible to be selected</option><option value="indicative">Indicative · price information only</option></select></label>}
        <div className="pair"><Input label="Price · SGD per MWh" name="price" type="number" min=".01" step=".01" /><Input label="Offer expires · Singapore time" type="datetime-local" name="expiry" /></div>
        <Notes label="Supply, credit and shortfall terms" name="terms" />
      </Form></section>}
    {owner && buyer && open && latest?.kind === 'firm' && latest.expires_at > Date.now() &&
      <Form submit={'Select firm offer v' + latest.revision} onSubmit={() => act('award', { offerId: latest.id })}><label className="check"><input required type="checkbox" /> I reviewed the terms of this specific offer.</label></Form>}
    {deal && <DealView data={data} deal={deal} buyer={buyer} owner={owner} canOperate={canOperate} act={act} />}
  </section>
}

function DealView({ data, deal: d, buyer, owner, canOperate, act }: { data: Detail; deal: Deal; buyer: boolean; owner: boolean; canOperate: boolean; act: (action: string, params: Record<string, unknown>) => Promise<void> }) {
  const contracted = Boolean(d.buyer_signed_at && d.seller_signed_at)
  const current = data.deliveries.find(x => x.id === d.current_delivery_id)
  const difference = current ? Math.round(quantity(data.request) * 1e6) - current.measured_wh : 0
  const intervalCount = (data.request.end_at - data.request.start_at) / 1800000
  const scheduledWh = data.request.kw * 500
  const readings: number[] | null = current?.readings_wh ? JSON.parse(current.readings_wh) : null
  const shortIntervals = readings?.filter(wh => wh < scheduledWh).length ?? 0
  return <section className="deal-section">
    <div className="section-head"><h2>Deal record</h2><button type="button" className="secondary" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'teder-deal-' + d.id + '.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>Download deal record</button></div>
    <ol className="steps">
      <li><b>Agreement</b><span>{contracted ? 'Both companies acknowledged' : 'Awaiting signed agreement'}</span></li>
      <li><b>Schedule</b><span>{d.schedule_ref ? 'Partner reference recorded' : 'Awaiting schedule'}</span></li>
      <li><b>Delivery</b><span>{d.delivery_status === 'reported' ? 'Supplier reported' : d.delivery_status ? heading(d.delivery_status) : 'Awaiting delivery report'}</span></li>
      <li><b>Settlement</b><span>{d.settlement_ref ? 'Reference recorded' : 'Awaiting external settlement'}</span></li>
    </ol>
    {d.agreement_ref && <p>Agreement reference: {d.agreement_ref}</p>}
    {d.schedule_ref && <p>Schedule: {d.scheduler_name} · {d.schedule_ref}</p>}
    {d.settlement_ref && <p>External settlement: {d.settlement_ref}</p>}
    {owner && !(buyer ? d.buyer_signed_at : d.seller_signed_at) && <Form submit="Confirm signed agreement" onSubmit={f => act('sign', { dealId: d.id, reference: field(f, 'reference'), attested: f.has('attested') })}>
      <Input label="Signed agreement reference" name="reference" defaultValue={d.agreement_ref ?? ''} maxLength={300} /><label className="check"><input required type="checkbox" name="attested" /> My company has signed the referenced agreement outside Teder.</label>
    </Form>}
    {canOperate && !buyer && contracted && !current && <Form submit={d.schedule_ref ? 'Update schedule reference' : 'Record external schedule'} onSubmit={f => act('schedule', { dealId: d.id, reference: field(f, 'reference'), issuer: field(f, 'issuer') })}>
      <div className="pair"><Input label="Scheduling partner" name="issuer" maxLength={120} /><Input label="Schedule confirmation reference" name="reference" maxLength={300} /></div>
    </Form>}
    {d.schedule_ref && !buyer && canOperate && !d.settlement_ref && Date.now() >= data.request.end_at && (!current || d.delivery_status === 'disputed') &&
      <Form submit={current ? 'Report corrected delivery' : 'Record delivery'} onSubmit={f => {
        const intervals = field(f, 'intervals').trim()
        const entries = intervals ? intervals.split(/[\s,]+/) : []
        if (entries.length && (entries.length !== intervalCount || entries.some(value => !/^\d{1,10}(?:\.\d{1,3})?$/.test(value)))) {
          throw new Error('Enter one non-negative kWh reading per half-hour, with up to three decimal places.')
        }
        const readingsWh = entries.length ? entries.map(value => Math.round(Number(value) * 1000)) : undefined
        return act('delivery', { dealId: d.id, previous: current?.id ?? null, reference: field(f, 'reference'),
          issuer: field(f, 'issuer'), wh: Math.round(Number(field(f, 'mwh')) * 1e6), readingsWh })
      }}>
        <div className="pair"><Input label="Meter or settlement record issuer" name="issuer" maxLength={120} /><Input label="External delivery evidence reference" name="reference" maxLength={300} /></div>
        <Input label="Delivered amount · MWh" name="mwh" type="number" min={0} step=".000001" />
        <label>Half-hour readings · kWh (optional)<textarea name="intervals" rows={3} maxLength={21599} aria-describedby="interval-note" /></label>
        <small id="interval-note">Paste {intervalCount} readings in schedule order, separated by commas or new lines. Start at {time(data.request.start_at)}. The readings must match the total above.</small>
      </Form>}
    {current && <div className="notice"><strong>{decimal.format(current.measured_wh / 1e6)} MWh · Supplier reported</strong>
      <p>{difference > 0 ? decimal.format(difference / 1e6) + ' MWh shortfall' : difference < 0 ? decimal.format(-difference / 1e6) + ' MWh above contract' : 'Matches contracted amount'} · {current.issuer} · {current.evidence_ref}</p>
      {readings ? <details><summary>{shortIntervals ? shortIntervals + ' intervals below the scheduled amount' : 'All intervals met the scheduled amount'}</summary>
        <div className="interval-table"><table><thead><tr><th scope="col">Interval start</th><th scope="col">Scheduled kWh</th><th scope="col">Reported kWh</th></tr></thead>
          <tbody>{readings.map((wh, index) => <tr key={index}><th scope="row">{time(data.request.start_at + index * 1800000)}</th>
            <td>{decimal.format(scheduledWh / 1000)}</td><td>{decimal.format(wh / 1000)}{wh < scheduledWh && ' · Short'}</td></tr>)}</tbody>
        </table></div>
      </details> : <p>Window total only. Individual intervals have no reported readings.</p>}
      {d.review_note && <p>{d.review_note}</p>}</div>}
    {current && buyer && canOperate && d.delivery_status === 'reported' && <Form submit="Save delivery review" onSubmit={f => act('deliveryReview', { dealId: d.id, deliveryId: current.id, result: field(f, 'result'), note: field(f, 'note') })}>
      <label>Review outcome<select name="result" defaultValue={difference || shortIntervals ? 'disputed' : 'reconciled'}><option value="disputed">Open a dispute</option><option value="reconciled">Reconcile under the agreement</option></select></label>
      <Notes label="Resolution or reason for dispute" name="note" maxLength={1200} />
    </Form>}
    {buyer && canOperate && d.delivery_status === 'reconciled' && !d.settlement_ref &&
      <Form submit="Record external settlement" onSubmit={f => act('settlement', { dealId: d.id, reference: field(f, 'reference') })}><Input label="External settlement reference" name="reference" maxLength={300} /></Form>}
    <h3>Activity</h3>
    <ul className="records">{data.events.map(e => <li key={e.id}><strong>{e.kind}</strong><span>{time(e.occurred_at)}</span><p>{e.detail}</p></li>)}</ul>
  </section>
}
