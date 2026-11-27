import { z } from 'zod'
import type { Bindings } from './security'
import { canTrade, tradeContext, conversationAccess } from './access'
import type { Actor } from './access'
const text=z.string().trim().min(1).max(4000)
const headers={'Cache-Control':'private, no-store'}
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers})
export async function messagesApi(action:string,body:unknown,env:Bindings,user:Actor):Promise<Response> {
 const db=env.DB,now=Date.now()
 if(action==='dmUnread') {
  const row=await db.prepare(`SELECT COUNT(*) unread FROM dm_messages m JOIN dm_conversations c ON c.id=m.conversation_id
   LEFT JOIN dm_reads r ON r.conversation_id=c.id AND r.user_id=?
   WHERE (c.user_a=? OR c.user_b=?) AND m.sender_id<>? AND m.created_at>COALESCE(r.last_read_at,0)`).bind(user.id,user.id,user.id,user.id).first()
  return reply(row)
 }
 if(action==='dmList') {
  const rows=await db.prepare(`SELECT c.id,c.kind,c.context_kind,c.context_id,c.updated_at,
   CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END peer_id,
   CASE WHEN c.kind='support' AND c.user_a=? THEN 'Teder · malka' ELSE p.username END peer_name,
   CASE WHEN c.kind='support' AND c.user_a=? THEN 'Teder Operations' ELSE co.name END company_name,
   (SELECT body FROM dm_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) preview,
   (SELECT COUNT(*) FROM dm_messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.created_at>COALESCE(r.last_read_at,0)) unread
   FROM dm_conversations c JOIN users p ON p.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END
   JOIN companies co ON co.id=p.company_id LEFT JOIN dm_reads r ON r.conversation_id=c.id AND r.user_id=?
   WHERE c.user_a=? OR c.user_b=? ORDER BY c.updated_at DESC,c.id LIMIT 200`).bind(user.id,user.id,user.id,user.id,user.id,user.id,user.id,user.id).all()
  return reply({conversations:rows.results})
 }
 if(action==='dmSupport') {
  if(user.bunker_operator) return reply({error:'Choose a customer conversation from your inbox.'},400)
  const malka=await db.prepare(`SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id JOIN bunker_operators o ON o.user_id=u.id
   WHERE u.username='malka' AND c.workspace_kind='operations' AND u.disabled_at IS NULL AND o.revoked_at IS NULL`).first<{id:string}>()
  if(!malka)return reply({error:'Teder support is temporarily unavailable. Your existing conversations remain available.'},409)
  await db.prepare(`INSERT INTO dm_conversations(id,kind,user_a,user_b,created_at,updated_at) VALUES(?,'support',?,?,?,?) ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),user.id,malka.id,now,now).run()
  const row=await db.prepare("SELECT id FROM dm_conversations WHERE kind='support' AND user_a=?").bind(user.id).first()
  return reply(row)
 }
 if(action==='dmContacts'||action==='dmOpen') {
  if(!canTrade(user,'request')&&!canTrade(user,'offer'))return reply({error:'Verified trading access is required for counterparty messages. Message Teder for help.'},403)
  const input=z.object({kind:z.enum(['energy','bunker','power']),contextId:z.uuid(),peerId:z.uuid().optional()}).parse(body)
  const pairs=await tradeContext(db,user,input.kind,input.contextId)
  const companies=[...new Set(pairs.flatMap(row=>[row.buyer_company_id,row.seller_company_id]).filter(id=>id!==user.company_id))]
  if(!companies.length)return reply({error:'Counterparty messaging becomes available after an authorized introduction.'},403)
  const placeholders=companies.map(()=>'?').join(',')
  const peers=(await db.prepare(`SELECT u.id,u.username,c.name company_name FROM users u JOIN companies c ON c.id=u.company_id
   WHERE u.company_id IN (${placeholders}) AND u.disabled_at IS NULL AND c.status='approved' AND u.role IN ('owner','trader','operator')
   AND u.authority_status IN ('verified','staff') AND (u.authority_until IS NULL OR u.authority_until>?) ORDER BY c.name,u.username`).bind(...companies,now).all<{id:string;username:string;company_name:string}>()).results
  if(action==='dmContacts')return reply({contacts:peers})
  if(!peers.some(peer=>peer.id===input.peerId))return reply({error:'Choose an active, authorized trading representative.'},403)
  const [a,b]=[user.id,input.peerId!].sort()
  await db.prepare(`INSERT INTO dm_conversations(id,kind,context_kind,context_id,user_a,user_b,created_at,updated_at)
   VALUES(?,'trade',?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),input.kind,input.contextId,a,b,now,now).run()
  return reply(await db.prepare("SELECT id FROM dm_conversations WHERE kind='trade' AND context_kind=? AND context_id=? AND user_a=? AND user_b=?").bind(input.kind,input.contextId,a,b).first())
 }
 if(action==='dmHandoverQueue') {
  if(user.role!=='owner'||!canTrade(user,'accept'))return reply({error:'Verified company owner access required.'},403)
  return reply({conversations:(await db.prepare(`SELECT c.id,c.context_kind,c.context_id,u.id prior_user_id,u.username prior_username,p.username other_username FROM dm_conversations c JOIN users u ON u.id IN(c.user_a,c.user_b) JOIN users p ON p.id=CASE WHEN c.user_a=u.id THEN c.user_b ELSE c.user_a END WHERE c.kind='trade' AND u.company_id=? AND u.disabled_at IS NOT NULL`).bind(user.company_id).all()).results,
   members:(await db.prepare("SELECT id,username FROM users WHERE company_id=? AND disabled_at IS NULL AND role IN('owner','trader','operator')").bind(user.company_id).all()).results})
 }
 if(action==='dmHandover') {
  if(user.role!=='owner'||!canTrade(user,'accept'))return reply({error:'Verified company owner access required.'},403)
  const i=z.object({conversationId:z.uuid(),priorUserId:z.uuid(),nextUserId:z.uuid()}).parse(body)
  const conversation=await db.prepare(`SELECT c.* FROM dm_conversations c JOIN users u ON u.id=? AND u.company_id=? AND u.disabled_at IS NOT NULL JOIN users n ON n.id=? AND n.company_id=u.company_id AND n.disabled_at IS NULL AND n.role IN('owner','trader','operator') WHERE c.id=? AND c.kind='trade' AND (c.user_a=u.id OR c.user_b=u.id)`).bind(i.priorUserId,user.company_id,i.nextUserId,i.conversationId).first<{user_a:string;user_b:string}>()
  if(!conversation)return reply({error:'Choose a removed representative and an active replacement from your company.'},409)
  const other=conversation.user_a===i.priorUserId?conversation.user_b:conversation.user_a
  const [a,b]=[i.nextUserId,other].sort()
  await db.batch([
   db.prepare(`UPDATE dm_conversations SET user_a=?,user_b=?,updated_at=? WHERE id=? AND (user_a=? OR user_b=?)`).bind(a,b,now,i.conversationId,i.priorUserId,i.priorUserId),
   db.prepare('INSERT INTO dm_handover_events VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),i.conversationId,i.priorUserId,i.nextUserId,user.id,now),
   db.prepare(`INSERT INTO dm_messages(id,conversation_id,sender_id,body,created_at,request_key) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),i.conversationId,i.nextUserId,'The company owner assigned this trade conversation to a replacement representative. Prior business correspondence is retained.',now,crypto.randomUUID()),
  ])
  return reply({ok:true})
 }
 const {conversationId}=z.object({conversationId:z.uuid()}).parse(body)
 const conversation=await conversationAccess(db,user,conversationId)
 if(!conversation)return reply({error:'Conversation not found or trade access has ended.'},404)
 if(conversation.kind==='trade'&&action==='dmSend') {
  const peerId=conversation.user_a===user.id?conversation.user_b:conversation.user_a
  const peer=await db.prepare(`SELECT u.disabled_at,u.role,u.authority_until,c.status FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=?`).bind(peerId).first<{disabled_at:number|null;role:string;authority_until:number|null;status:string}>()
  if(!peer||peer.disabled_at||peer.status!=='approved'||peer.role==='viewer'||peer.authority_until&&peer.authority_until<=now)return reply({error:'The counterparty needs an active authorized representative. Their company owner can assign a replacement.'},409)
  if(!canTrade(user,'offer')&&!canTrade(user,'request'))return reply({error:'Current trading authority is required to send counterparty messages.'},403)
 }
 if(action==='dmMessages') {
  const {before}=z.object({before:z.number().int().positive().optional()}).parse(body)
  const messages=(await db.prepare(`SELECT m.id,m.sender_id,u.username sender_name,m.body,m.created_at FROM dm_messages m JOIN users u ON u.id=m.sender_id
   WHERE m.conversation_id=? AND m.created_at<? ORDER BY m.created_at DESC LIMIT 51`).bind(conversationId,before??Number.MAX_SAFE_INTEGER).all<{id:string;created_at:number}>()).results
  const hasMore=messages.length>50
  const page=messages.slice(0,50)
  const attachments=page.length?(await db.prepare(`SELECT a.message_id,d.id,d.filename,d.bytes,d.mime FROM dm_attachments a JOIN private_documents d ON d.id=a.document_id
   WHERE a.message_id IN (${page.map(()=>'?').join(',')})`).bind(...page.map(m=>m.id)).all()).results:[]
  return reply({messages:page.reverse(),attachments,hasMore,nextBefore:hasMore?page[0]?.created_at:null,userId:user.id,kind:conversation.kind,contextKind:conversation.context_kind,contextId:conversation.context_id})
 }
 if(action==='dmRead') {
  const {through}=z.object({through:z.number().int().nonnegative()}).parse(body)
  await db.prepare(`INSERT INTO dm_reads VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)`)
   .bind(conversationId,user.id,Math.min(through,now)).run()
  return reply({ok:true})
 }
 if(action==='dmSend') {
  const input=z.object({requestKey:z.uuid(),message:text,documents:z.array(z.uuid()).max(6).default([])}).parse(body)
  const existing=await db.prepare('SELECT id,conversation_id,sender_id,body FROM dm_messages WHERE request_key=?').bind(input.requestKey).first<{id:string;conversation_id:string;sender_id:string;body:string}>()
  if(existing)return existing.conversation_id===conversationId&&existing.sender_id===user.id&&existing.body===input.message?reply({id:existing.id}):reply({error:'Message reference is already in use.'},409)
  if(input.documents.length) {
   const count=await db.prepare(`SELECT COUNT(*) n FROM private_documents WHERE id IN (${input.documents.map(()=>'?').join(',')}) AND scope='dm' AND scope_id=? AND uploaded_by=?`).bind(...input.documents,conversationId,user.id).first<{n:number}>()
   if(count?.n!==new Set(input.documents).size)return reply({error:'Choose your own attachments from this conversation.'},403)
  }
  const id=crypto.randomUUID()
  await db.batch([
   db.prepare(`INSERT INTO dm_messages(id,conversation_id,sender_id,body,created_at,request_key)
    SELECT ?,?,?,?,MAX(?,COALESCE((SELECT MAX(created_at)+1 FROM dm_messages WHERE conversation_id=?),0)),? ON CONFLICT(request_key) DO NOTHING`).bind(id,conversationId,user.id,input.message,now,conversationId,input.requestKey),
   ...input.documents.map(document=>db.prepare('INSERT INTO dm_attachments SELECT id,? FROM dm_messages WHERE request_key=? AND conversation_id=? AND sender_id=? AND body=? ON CONFLICT DO NOTHING').bind(document,input.requestKey,conversationId,user.id,input.message)),
  ])
  return reply(await db.prepare('SELECT id FROM dm_messages WHERE request_key=? AND conversation_id=? AND sender_id=?').bind(input.requestKey,conversationId,user.id).first(),201)
 }
 if(action==='dmReport') {
  const {reason}=z.object({reason:text}).parse(body)
  await db.prepare('INSERT INTO dm_reports(id,conversation_id,reported_by,reason,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),conversationId,user.id,reason,now).run()
  return reply({ok:true})
 }
 return reply({error:'Unknown messaging action.'},400)
}
