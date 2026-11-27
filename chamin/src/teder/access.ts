import type { Bindings } from './security'
export type Actor = {
 id:string; username?:string; company_id:string; status:string; role:string; workspace_kind:string; bunker_operator:number;
 authority_status?:string;authority_until?:number|null;can_request?:number;can_offer?:number;can_accept?:number
}
export function canTrade(user:Actor,permission:'request'|'offer'|'accept') {
 return user.status==='approved' && user.role!=='applicant' && user.role!=='viewer'
  && (!user.authority_until || user.authority_until>Date.now()) && user[`can_${permission}`]!==0
}
export async function tradeContext(db:Bindings['DB'],user:Actor,kind:string,contextId:string) {
 if(kind==='energy') {
  const row=await db.prepare(`SELECT e.company_id buyer_company_id,i.company_id seller_company_id
   FROM energy_cases e JOIN energy_invitations i ON i.case_id=e.id
   WHERE e.id=? AND (e.company_id=? OR i.company_id=?) AND i.revoked_at IS NULL AND (e.workflow_version=1 OR i.disclosed_at IS NOT NULL)`).bind(contextId,user.company_id,user.company_id).all<{buyer_company_id:string;seller_company_id:string}>()
  return row.results
 }
 if(kind==='bunker') {
  const rows=await db.prepare(`SELECT e.buyer_company_id,i.supplier_id seller_company_id FROM bunker_enquiries e JOIN bunker_invitations i ON i.enquiry_id=e.id WHERE e.id=? AND (e.buyer_company_id=? OR i.supplier_id=?)`).bind(contextId,user.company_id,user.company_id).all<{buyer_company_id:string;seller_company_id:string}>()
  return rows.results
 }
 if(kind==='power') {
  const rows=await db.prepare('SELECT buyer_id buyer_company_id,seller_id seller_company_id FROM requests WHERE id=? AND (buyer_id=? OR seller_id=?)').bind(contextId,user.company_id,user.company_id).all<{buyer_company_id:string;seller_company_id:string}>()
  return rows.results
 }
 return []
}

export async function conversationAccess(db:Bindings['DB'],user:Actor,conversationId:string) {
 const conversation=await db.prepare('SELECT * FROM dm_conversations WHERE id=? AND (user_a=? OR user_b=?)').bind(conversationId,user.id,user.id).first<{kind:string;context_kind:string;context_id:string;user_a:string;user_b:string}>()
 if(!conversation)return null
 if(conversation.kind==='support')return conversation
 const peer=await db.prepare('SELECT company_id FROM users WHERE id=?').bind(conversation.user_a===user.id?conversation.user_b:conversation.user_a).first<{company_id:string}>()
 const pairs=await tradeContext(db,user,conversation.context_kind,conversation.context_id)
 return peer&&pairs.some(p=>[p.buyer_company_id,p.seller_company_id].includes(peer.company_id))?conversation:null
}
