import { useEffect, useState } from 'react'
import { call, field } from './client'
import type { User } from './client'
import { Form, Input, Notes } from './forms'
import { jurisdictions } from './registries'
import { energyProducts, specificationHints } from './energy-products'
import type { EnergyCase } from './energy-products'

type Offer = {revision:number;id:string;company_id:string;company_name:string;amount:number;currency:string;unit:string;terms:string;expires_at:number}
type Detail = {record:EnergyCase;offers:Offer[];events:{note:string;occurred_at:number}[];companies:{id:string;name:string}[];matches:{id:string;title:string;delivery_point:string;company_name:string}[]}
const date=(value:number)=>new Date(value).toLocaleString()+' (your local time)'
export function EnergyWorkspace({user,path}:{user:User;path:string}) {
 const [records,setRecords]=useState<EnergyCase[]>([]), [detail,setDetail]=useState<Detail|null>(null), [error,setError]=useState('')
 const [product,setProduct]=useState('gas'), [saved,setSaved]=useState(false)
 const [requestKey]=useState(()=>crypto.randomUUID())
 const caseId=path.split('/')[3], creating=caseId==='new'
 const [metrics,setMetrics]=useState<{routes:Record<string,unknown>[];repeat:{name:string;completed:number}[]}|null>(null)
 async function refresh() {
  try {
   setError('')
   if(caseId&&!creating) setDetail(await call<Detail>('energyDetail',{caseId}))
   else setRecords((await call<{cases:EnergyCase[]}>('energyList')).cases)
   if(user.bunker_operator&&!caseId) setMetrics(await call('energyMetrics'))
  } catch(e) {setError(e instanceof Error?e.message:'Could not load energy cases.')}
 }
 useEffect(()=>{void refresh()},[path])
 async function act(action:string,values:Record<string,unknown>) {await call(action,{caseId,...values});await refresh()}
 const selected=detail?.offers.find(o=>o.id===detail.record.selected_offer)
 const owner=detail?.record.company_id===user.company_id, seller=selected?.company_id===user.company_id
 const mutable=user.role!=='viewer', operator=!!user.bunker_operator
 const closed=detail&&['closed','cancelled'].includes(detail.record.state)
 function changeForm(change:string,label:string,reference=false) {
  if(!detail||!mutable||closed)return null
  return <Form key={change} submit={label} onSubmit={f=>act('energyChange',{revision:detail.record.revision,change,note:field(f,'note'),...(reference?{reference:field(f,'reference')}:{})})}>
   <Notes label={change==='contract'?'Record payment security provider, instrument, conditions, responsible parties, fee payer, fee amount/formula and fee trigger':'Notes, evidence issuer, responsible party and next action'} name="note" maxLength={3500}/>
   {reference&&<Input label={change==='contract'?'Agreed contract and version reference':'Evidence / invoice / payment / agreement reference'} name="reference" maxLength={1500}/>}
  </Form>
 }
 if(creating)return <section className="workspace"><a href="/workspace/energy">← Energy workspace</a><h1>{new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('side')==='sell'?'Offer available supply':'Submit an energy requirement'}</h1>
  <p>Your submission is private to your company and Teder operations. Teder reviews the route before inviting counterparties. You can save a draft on this device.</p>
  <Form submit="Submit for sourcing review" onSubmit={async f=>{
   const details=Object.fromEntries(f.entries());
   const result=await call<{id:string}>('energyCreate',{...details,requestKey,consent:f.has('consent'),validUntil:Date.parse(field(f,'validUntil'))})
   sessionStorage.removeItem('teder-energy-draft');location.assign('/workspace/energy/'+result.id)
  }}>
   <label>Submission type<select name="side" defaultValue={typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('side')==='sell'?'sell':'buy'}><option value="buy">I need supply</option><option value="sell">I have supply</option></select></label>
   <label>Energy product<select name="product" value={product} onChange={e=>setProduct(e.target.value)}>{Object.entries(energyProducts).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <Input label="Requirement or supply title" name="title" maxLength={160}/>
   <div className="pair"><label>Delivery country / territory<select name="country" required><option value="">Choose delivery jurisdiction</option>{jurisdictions.map(j=><option key={j.code} value={j.code}>{j.name}</option>)}</select></label><Input label="Exact site, port, terminal, hub or bidding zone" name="deliveryPoint" maxLength={200}/></div>
   <div className="pair"><Input label="Quantity and unit / power and energy capacity" name="quantity" maxLength={100}/><Input label="Delivery window and time zone" name="window" maxLength={200}/></div>
   <Notes label={specificationHints[product]} name="specification" maxLength={3000}/>
   <Notes label="Delivery terms, responsible operators, access rights, payment/credit expectations and confidential handling instructions" name="deliveryTerms" maxLength={1500}/>
   <Input label="Business contact email" name="contact" type="email" maxLength={254}/><Input label="Response deadline / supply availability expires (your local time)" name="validUntil" type="datetime-local"/>
   <label className="check"><input type="checkbox" name="consent" required/>I authorize Teder to approach relevant counterparties using these requirements, subject to my sharing instructions, and accept the <a href="/terms">service terms</a> and <a href="/privacy">privacy information</a>.</label>
   <div className="hero-actions"><button type="button" className="secondary" onClick={e=>{const form=e.currentTarget.closest('form')!;sessionStorage.setItem('teder-energy-draft',JSON.stringify(Object.fromEntries(new FormData(form))));setSaved(true)}}>Save draft on this device</button><button type="button" className="secondary" onClick={e=>{const raw=sessionStorage.getItem('teder-energy-draft');if(!raw)return;const values=JSON.parse(raw);setProduct(values.product||'gas');const form=e.currentTarget.closest('form')!;for(const [key,value] of Object.entries(values)){const input=form.elements.namedItem(key);if(input instanceof HTMLInputElement&&input.type!=='checkbox'||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement)input.value=String(value)}setSaved(false)}}>Restore draft</button></div>{saved&&<p role="status">Draft saved on this device. Clear it after using a shared device.</p>}
  </Form></section>
 if(!caseId)return <section className="workspace"><div className="section-head"><h1>Energy workspace</h1><button className="secondary" onClick={()=>void refresh()}>Refresh</button></div>
  <p>Global requirements and available supply. Company approval and route review are required before quoting.</p>
  {!operator&&<div className="hero-actions"><a className="button" href="/workspace/energy/new?side=buy">I need supply</a><a className="button secondary-link" href="/workspace/energy/new?side=sell">I have supply</a></div>}
  {user.status!=='approved'&&!operator&&<p className="notice">Your company review is {user.status}. <a href="/workspace/review">Submit or check your authority evidence</a>.</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  <ul className="records">{records.map(r=><li key={r.id}><a href={'/workspace/energy/'+r.id}><strong>{r.title}</strong><span>{r.side==='buy'?'Requirement':'Available supply'} · {energyProducts[r.product as keyof typeof energyProducts]} · {r.country} · {r.delivery_point}</span><span>{r.state.replaceAll('_',' ')} · {r.next_action}</span><small>Updated {date(r.updated_at)}</small></a></li>)}</ul>{!records.length&&<p>Your submitted cases and private invitations will appear here.</p>}
  {metrics&&<section><h2>Route performance</h2><p>Counts reflect recorded case outcomes. Check fees against bank receipts and record operating cost in the case history.</p><ul className="records">{metrics.routes.map((r,i)=><li key={i}>{String(r.product)} · {String(r.country)} · {String(r.state)} · {String(r.cases)} cases · {String(r.fees_received)} collected fees</li>)}</ul><h3>Repeat fee-paying customers</h3>{metrics.repeat.length?metrics.repeat.map(r=><p key={r.name}>{r.name} · {r.completed} completed cases</p>):<p>No repeat fee-paying cases recorded.</p>}</section>}
 </section>
 if(!detail)return <section className="workspace"><p role="status">{error||'Loading private case…'}</p></section>
 const e=detail.record, info=JSON.parse(e.details)
 return <section className="workspace"><a href="/workspace/energy">← Energy workspace</a><div className="section-head"><h1>{e.title}</h1><button className="secondary" onClick={()=>void refresh()}>Refresh</button></div>
  {error&&<p role="alert" className="error">{error}</p>}
  <p className="notice"><strong>{e.state.replaceAll('_',' ')}</strong> · {e.next_action}{e.next_at&&<> · due {date(e.next_at)}</>}</p>
  <dl><dt>Product</dt><dd>{energyProducts[e.product as keyof typeof energyProducts]}</dd><dt>Company</dt><dd>{e.company_name}</dd><dt>Delivery point</dt><dd>{e.country} · {e.delivery_point}</dd><dt>Quantity</dt><dd>{info.quantity}</dd><dt>Delivery window</dt><dd>{info.window}</dd><dt>Specification</dt><dd>{info.specification}</dd><dt>Delivery terms</dt><dd>{info.deliveryTerms}</dd><dt>Response deadline</dt><dd>{date(info.validUntil)}</dd></dl>
  {(owner||operator)&&<p>Business contact · {info.contact}</p>}
  {operator&&!closed&&<details open={!e.operator_id}><summary>Operations · ownership and route review</summary>
   <Form submit="Assign to me and set next action" onSubmit={f=>act('energyChange',{revision:e.revision,change:'triage',note:field(f,'note'),nextAt:Date.parse(field(f,'nextAt'))})}><Notes label="Next action and response commitment" name="note"/><Input label="Next update due (your local time)" type="datetime-local" name="nextAt"/></Form>
   {['submitted','checking'].includes(e.state)&&changeForm('clear','Confirm route and open sourcing')}
   <p>Route review must identify counterparty authority, origin/sanctions checks, delivery/access rights, transport or scheduling responsibility, credit and applicable operating requirements. Record what was checked and who confirmed it.</p>
  </details>}
  {e.route_note&&<section><h2>Route decision</h2><p>{e.route_note}</p></section>}
  {(owner||operator)&&!closed&&<section><h2>Potential matches</h2><p>Same product and delivery country, with current operator-cleared availability. Confirm specification, exact delivery point, dates and quantity before inviting.</p><ul className="records">{detail.matches.map(m=><li key={m.id}>{m.company_name} · {m.title} · {m.delivery_point}</li>)}</ul>{!detail.matches.length&&<p>No matching availability recorded. Teder can seek counterparties with your permission.</p>}
   {e.side==='buy'&&e.state==='quoting'&&<Form submit="Invite supplier privately" onSubmit={f=>act('energyInvite',{companyId:field(f,'company')})}><label>Approved supplier<select name="company" required><option value="">Choose a company</option>{detail.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></Form>}
  </section>}
  {!owner&&!operator&&e.state==='quoting'&&<section><h2>Your private quote</h2><Form submit="Submit / replace quote" onSubmit={f=>act('energyQuote',{amount:Number(field(f,'amount')),currency:field(f,'currency').toUpperCase(),unit:field(f,'unit'),terms:field(f,'terms'),expiresAt:Date.parse(field(f,'expiresAt'))})}><div className="pair"><Input label="Price" name="amount" type="number" min="0.000001" step="any"/><Input label="Currency (ISO code, e.g. USD)" name="currency" pattern="[A-Za-z]{3}" maxLength={3}/></div><Input label="Price basis (e.g. per MWh, tonne, or full delivery)" name="unit" maxLength={80}/><Notes label="Included/excluded transport, specification, volume tolerance, taxes, credit, delivery basis and responsible operator" name="terms" maxLength={3000}/><Input label="Quote expires (your local time)" name="expiresAt" type="datetime-local"/></Form></section>}
  <section><h2>Private offers</h2><p>Compare currency, price basis and all exclusions before selection. Different terms can change the delivered cost.</p><div className="offer-grid">{detail.offers.map(o=><article className="market-card" key={o.id}><h3>{o.company_name}</h3><strong>{o.currency} {o.amount} / {o.unit}</strong><p>{o.terms}</p><small>Expires {date(o.expires_at)}</small>{owner&&e.state==='quoting'&&<Form submit="Select for contracting" onSubmit={()=>act('energyChange',{revision:e.revision,change:'select',offerId:o.id,offerRevision:o.revision,note:'Buyer selected this offer for contracting.'})}><label className="check"><input type="checkbox" required/>I reviewed the delivery and commercial terms.</label></Form>}</article>)}</div>{!detail.offers.length&&<p>No quotes received yet.</p>}</section>
  {(owner||seller||operator)&&e.selected_offer&&<section><h2>Contract, delivery and payment</h2>
   {e.contract_ref&&<p>Contract · {e.contract_ref}</p>}{e.security_ref&&<p>Payment security and agreed service fee · {e.security_ref}</p>}
   <p>Buyer acceptance · {e.buyer_signed?'confirmed':'pending'} · Supplier acceptance · {e.seller_signed?'confirmed':'pending'}</p>
   {operator&&e.state==='contracting'&&changeForm('contract','Record contract, payment security and fee terms',true)}
   {(owner||seller)&&e.state==='contracting'&&changeForm('sign','Accept recorded contract, security and fee terms')}
   {seller&&['contracted','delivery_review'].includes(e.state)&&changeForm('delivery','Submit delivery evidence',true)}
   {e.delivery_ref&&<p>Supplier delivery evidence · {e.delivery_ref} · {e.delivery_accepted?'Buyer accepted':'Awaiting buyer acceptance'}</p>}
   {owner&&e.state==='delivery_review'&&changeForm('acceptDelivery','Accept delivered quantity and quality')}
   {seller&&e.state==='delivered'&&!e.payment_ref&&changeForm('invoice','Record supplier invoice',true)}
   {e.invoice_ref&&<p>Supplier invoice · {e.invoice_ref}</p>}
   {owner&&e.state==='delivered'&&!!e.invoice_ref&&changeForm('payment','Report payment to supplier',true)}
   {e.payment_ref&&<p>Buyer-reported payment · {e.payment_ref} · {e.payment_received?'Supplier confirmed receipt':'Awaiting supplier receipt confirmation'}</p>}
   {seller&&e.state==='delivered'&&!!e.payment_ref&&changeForm('receipt','Confirm supplier received payment')}
   {operator&&e.state==='paid'&&!e.fee_payment_ref&&changeForm('fee','Issue agreed Teder fee invoice',true)}
   {e.fee_ref&&<p>Teder fee invoice · {e.fee_ref}</p>}
   {(owner||seller)&&!!e.fee_ref&&!e.fee_received&&changeForm('feePayment','Report Teder fee payment',true)}
   {e.fee_payment_ref&&<p>Fee payment reported · {e.fee_payment_ref} · {e.fee_received?'Receipt confirmed':'Awaiting Teder receipt confirmation'}</p>}
   {operator&&!!e.fee_payment_ref&&!e.fee_received&&changeForm('feeReceipt','Confirm Teder actually received fee')}
  </section>}
  {!closed&&(owner||seller||operator)&&<details><summary>Exceptions and closure</summary>{e.state!=='exception'&&changeForm('exception','Open an exception and pause progress')}{operator&&e.state==='exception'&&changeForm('resolve','Record resolution and resume',true)}{(owner||operator)&&!e.selected_offer&&changeForm('cancel','Close sourcing with reason')}</details>}
  <section><h2>Case history</h2><ul className="records">{detail.events.map((event,i)=><li key={i}><p>{event.note}</p><small>{date(event.occurred_at)}</small></li>)}</ul></section>
 </section>
}
