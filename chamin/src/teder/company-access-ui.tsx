import {useEffect,useState} from 'react'
import {call,field} from './client'
import {Copy,Form,Input,Notes} from './forms'
import {findRegistry,jurisdictions} from './registries'
export function CompanyAccessRequest() {
 const [country,setCountry]=useState(''),[receipt,setReceipt]=useState(''),[status,setStatus]=useState<{decision:string;note:string|null;invite:string|null;expired:boolean;used:boolean}|null>(null),[error,setError]=useState('')
 useEffect(()=>{const token=new URLSearchParams(location.hash.slice(1)).get('receipt');if(token)setReceipt(token)},[])
 const registry=findRegistry(country)
 async function track(){try{setStatus(await call('accessTrack',{receipt}));setError('')}catch(e){setError(e instanceof Error?e.message:'Could not load request.')}}
 return <section className="auth-panel"><h1>Join an existing company</h1><p>Request a named company seat. The verified owner or Teder reviews your request and confirms your authority. Save your private tracking link to retrieve the invitation here.</p>
 {error&&<p className="error" role="alert">{error}</p>}
 {!receipt?<Form submit="Request company access" onSubmit={async f=>{const r=await call<{receipt:string}>('accessRequest',{country,region:field(f,'region'),registration:field(f,'registration'),fullName:field(f,'fullName'),email:field(f,'email'),username:field(f,'username').toLowerCase(),note:field(f,'note')});setReceipt(r.receipt);history.replaceState(null,'','/access#receipt='+r.receipt)}}>
 <label>Company registration country<select name="country" required value={country} onChange={e=>setCountry(e.target.value)}><option value="">Select</option>{jurisdictions.map(j=><option key={j.code} value={j.code}>{j.name}</option>)}</select></label>
 {registry?.regions.length?<label>Issuing jurisdiction<select name="region" required><option value="">Select</option>{registry.regions.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>:!registry&&country?<Input label="Issuing registry" name="region" maxLength={120}/>:null}
 <Input label="Company registration identifier" name="registration" maxLength={80}/><Input label="Your full name" name="fullName" maxLength={150}/><Input label="Your business email" name="email" type="email"/><Input label="Desired username" name="username" pattern="[a-z0-9][a-z0-9_.\-]{2,31}" maxLength={32}/><Notes label="Your role, authorizing officer and how your authority can be confirmed" name="note"/></Form>:<>
 <Copy value={typeof window==='undefined'?'':location.origin+'/access#receipt='+receipt}>Copy private tracking link</Copy><button type="button" className="secondary" onClick={()=>void track()}>Check access request</button>
 {status&&<p className="notice">{status.decision} · {status.note||'Awaiting owner or Teder review.'}</p>}{status?.invite&&<a className="button" href={'/register?invite='+status.invite}>Accept invitation and choose your password</a>}{status?.expired&&<p>The invitation expired. Ask the company owner or Teder to issue a fresh invitation.</p>}{status?.used&&<a href="/login">Invitation used · sign in</a>}
 </>}
 </section>
}
export function AccessQueue() {
 const [requests,setRequests]=useState<{id:string;company_name:string;full_name:string;work_email:string;username:string;note:string}[]>([]),[error,setError]=useState('')
 async function refresh(){setRequests((await call<{requests:typeof requests}>('accessQueue')).requests)}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 return <section><h2>Company access requests</h2>{error&&<p className="error" role="alert">{error}</p>}{!requests.length&&<p>No pending access requests.</p>}{requests.map(r=><article key={r.id} className="boxed"><h3>{r.company_name} · {r.full_name}</h3><p>{r.work_email} · requested username {r.username}</p><p>{r.note}</p><Form submit="Record access decision" onSubmit={async f=>{await call('accessDecision',{requestId:r.id,result:field(f,'result'),note:field(f,'note')});await refresh()}}><label>Decision<select name="result"><option value="approved">Confirm authority and reserve a seat</option><option value="rejected">Reject request</option></select></label><Notes label="Independent authority confirmation and decision reason" name="note"/></Form></article>)}</section>
}
