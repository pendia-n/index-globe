import { z } from 'zod'
import type { Bindings } from './security'
import type { Actor } from './access'
import { digest } from './security'
import { findRegistry,registryNumber,supportsJurisdiction } from './registries'
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}})
const text=(max=1500)=>z.string().trim().min(1).max(max)
async function seal(value:string,secret:string,nonce?:Uint8Array<ArrayBuffer>) {
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('teder-access:'+secret)),{name:'AES-GCM'},false,['encrypt','decrypt'])
 if(nonce){const buffer=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,buffer))}
 const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)))
 return Array.from(iv,n=>n.toString(16).padStart(2,'0')).join('')+'.'+btoa(String.fromCharCode(...encrypted))
}
export async function companyAccessApi(action:string,body:unknown,env:Bindings,user?:Actor) {
 const db=env.DB,now=Date.now()
 if(action==='accessRequest') {
  const i=z.object({country:z.string().refine(supportsJurisdiction),region:z.string().trim().max(120).default(''),registration:text(80),fullName:text(150),email:z.email().max(254),username:z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/),note:text(1500)}).parse(body)
  const country=i.country,registry=findRegistry(country),region=registry?i.region:i.region.toUpperCase().replace(/\s+/g,' ')
  const company=await db.prepare("SELECT id FROM companies WHERE country=? AND registry_region=? AND registry_number=? AND workspace_kind='customer'").bind(country,region,registryNumber(country,i.registration)).first<{id:string}>()
  if(!company)return reply({error:'No matching workspace was found. Check the jurisdiction and registered identifier, or register your company.'},404)
  const receipt=Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('')
  await db.prepare('INSERT INTO company_access_requests(id,company_id,full_name,work_email,username,note,receipt_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),company.id,i.fullName,i.email,i.username,i.note,await digest(env.TEDER_JWT_SECRET,'access-receipt',receipt),now).run()
  return reply({receipt},201)
 }
 if(action==='accessTrack') {
  const {receipt}=z.object({receipt:z.string().regex(/^[a-f0-9]{48}$/)}).parse(body)
  const r=await db.prepare(`SELECT r.decision,r.decision_note,r.invite_token,i.expires_at,i.used_by FROM company_access_requests r LEFT JOIN staff_invites i ON i.hash=r.invite_hash WHERE r.receipt_hash=?`).bind(await digest(env.TEDER_JWT_SECRET,'access-receipt',receipt)).first<{decision:string|null;decision_note:string|null;invite_token:string|null;expires_at:number|null;used_by:string|null}>()
  if(!r)return reply({error:'Access request was not found.'},404)
  let invite:string|null=null
  if(r.invite_token&&r.expires_at!>now&&!r.used_by){const [hex,encrypted]=r.invite_token.split('.');invite=await seal(encrypted,env.TEDER_JWT_SECRET,Uint8Array.from(hex.match(/../g)!,n=>parseInt(n,16)))}
  return reply({decision:r.decision||'pending',note:r.decision_note,invite,expired:!!r.expires_at&&r.expires_at<=now,used:!!r.used_by})
 }
 if(!user)return reply({error:'Sign in to continue.'},401)
 if(!user.bunker_operator&&user.role!=='owner')return reply({error:'Company-owner or Teder operator access required.'},403)
 if(action==='accessQueue')return reply({requests:(await db.prepare(`SELECT r.id,r.company_id,r.full_name,r.work_email,r.username,r.note,r.created_at,c.name company_name,c.status company_status FROM company_access_requests r JOIN companies c ON c.id=r.company_id WHERE r.decision IS NULL AND (?=1 OR r.company_id=?) ORDER BY r.created_at LIMIT 100`).bind(user.bunker_operator,user.company_id).all()).results})
 if(action==='accessDecision') {
  const i=z.object({requestId:z.uuid(),result:z.enum(['approved','rejected']),note:text(1500)}).parse(body)
  const r=await db.prepare('SELECT company_id,username FROM company_access_requests WHERE id=? AND decision IS NULL AND (?=1 OR company_id=?)').bind(i.requestId,user.bunker_operator,user.company_id).first<{company_id:string;username:string}>()
  if(!r)return reply({error:'Access request was already decided or is unavailable.'},409)
  if(i.result==='rejected'){await db.prepare("UPDATE company_access_requests SET decision='rejected',decision_note=?,decided_by=?,decided_at=? WHERE id=? AND decision IS NULL").bind(i.note,user.id,now,i.requestId).run();return reply({ok:true})}
  const token=Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join(''),hash=await digest(env.TEDER_JWT_SECRET,'invite',token)
  const encrypted=await seal(token,env.TEDER_JWT_SECRET)
  const [inserted]=await db.batch([
   db.prepare(`INSERT INTO staff_invites(hash,company_id,role,expires_at,invite_id,invited_username) SELECT ?,?,'trader',?,?,? WHERE (SELECT COUNT(*) FROM users WHERE company_id=? AND disabled_at IS NULL)+(SELECT COUNT(*) FROM staff_invites WHERE company_id=? AND used_by IS NULL AND expires_at>?)<5 AND EXISTS(SELECT 1 FROM company_access_requests WHERE id=? AND decision IS NULL)`).bind(hash,r.company_id,now+86400000,crypto.randomUUID(),r.username,r.company_id,r.company_id,now,i.requestId),
   db.prepare("UPDATE company_access_requests SET decision='approved',decision_note=?,invite_hash=?,invite_token=?,decided_by=?,decided_at=? WHERE id=? AND decision IS NULL AND EXISTS(SELECT 1 FROM staff_invites WHERE hash=?)").bind(i.note,hash,encrypted,user.id,now,i.requestId,hash),
  ])
  if(!inserted.meta.changes)return reply({error:'All five seats are occupied or reserved, or the request changed. Free a seat before approval.'},409)
  return reply({ok:true})
 }
 return reply({error:'Unknown access request action.'},400)
}
