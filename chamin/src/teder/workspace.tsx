import { useEffect, useState } from 'react'
import { call, field, localTime, time } from './client'
import type { User } from './client'
import { Copy, Form, Input, Notes } from './forms'

type BuyRequest = { id: string; buyer_id: string; buyer_name: string; seller_name: string; point: string; requirements: string; kw: number; start_at: number; end_at: number; closes_at: number; deal_id: string | null }
type Offer = { id: string; revision: number; kind: string; price_cents: number; terms: string; expires_at: number }
type Deal = { id: string; offer_id: string; agreement_ref: string | null; buyer_signed_at: number | null; seller_signed_at: number | null; schedule_ref: string | null; scheduler_name: string | null; current_delivery_id: string | null; delivery_status: string | null; review_note: string | null; settlement_ref: string | null }
type Delivery = { id: string; measured_wh: number; issuer: string; evidence_ref: string; reported_at: number }
type Detail = { request: BuyRequest; deal: Deal | null; offers: Offer[]; deliveries: Delivery[]; events: { id: string; kind: string; detail: string; occurred_at: number }[] }
type Company = { id: string; name: string; registration: string; status: string; review_note: string | null }
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
  return <section className="workspace">
    <div className="section-head"><div><span className="eyebrow">Power trading / Singapore pilot</span><h1>{user.company_name}</h1></div>
      {canTrade && <button type="button" onClick={() => setCreate(!create)}>{create ? 'Close request form' : 'New supply request'}</button>}</div>
    <div className="notice"><strong>{user.status === 'approved' ? 'Company approved' : user.status === 'rejected' ? 'Trading access declined' : 'Company review pending'}</strong>
      <p>{user.status === 'approved' ? 'Send a private request to a supplier that can serve your delivery point.' : 'A reviewer needs to confirm your company and trading authority before you can submit offers or open requests.'}</p></div>
    {create && <section className="boxed"><h2>New supply request</h2><Form submit="Send private request" onSubmit={async data => {
      const result = await call<{ requestId: string }>('request', {
        seller: field(data, 'seller'), point: field(data, 'point'), kw: Number(field(data, 'kw')), requirements: field(data, 'requirements'),
        startAt: localTime(field(data, 'start')), endAt: localTime(field(data, 'end')), closesAt: localTime(field(data, 'close'))
      })
      location.assign('/workspace/requests/' + result.requestId)
    }}>
      <div className="pair"><Input label="Supplier owner’s username" name="seller" maxLength={32} /><Input label="Grid delivery point" name="point" maxLength={120} /></div>
      <div className="pair"><Input label="Delivery starts · Singapore time" type="datetime-local" name="start" step={1800} /><Input label="Delivery ends · Singapore time" type="datetime-local" name="end" step={1800} /></div>
      <div className="pair"><Input label="Offer deadline · Singapore time" name="close" type="datetime-local" /><Input label="Committed power · kW" name="kw" type="number" min={1} max={1000000} /></div>
      <Notes label="Supply and shortfall requirements" name="requirements" />
    </Form></section>}
    <h2>Private requests and deals</h2>
    {error ? <p role="alert" className="error">{error}</p> : !requests ? <p role="status">Loading requests…</p> :
      requests.length === 0 ? <div className="empty"><strong>No requests yet</strong><p>{canTrade ? 'Create one or share your company owner’s username with a buyer.' : 'Requests will appear when an approved buyer invites your company.'}</p></div> :
      <ul className="records">{requests.map(r => <li key={r.id}><a href={'/workspace/requests/' + r.id}>
        <strong>{r.point}</strong><span>{r.buyer_id === user.company_id ? 'Buying from ' + r.seller_name : 'Selling to ' + r.buyer_name}</span>
        <span>{decimal.format(quantity(r))} MWh · {time(r.start_at)}</span><b>{r.deal_id ? 'Deal' : r.closes_at < Date.now() ? 'Closed' : 'Open request'}</b>
      </a></li>)}</ul>}
  </section>
}

function Team({ user }: { user: User }) {
  const [link, setLink] = useState('')
  return <section className="workspace"><span className="eyebrow">{user.company_name}</span><h1>Company access</h1>
    <dl><dt>Username</dt><dd>{user.username}</dd><dt>Workspace role</dt><dd>{user.role}</dd><dt>Trading access</dt><dd>{user.status}</dd></dl>
    {user.role === 'owner' && <section className="boxed"><h2>Invite a teammate</h2><p>Share the single-use link privately. It expires in 24 hours.</p><Form submit="Create invitation" onSubmit={async data => setLink((await call<{ link: string }>('invite', { role: field(data, 'role') })).link)}>
      <label>Role<select name="role"><option value="trader">Trader · requests and offers</option><option value="operator">Operator · delivery records</option><option value="viewer">Viewer · read access</option></select></label>
    </Form>{link && <><p className="code">{link}</p><Copy value={link}>Copy invitation link</Copy></>}</section>}
  </section>
}

