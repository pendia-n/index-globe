import { z } from 'zod'
import type { Bindings } from './security'
import { conversationAccess } from './access'
import type { Actor } from './access'
export const documentLimit=1024*1024
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers})
export async function documentAccess(db:Bindings['DB'],user:Actor,scope:string,scopeId:string) {
 if(scope==='company')return !!user.bunker_operator||scopeId===user.company_id&&['owner','applicant'].includes(user.role)
 if(scope==='dm')return !!await conversationAccess(db,user,scopeId)
 if(scope==='energy')return !!await db.prepare(`SELECT 1 FROM energy_cases e LEFT JOIN energy_offers o ON o.id=e.selected_offer
  WHERE e.id=? AND (?=1 OR e.company_id=? OR o.company_id=?)`).bind(scopeId,user.bunker_operator,user.company_id,user.company_id).first()
 return false
}
export async function documentsApi(action:string,body:unknown,env:Bindings,user:Actor) {
 const input=z.object({scope:z.enum(['company','dm','energy']),scopeId:z.uuid()}).parse(body)
 const db=env.DB
 if(!await documentAccess(db,user,input.scope,input.scopeId))return reply({error:'Evidence not found.'},404)
 if(action==='documentList') {
  return reply({documents:(await db.prepare(`SELECT d.id,d.category,d.filename,d.mime,d.sha256,d.bytes,d.uploaded_at,u.username uploaded_by
   FROM private_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.scope=? AND d.scope_id=? ORDER BY d.uploaded_at DESC,d.id LIMIT 100`).bind(input.scope,input.scopeId).all()).results})
 }
 if(action==='documentDownload') {
  const {documentId}=z.object({documentId:z.uuid()}).parse(body)
  const doc=await db.prepare('SELECT filename,content FROM private_documents WHERE id=? AND scope=? AND scope_id=?').bind(documentId,input.scope,input.scopeId).first<{filename:string;content:number[]}>()
  if(!doc)return reply({error:'Evidence not found.'},404)
  return new Response(new Uint8Array(doc.content),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${doc.filename}"`,'Content-Security-Policy':'sandbox'}})
 }
 if(action!=='documentUpload')return reply({error:'Unknown document action.'},400)
 if(input.scope==='company'&&!['owner','applicant'].includes(user.role)&&!user.bunker_operator)return reply({error:'Only the company applicant, owner or Teder can submit verification evidence.'},403)
 if(input.scope==='energy'&&user.role==='viewer')return reply({error:'Trading access is required to upload deal evidence.'},403)
 const file=z.object({name:z.string().trim().min(1).max(160),category:z.enum(['registry','authority','identity','contract','route','delivery','quantity','quality','invoice','payment','other']),contents:z.string().min(8).max(Math.ceil(documentLimit/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).parse(body)
 let bytes:Uint8Array<ArrayBuffer>
 try{bytes=Uint8Array.from(atob(file.contents),c=>c.charCodeAt(0))}catch{return reply({error:'Invalid file encoding.'},400)}
 if(bytes.length>documentLimit)return reply({error:'Maximum file size is 1 MiB.'},413)
 const signature=Array.from(bytes.slice(0,8)).join(',')
 const pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'
 const mime=pdf?'application/pdf':signature==='137,80,78,71,13,10,26,10'?'image/png':signature.startsWith('255,216,255,')?'image/jpeg':null
 if(!mime)return reply({error:'Upload a PDF, PNG or JPEG document.'},400)
 const extension=pdf?'.pdf':mime==='image/png'?'.png':'.jpg'
 const filename=file.name.replace(/[^A-Za-z0-9._ -]/g,'_').replace(/\.[^.]*$/,'').slice(0,110)+extension
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
 const id=crypto.randomUUID()
 await db.prepare(`INSERT INTO private_documents(id,scope,scope_id,category,filename,mime,sha256,bytes,content,uploaded_by,uploaded_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM private_documents WHERE scope=? AND scope_id=?)<48
  ON CONFLICT(scope,scope_id,category,sha256) DO NOTHING`).bind(id,input.scope,input.scopeId,file.category,filename,mime,hash,bytes.length,bytes.buffer,user.id,Date.now(),input.scope,input.scopeId).run()
 const existing=await db.prepare('SELECT id FROM private_documents WHERE scope=? AND scope_id=? AND category=? AND sha256=?').bind(input.scope,input.scopeId,file.category,hash).first()
 if(!existing)return reply({error:'This evidence collection has reached its 48-document limit. Message Teder for assistance.'},409)
 return reply(existing,201)
}
