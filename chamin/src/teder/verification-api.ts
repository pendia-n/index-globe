import { z } from 'zod'
import type { Bindings } from './security'
import type { Actor } from './access'
const text=(limit=1000)=>z.string().trim().min(1).max(limit)
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}})
export async function verificationApi(action:string,body:unknown,env:Bindings,user:Actor) {
 const db=env.DB,now=Date.now()
 if(action==='companyApplication') {
  const applications=(await db.prepare('SELECT * FROM company_applications WHERE company_id=? ORDER BY submitted_at DESC LIMIT 30').bind(user.company_id).all()).results
  const updates=(await db.prepare(`SELECT v.* FROM application_updates v JOIN company_applications a ON a.id=v.application_id WHERE a.company_id=? ORDER BY v.created_at DESC LIMIT 100`).bind(user.company_id).all()).results
  return reply({applications,updates})
 }
 if(action==='submitCompanyApplication') {
  if(!['applicant','owner'].includes(user.role)||user.workspace_kind!=='customer')return reply({error:'The company applicant or verified owner submits authority evidence.'},403)
  const input=z.object({email:z.email().max(254),registry:text(500),authority:text(1000),applicantName:text(150),position:text(150),address:text(500),officerName:text(150),officerContact:text(300),permissionScope:text(1500),authorityLimit:text(500),authorityUntil:z.number().int(),documents:z.array(z.uuid()).min(1).max(24)}).parse(body)
  if(input.authorityUntil<=now)return reply({error:'Authority expiry must be in the future.'},400)
  const documents=(await db.prepare(`SELECT id,category FROM private_documents WHERE id IN (${input.documents.map(()=>'?').join(',')}) AND scope='company' AND scope_id=?`).bind(...input.documents,user.company_id).all<{id:string;category:string}>()).results
  if(documents.length!==new Set(input.documents).size||!documents.some(d=>d.category==='authority'))return reply({error:'Attach an authorization mandate from your company evidence collection.'},400)
  const open=await db.prepare('SELECT id,clarification FROM company_applications WHERE company_id=? AND decision IS NULL').bind(user.company_id).first<{id:string;clarification:string|null}>()
  if(open&&!open.clarification)return reply({error:'Your application is pending. Message Teder if you need to add context.'},409)
  const id=open?.id??crypto.randomUUID()
  const fields=[input.email,input.registry,input.authority,input.applicantName,input.position,input.address,input.officerName,input.officerContact,input.permissionScope,input.authorityLimit,input.authorityUntil]
  const save=open?db.prepare(`UPDATE company_applications SET contact_email=?,registry_reference=?,authority_reference=?,applicant_name=?,position=?,registered_address=?,officer_name=?,officer_contact=?,permission_scope=?,authority_limit=?,authority_until=?,clarification=NULL,updated_at=? WHERE id=? AND company_id=? AND decision IS NULL AND clarification IS NOT NULL`).bind(...fields,now,id,user.company_id):
   db.prepare(`INSERT INTO company_applications(id,company_id,submitted_by,submitted_at,contact_email,registry_reference,authority_reference,applicant_name,position,registered_address,officer_name,officer_contact,permission_scope,authority_limit,authority_until,updated_at)
    SELECT ?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM companies WHERE id=? AND (status<>'approved' OR EXISTS(SELECT 1 FROM users WHERE id='${user.id}' AND authority_until<unixepoch()*1000))) ON CONFLICT DO NOTHING`).bind(id,user.company_id,user.id,now,...fields,now,user.company_id)
  const [saved]=await db.batch([save,
   db.prepare(`UPDATE companies SET status='pending' WHERE id=? AND changes()=1`).bind(user.company_id),
   ...documents.map(d=>db.prepare(`INSERT INTO application_documents SELECT ?,? WHERE EXISTS(SELECT 1 FROM company_applications WHERE id=? AND company_id=? AND decision IS NULL) ON CONFLICT DO NOTHING`).bind(id,d.id,id,user.company_id)),
   db.prepare(`INSERT INTO application_updates SELECT ?,?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM company_applications WHERE id=? AND company_id=? AND decision IS NULL)`).bind(crypto.randomUUID(),id,user.id,'submitted',open?'Applicant supplied requested clarification.':'Authority evidence submitted for manual review.',now,id,user.company_id),
  ])
  if(!saved.meta.changes)return reply({error:'Application changed. Refresh before submitting again.'},409)
  return reply({ok:true})
 }
 if(!user.bunker_operator)return reply({error:'Teder operator access required.'},403)
 if(action==='reviewList')return reply({companies:(await db.prepare(`SELECT c.id,c.name,c.country,c.registry_region,c.registry_number,c.issuing_registry,c.registration,c.status,c.review_note,a.*,a.id application_id,c.id company_id
  FROM company_applications a JOIN companies c ON c.id=a.company_id WHERE a.decision IS NULL ORDER BY a.submitted_at LIMIT 200`).all()).results})
 if(action==='reviewDetail') {
  const {applicationId}=z.object({applicationId:z.uuid()}).parse(body)
  const application=await db.prepare('SELECT a.*,c.name company_name,c.country,c.registry_number,c.issuing_registry FROM company_applications a JOIN companies c ON c.id=a.company_id WHERE a.id=?').bind(applicationId).first()
  const documents=(await db.prepare(`SELECT d.id,d.category,d.filename,d.bytes,d.sha256,d.uploaded_at FROM application_documents a JOIN private_documents d ON d.id=a.document_id WHERE a.application_id=?`).bind(applicationId).all()).results
  return reply({application,documents,updates:(await db.prepare('SELECT * FROM application_updates WHERE application_id=? ORDER BY created_at DESC').bind(applicationId).all()).results})
 }
 if(action==='review') {
  const input=z.object({companyId:z.uuid(),applicationId:z.uuid(),result:z.enum(['approved','rejected','clarification']),note:text(2000),registryCheck:text(1500),authorityCheck:text(1500),identityCheck:text(1500)}).parse(body)
  const application=await db.prepare('SELECT submitted_by,authority_until FROM company_applications WHERE id=? AND company_id=? AND decision IS NULL').bind(input.applicationId,input.companyId).first<{submitted_by:string;authority_until:number|null}>()
  if(!application)return reply({error:'Application was already decided or is unavailable.'},409)
  if(input.result==='approved'&&(!application.authority_until||application.authority_until<=now))return reply({error:'Obtain a current mandate and authority expiry before approval.'},409)
  const checks=JSON.stringify({registry:input.registryCheck,authority:input.authorityCheck,identity:input.identityCheck,reviewer:user.id,checkedAt:now})
  const update=input.result==='clarification'?
   db.prepare(`UPDATE company_applications SET clarification=?,decision_note=?,check_record=?,updated_at=? WHERE id=? AND company_id=? AND decision IS NULL`).bind(input.note,input.note,checks,now,input.applicationId,input.companyId):
   db.prepare(`UPDATE company_applications SET decision=?,decision_note=?,decided_by=?,decided_at=?,check_record=?,updated_at=?,clarification=NULL WHERE id=? AND company_id=? AND decision IS NULL`).bind(input.result,input.note,user.id,now,checks,now,input.applicationId,input.companyId)
  const statements=[update]
  if(input.result!=='clarification')statements.push(db.prepare(`UPDATE companies SET status=?,reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND EXISTS(SELECT 1 FROM company_applications WHERE id=? AND decided_by=? AND decided_at=?)`).bind(input.result,user.id,now,input.note,input.companyId,input.applicationId,user.id,now))
  if(input.result==='approved')statements.push(db.prepare("UPDATE users SET role='viewer',can_request=0,can_offer=0,can_accept=0,auth_version=auth_version+1 WHERE company_id=? AND role='owner' AND id<>? AND EXISTS(SELECT 1 FROM company_applications WHERE id=? AND decision='approved' AND decided_at=?)").bind(input.companyId,application.submitted_by,input.applicationId,now))
  if(input.result==='approved')statements.push(db.prepare(`UPDATE users SET role='owner',authority_status='verified',authority_until=? WHERE id=? AND company_id=? AND EXISTS(SELECT 1 FROM company_applications WHERE id=? AND decision='approved' AND decided_by=? AND decided_at=?)`).bind(application.authority_until,application.submitted_by,input.companyId,input.applicationId,user.id,now))
  statements.push(db.prepare('INSERT INTO application_updates VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),input.applicationId,user.id,input.result,input.note,now))
  const [decision]=await db.batch(statements)
  if(!decision.meta.changes)return reply({error:'Application changed. Refresh the review queue.'},409)
  return reply({ok:true})
 }
 return reply({error:'Unknown verification action.'},400)
}