function Review({ user }: { user: User }) {
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [error, setError] = useState('')
  async function refresh() { setCompanies((await call<{ companies: Company[] }>('reviewList')).companies) }
  useEffect(() => { if (user.reviewer) refresh().catch(err => setError(err.message)) }, [user.reviewer])
  if (!user.reviewer) return <section className="workspace"><h1>Reviewer access required</h1><a href="/workspace">Back to workspace</a></section>
  return <section className="workspace"><span className="eyebrow">Trading access</span><h1>Company reviews</h1>
    <p>Confirm the company identity, authority and pilot market eligibility with independent records before granting access.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {companies?.length === 0 && <p>No companies to review.</p>}
    {companies?.map(c => <section key={c.id} className="boxed"><h2>{c.name}</h2><p>{c.registration} · {c.status}</p>{c.review_note && <p>{c.review_note}</p>}
      <Form submit="Save review" onSubmit={async data => { await call('review', { companyId: c.id, result: field(data, 'result'), note: field(data, 'note') }); await refresh() }}>
        <label>Decision<select name="result"><option value="approved">Approve trading</option><option value="rejected">Decline trading</option></select></label>
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
  const { request: r, deal, offers } = data
  const latest = offers[0] as Offer | undefined
  const buyer = r.buyer_id === user.company_id
  const canTrade = user.status === 'approved' && ['owner','trader'].includes(user.role)
  const owner = user.status === 'approved' && user.role === 'owner'
  const canOperate = user.status === 'approved' && ['owner','operator'].includes(user.role)
  const open = !deal && r.closes_at > Date.now()
  async function act(action: string, args: Record<string, unknown>) { await call(action, args); await refresh() }
  return <section className="workspace">
    <a href="/workspace">← Requests</a>
    <div className="section-head"><div><span className="eyebrow">{r.buyer_name} → {r.seller_name}</span><h1>{r.point}</h1></div><span className="status">{deal ? 'Deal' : open ? 'Open request' : 'Closed'}</span></div>
    <div className="delivery-band"><div><strong>{decimal.format(r.kw / 1000)} MW</strong><span>Committed power</span></div><div><strong>{decimal.format(quantity(r))} MWh</strong><span>Contract window volume</span></div></div>
    <p>{time(r.start_at)} → {time(r.end_at)}</p><p>{r.requirements}</p><small>Offer deadline {time(r.closes_at)}</small>
    <h2>Offer history</h2>
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
      <li><b>Agreement</b><span>{contracted ? 'Contracted' : 'Awaiting signed agreement'}</span></li>
      <li><b>Schedule</b><span>{d.schedule_ref ? 'Partner reference recorded' : 'Awaiting schedule'}</span></li>
      <li><b>Delivery</b><span>{d.delivery_status ? heading(d.delivery_status) : 'Awaiting delivery report'}</span></li>
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
      <Form submit={current ? 'Report corrected delivery' : 'Record delivery'} onSubmit={f => act('delivery', { dealId: d.id, previous: current?.id ?? null, reference: field(f, 'reference'), issuer: field(f, 'issuer'), wh: Math.round(Number(field(f, 'mwh')) * 1e6) })}>
        <div className="pair"><Input label="Meter or settlement record issuer" name="issuer" maxLength={120} /><Input label="External delivery evidence reference" name="reference" maxLength={300} /></div>
        <Input label="Delivered amount · MWh" name="mwh" type="number" min={0} step=".000001" />
      </Form>}
    {current && <div className="notice"><strong>{decimal.format(current.measured_wh / 1e6)} MWh reported</strong>
      <p>{difference > 0 ? decimal.format(difference / 1e6) + ' MWh shortfall' : difference < 0 ? decimal.format(-difference / 1e6) + ' MWh above contract' : 'Matches contracted amount'} · {current.issuer} · {current.evidence_ref}</p>
      {d.review_note && <p>{d.review_note}</p>}</div>}
    {current && buyer && canOperate && d.delivery_status === 'reported' && <Form submit="Save delivery review" onSubmit={f => act('deliveryReview', { dealId: d.id, deliveryId: current.id, result: field(f, 'result'), note: field(f, 'note') })}>
      <label>Review outcome<select name="result" defaultValue={difference ? 'disputed' : 'reconciled'}><option value="disputed">Open a dispute</option><option value="reconciled">Reconcile under the agreement</option></select></label>
      <Notes label="Resolution or reason for dispute" name="note" maxLength={1200} />
    </Form>}
    {buyer && canOperate && d.delivery_status === 'reconciled' && !d.settlement_ref &&
      <Form submit="Record external settlement" onSubmit={f => act('settlement', { dealId: d.id, reference: field(f, 'reference') })}><Input label="External settlement reference" name="reference" maxLength={300} /></Form>}
    <h3>Activity</h3>
    <ul className="records">{data.events.map(e => <li key={e.id}><strong>{e.kind}</strong><span>{time(e.occurred_at)}</span><p>{e.detail}</p></li>)}</ul>
  </section>
}
