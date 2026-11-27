import {useEffect,useState} from 'react'
import {call,field} from './client'
import type {User} from './client'
import {Form,Input} from './forms'
import {energyProducts} from './energy-products'
import {jurisdictions} from './registries'
import {minorUnits} from './money'
type Configuration={configured:boolean;webhookConfigured:boolean;liveApproved:boolean;mode:string;routes:{product:string;country:string;currency:string;max_minor:number;approval_reference:string;valid_until:number}[]}
export function PaymentSettings({user}:{user:User}) {
 const [data,setData]=useState<{ready:boolean;configured:boolean;mode:string;connection:{provider_account:string}|null}|null>(null),[configuration,setConfiguration]=useState<Configuration|null>(null),[error,setError]=useState('')
 async function refresh(){setData(await call('paymentStatus'));if(user.bunker_operator)setConfiguration(await call('paymentConfiguration'))}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 async function connect(action:string){try{const r=await call<{url:string}>(action);location.assign(r.url)}catch(e){setError(e instanceof Error?e.message:'Payment action unavailable.')}}
 return <section className="workspace"><div className="section-head"><h1>Payment connection</h1><button className="secondary" type="button" onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh status</button></div><p>Teder uses supplier-account payments with an agreed 2% application fee. Supplier onboarding and payment-provider approval are required before accepting a trade payment.</p>
 {error&&<p role="alert" className="notice">{error}</p>}
 {data&&<p className="notice">{data.configured?(data.mode==='test'?'Test payment configuration':'Provider configured'):'Teder payment-account configuration pending'} · {data.ready?'Payment connection actions available':'Live payment actions unavailable'}</p>}
 {!user.bunker_operator&&user.role==='owner'&&<><button type="button" className="button" onClick={()=>void connect('paymentOnboard')}>{data?.connection?'Continue account requirements':'Connect supplier account'}</button>{data?.connection&&<button type="button" className="secondary" onClick={()=>void connect('paymentDashboard')}>Open provider dashboard and outstanding requirements</button>}</>}
 {configuration&&<><h2>Provider readiness</h2><dl><dt>API configuration</dt><dd>{configuration.configured?'Present':'Pending'}</dd><dt>Verified event endpoint</dt><dd>{configuration.webhookConfigured?'Configured':'Pending'}</dd><dt>Live operating approval</dt><dd>{configuration.liveApproved?'Recorded':'Pending'}</dd></dl>
 <Form submit="Record provider-approved route" onSubmit={async f=>{await call('paymentApproveRoute',{product:field(f,'product'),country:field(f,'country'),currency:field(f,'currency'),maxMinor:minorUnits(Number(field(f,'limit')),field(f,'currency')),validUntil:Date.parse(field(f,'expiry')+'T23:59:59Z'),reference:field(f,'reference'),enable:f.has('enable')});await refresh()}}>
 <label>Product<select name="product">{Object.entries(energyProducts).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Delivery country<select name="country" required><option value="">Select</option>{jurisdictions.map(j=><option key={j.code} value={j.code}>{j.name}</option>)}</select></label><label>Approved bank-transfer currency<select name="currency">{['USD','GBP','EUR','JPY'].map(c=><option key={c}>{c}</option>)}</select></label><Input label="Maximum approved payment in that currency" name="limit" type="number" min="1" step="any"/><Input label="Approval valid until" name="expiry" type="date"/><Input label="Provider approval reference and confirmed responsibility allocation" name="reference" maxLength={1500}/><label className="check"><input type="checkbox" name="enable"/>The provider has approved Teder’s business and these terms. Enable live eligible routes.</label><p>Recording a reference does not itself obtain provider approval.</p></Form>
 <ul className="records">{configuration.routes.map((r,i)=><li key={i}>{r.product} · {r.country} · {r.currency}<span>{r.approval_reference} · expires {new Date(r.valid_until).toLocaleDateString()}</span></li>)}</ul></>}
 </section>
}
