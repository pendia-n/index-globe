import {useEffect,useState} from 'react'
import {call,field} from './client'
import type {User} from './client'
import {Form,Input,Notes} from './forms'
import {Documents,downloadDocument} from './documents'
import type {PrivateDocument} from './documents'
import {MessageTeder} from './messages'
type Application={id:string;company_id:string;application_id?:string;name?:string;company_name?:string;submitted_by:string;applicant_name:string;position:string;registered_address:string;contact_email:string;registry_reference:string;authority_reference:string;officer_name:string;officer_contact:string;permission_scope:string;authority_limit:string;authority_until:number|null;decision:string|null;decision_note:string|null;clarification:string|null;submitted_at:number;country:string;registry_number:string;check_record:string|null}
export function CompanyVerification({user}:{user:User}) {
 const [applications,setApplications]=useState<Application[]>([]),[documents,setDocuments]=useState<PrivateDocument[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
 async function refresh(){const data=await call<{applications:Application[]}>('companyApplication');setApplications(data.applications);setLoaded(true)}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 const recent=applications[0],canSubmit=['applicant','owner'].includes(user.role)&&(user.status!=='approved'||user.role==='applicant')&&loaded&&(!recent||recent.decision==='rejected'||!!recent.clarification)
 return <section className="workspace"><div className="section-head"><h1>Company verification</h1><MessageTeder/></div>
 <p>Teder’s operator manually checks your company and representative authority. You can submit energy requirements while waiting. Trading and company-owner access follow approval.</p>
 {error&&<p role="alert" className="error">{error}</p>}
 <p className="notice">Company · {user.company_name} · {user.status} · Your access · {user.role}{user.authority_until&&<> · authority expires {new Date(user.authority_until).toLocaleDateString()}</>}</p>
 {recent?.clarification&&<p className="notice"><strong>Teder needs clarification</strong> · {recent.clarification}</p>}
 {recent?.decision_note&&<p>Latest review · {recent.decision_note}</p>}
 <Documents scope="company" scopeId={user.company_id} categories={['authority','registry','identity','other']} readOnly={!['owner','applicant'].includes(user.role)} onChange={setDocuments}/>
 {canSubmit&&<Form key={recent?.id||'new'} submit={recent?'Submit updated authority evidence':'Submit application for manual review'} onSubmit={async f=>{
  await call('submitCompanyApplication',{email:field(f,'email'),registry:field(f,'registry'),authority:field(f,'authority'),applicantName:field(f,'applicantName'),position:field(f,'position'),address:field(f,'address'),officerName:field(f,'officerName'),officerContact:field(f,'officerContact'),permissionScope:field(f,'permissionScope'),authorityLimit:field(f,'authorityLimit'),authorityUntil:Date.parse(field(f,'authorityUntil')+'T23:59:59Z'),documents:documents.map(d=>d.id)})
  await refresh()
 }}>
 <h2>Representative and mandate</h2><div className="pair"><Input label="Your full name" name="applicantName" maxLength={150} defaultValue={recent?.applicant_name}/><Input label="Your position" name="position" maxLength={150} defaultValue={recent?.position}/></div>
 <Input label="Registered company address" name="address" maxLength={500} defaultValue={recent?.registered_address}/><Input label="Company contact email" type="email" name="email" maxLength={254} defaultValue={recent?.contact_email}/>
 <Input label="Official registry reference or URL" name="registry" maxLength={500} defaultValue={recent?.registry_reference}/><Notes label="How your uploaded mandate establishes your authority" name="authority"/>
 <div className="pair"><Input label="Authorizing officer’s name" name="officerName" maxLength={150} defaultValue={recent?.officer_name}/><Input label="Officer’s business contact or switchboard" name="officerContact" maxLength={300} defaultValue={recent?.officer_contact}/></div>
 <Notes label="Permitted activities (request quotes, offer supply, negotiate, accept contracts)" name="permissionScope"/>
 <Input label="Transaction limits or restrictions" name="authorityLimit" maxLength={500} defaultValue={recent?.authority_limit}/><Input label="Authority valid until" name="authorityUntil" type="date" defaultValue={recent?.authority_until?new Date(recent.authority_until).toISOString().slice(0,10):undefined}/>
 <label className="check"><input type="checkbox" required/>The information is accurate and I am authorized to submit these documents. I understand Teder will confirm authority independently.</label>
 <p>Upload an authority document before submitting. Personal ID is requested only when the review requires it.</p>
 </Form>}
 <h2>Application history</h2><ul className="records">{applications.map(a=><li key={a.id}><strong>{a.decision|| (a.clarification?'Clarification requested':'Pending manual review')}</strong><span>{new Date(a.submitted_at).toLocaleString()} · {a.applicant_name||'Earlier application'}</span><p>{a.decision_note}</p></li>)}</ul>
 </section>
}
export function VerificationQueue() {
 const [applications,setApplications]=useState<Application[]>([]),[detail,setDetail]=useState<{application:Application;documents:PrivateDocument[];updates:{note:string;kind:string;created_at:number}[]}|null>(null),[error,setError]=useState('')
 async function refresh(){setApplications((await call<{companies:Application[]}>('reviewList')).companies)}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 async function open(id:string){try{setDetail(await call('reviewDetail',{applicationId:id}));setError('')}catch(e){setError(e instanceof Error?e.message:'Could not load application.')}}
 return <section className="workspace"><div className="section-head"><h1>Representative reviews</h1><button type="button" className="secondary" onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh queue</button></div><p>Record the independent checks performed. Approval grants company-owner authority to the verified applicant. Route and supplier eligibility require separate checks.</p>
 {error&&<p className="error" role="alert">{error}</p>}
 <ul className="records">{applications.map(a=><li key={a.application_id}><button type="button" className="secondary" onClick={()=>void open(a.application_id!)}>{a.name} · {a.applicant_name||a.contact_email}</button><small>{a.clarification?'Waiting for applicant clarification':'Decision needed'} · {a.country} · {a.registry_number}</small></li>)}</ul>{!applications.length&&<p>No pending applications.</p>}
 {detail&&<section className="boxed"><h2>{detail.application.company_name}</h2><dl>{Object.entries({Applicant:detail.application.applicant_name,Position:detail.application.position,Address:detail.application.registered_address,Contact:detail.application.contact_email,Registry:detail.application.registry_reference,Authority:detail.application.authority_reference,Officer:detail.application.officer_name,'Officer contact':detail.application.officer_contact,Permissions:detail.application.permission_scope,Limits:detail.application.authority_limit,'Authority expires':detail.application.authority_until?new Date(detail.application.authority_until).toLocaleDateString():'Missing'}).map(([key,value])=><div className="definition" key={key}><dt>{key}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl>
 <h3>Submitted evidence</h3><ul className="records">{detail.documents.map(d=><li key={d.id}><button className="secondary" type="button" onClick={()=>downloadDocument('company',detail.application.company_id,d.id).catch(e=>setError(e.message))}>{d.category} · {d.filename}</button><small>SHA-256 · {d.sha256}</small></li>)}</ul>
 {!detail.application.decision&&<Form key={detail.application.id} submit="Record review decision" onSubmit={async f=>{await call('review',{applicationId:detail.application.id,companyId:detail.application.company_id,result:field(f,'result'),note:field(f,'note'),registryCheck:field(f,'registryCheck'),authorityCheck:field(f,'authorityCheck'),identityCheck:field(f,'identityCheck')});setDetail(null);await refresh()}}>
 <Notes label="Independent registry check · source, date and result" name="registryCheck" maxLength={1500}/><Notes label="Authority confirmation · independently obtained channel, confirming officer and result" name="authorityCheck" maxLength={1500}/><Notes label="Identity assessment · checks performed or reason no extra ID was required" name="identityCheck" maxLength={1500}/>
 <label>Decision<select name="result"><option value="clarification">Request clarification</option><option value="approved">Approve company and representative</option><option value="rejected">Reject application</option></select></label><Notes label="Applicant-visible reason and next steps" name="note" maxLength={2000}/></Form>}
 <h3>Review history</h3><ul className="records">{detail.updates.map((u,i)=><li key={i}>{u.kind} · {u.note}<small>{new Date(u.created_at).toLocaleString()}</small></li>)}</ul>
 </section>}
 </section>
}
