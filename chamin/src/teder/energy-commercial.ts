import {z} from 'zod'
import type {Bindings} from './security'
import type {Actor} from './access'
import {canTrade} from './access'
import type {EnergyCase} from './energy-products'
import { commission, currencies } from './money'
const text=(max=2000)=>z.string().trim().min(1).max(max)
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}})
export async function commercialAction(action:string,body:unknown,env:Bindings,user:Actor,e:EnergyCase):Promise<Response|null> {
 const actions=['energyTerms','energyAcceptMandate','energyShortlist','energyDisclose','energyNormalize','energyCost','energyLot','energyLotReview','energyCancelProposal','energyCancelDecision','energyRevise','energyRepeat','energyLotCorrect','energyComplete','energyWithdrawOffer','energyConfirmOffer']
 if(!actions.includes(action))return null
 const db=env.DB,now=Date.now(),operator=!!user.bunker_operator,owner=e.company_id===user.company_id
 const selected=e.selected_offer?await db.prepare('SELECT company_id FROM energy_offers WHERE id=? AND case_id=?').bind(e.selected_offer,e.id).first<{company_id:string}>():null
 const seller=selected?.company_id===user.company_id
 if(!operator&&!canTrade(user,'request')&&!canTrade(user,'offer'))return reply({error:'Current verified trading authority is required.'},403)
 const {revision}=z.object({revision:z.number().int()}).parse(body)
 if(revision!==e.revision)return reply({error:'This case changed. Refresh before proceeding.'},409)
 const active=!['closed','cancelled'].includes(e.state)
 if(!active&&!['energyRepeat','energyCost'].includes(action))return reply({error:'Case is closed.'},409)
 async function update(fields:Record<string,string|number|null>,note:string,extra:(guard:string)=>D1PreparedStatement[]=()=>[]) {
  fields.last_actor=user.id;fields.last_note=note;fields.updated_at=now
  const guard=`EXISTS(SELECT 1 FROM energy_cases WHERE id='${e.id}' AND revision=${revision+1} AND last_actor='${user.id}' AND updated_at=${now})`
  const [changed]=await db.batch([db.prepare(`UPDATE energy_cases SET ${Object.keys(fields).map(k=>k+'=?').join(',')},revision=revision+1 WHERE id=? AND revision=?`).bind(...Object.values(fields),e.id,revision),...extra(guard)])
  if(!changed.meta.changes)return reply({error:'Case changed. Refresh before proceeding.'},409)
  return reply({ok:true})
 }
 if(action==='energyTerms') {
  if(!operator||e.selected_offer)return reply({error:'Operations sets fee terms before binding selection.'},403)
  const i=z.object({payer:z.enum(['buyer','seller']),basis:text(700),currency:z.enum(currencies),terms:text(3000)}).parse(body)
  return update({fee_revision:e.fee_revision+1,fee_payer:i.payer,fee_basis:i.basis,fee_currency:i.currency,fee_terms:i.terms,buyer_fee_revision:null,next_action:'Both parties accept the current fee and introduction terms before disclosure'},'Teder proposed a versioned 2% fee and introduction agreement.')
 }
 if(action==='energyAcceptMandate') {
  if(!e.fee_terms||e.fee_revision<1)return reply({error:'Teder must propose the specific fee and introduction agreement first.'},409)
  const i=z.object({accept:z.literal(true)}).parse(body)
  void i
  if(!canTrade(user,'accept'))return reply({error:'Contract acceptance permission is required.'},403)
  const invitation=await db.prepare('SELECT 1 FROM energy_invitations WHERE case_id=? AND company_id=? AND revoked_at IS NULL').bind(e.id,user.company_id).first()
  if(!owner&&!invitation)return reply({error:'Only the mandate owner or invited counterparty can accept.'},403)
  const agreement=JSON.stringify({commissionBps:200,payer:e.fee_payer,basis:e.fee_basis,currency:e.fee_currency,terms:e.fee_terms,revision:e.fee_revision})
  return update(owner?{buyer_fee_revision:e.fee_revision}:{},'A trading party accepted the current fee and introduction agreement.',guard=>[
   db.prepare(`INSERT INTO energy_mandate_acceptances SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT DO NOTHING`).bind(e.id,user.company_id,e.fee_revision,user.id,now,agreement),
   ...(!owner?[db.prepare(`UPDATE energy_invitations SET fee_accepted_revision=?,fee_accepted_by=?,fee_accepted_at=? WHERE case_id=? AND company_id=? AND ${guard}`).bind(e.fee_revision,user.id,now,e.id,user.company_id)]:[]),
  ])
 }
 if(action==='energyNormalize') {
  if(!operator||e.state!=='quoting')return reply({error:'Operations reviews offers during sourcing.'},403)
  const i=z.object({offerId:z.uuid(),offerRevision:z.number().int(),publicTerms:text(3000),normalizedTotalMinor:z.number().int().positive().max(9e12).nullable()}).parse(body)
  if(!await db.prepare('SELECT 1 FROM energy_offers WHERE id=? AND case_id=? AND revision=? AND expires_at>?').bind(i.offerId,e.id,i.offerRevision,now).first())return reply({error:'Quote changed or expired. Review its latest version.'},409)
  const [changed]=await db.batch([
   db.prepare(`UPDATE energy_offers SET public_terms=?,normalized_total_minor=?,normalized_by=?,normalized_at=? WHERE id=? AND case_id=? AND revision=? AND expires_at>?
    AND supplier_confirmed_at IS NOT NULL AND sourcing_revision=? AND EXISTS(SELECT 1 FROM energy_cases WHERE id=? AND revision=? AND state='quoting')`).bind(i.publicTerms,i.normalizedTotalMinor,user.id,now,i.offerId,e.id,i.offerRevision,now,e.sourcing_revision,e.id,revision),
   db.prepare(`UPDATE energy_cases SET revision=revision+1,last_actor=?,last_note='Teder published a reviewed commercial comparison.',updated_at=? WHERE id=? AND revision=? AND changes()=1`).bind(user.id,now,e.id,revision),
  ])
  if(!changed.meta.changes)return reply({error:'Quote changed, expired or still awaits supplier confirmation.'},409)
  return reply({ok:true})
 }
 if(action==='energyShortlist'||action==='energyDisclose') {
  const i=z.object({offerId:z.uuid()}).parse(body)
  const offer=await db.prepare(`SELECT o.company_id,o.public_terms,i.shortlisted_at,i.fee_accepted_revision,o.supplier_confirmed_at FROM energy_offers o JOIN energy_invitations i ON i.case_id=o.case_id AND i.company_id=o.company_id WHERE o.id=? AND o.case_id=? AND o.expires_at>? AND o.sourcing_revision=? AND o.supplier_confirmed_at IS NOT NULL AND i.revoked_at IS NULL`).bind(i.offerId,e.id,now,e.sourcing_revision).first<{company_id:string;public_terms:string|null;shortlisted_at:number|null;fee_accepted_revision:number|null}>()
  if(!offer||e.state!=='quoting')return reply({error:'Choose a current quote while sourcing is open.'},409)
  if(action==='energyShortlist') {
   if(!owner||!canTrade(user,'request')||!offer.public_terms)return reply({error:'The buyer shortlists a reviewed offer.'},403)
   return update({next_action:'Teder coordinates identity disclosure for the shortlist'},'The buyer shortlisted an offer for counterparty checks.',guard=>[db.prepare(`UPDATE energy_invitations SET shortlisted_at=? WHERE case_id=? AND company_id=? AND ${guard}`).bind(now,e.id,offer.company_id)])
  }
  if(!operator||!offer.shortlisted_at||e.buyer_fee_revision!==e.fee_revision||offer.fee_accepted_revision!==e.fee_revision)return reply({error:'A shortlist and both parties’ acceptance of the current fee agreement are required before disclosure.'},409)
  return update({next_action:'Counterparties complete credit, sanctions and authority checks before binding acceptance'},'Teder disclosed shortlisted counterparty identities under accepted introduction terms.',guard=>[db.prepare(`UPDATE energy_invitations SET disclosed_at=? WHERE case_id=? AND company_id=? AND ${guard}`).bind(now,e.id,offer.company_id)])
 }
 if(action==='energyCost') {
  if(!operator)return reply({error:'Operations access required.'},403)
  const i=z.object({minutes:z.number().int().nonnegative().max(1e6),costMinor:z.number().int().nonnegative().max(9e12),note:text()}).parse(body)
  return update({operating_minutes:i.minutes,operating_cost_minor:i.costMinor},'Operations recorded time and external cost: '+i.note)
 }
 if(action==='energyRevise') {
  if((!owner&&!operator)||e.selected_offer)return reply({error:'The owner or Teder can revise sourcing before selection.'},403)
  const i=z.object({validUntil:z.number().int(),quantity:text(100),window:text(200),specification:text(3000),deliveryTerms:text(1500),credit:text(1500),masterAgreement:text(1000)}).parse(body)
  if(i.validUntil<=now)return reply({error:'Choose a future deadline.'},400)
  const details={...JSON.parse(e.details),...i}
  return update({details:JSON.stringify(details),state:'checking',blind_brief:null,route_note:null,route_checks:null,next_action:'Teder rechecks the revised requirement before new quotes',buyer_fee_revision:null,fee_revision:e.fee_revision+1,sourcing_revision:e.sourcing_revision+1},'Sourcing requirements were revised. Prior offers and disclosure approvals require a fresh review.',guard=>[db.prepare(`UPDATE energy_invitations SET revoked_at=unixepoch()*1000,fee_accepted_revision=NULL,shortlisted_at=NULL WHERE case_id=? AND ${guard}`).bind(e.id)])
 }
 if(action==='energyConfirmOffer') {
  if(!canTrade(user,'offer')||e.state!=='quoting')return reply({error:'The invited supplier confirms its own offer during sourcing.'},403)
  const i=z.object({offerId:z.uuid(),offerRevision:z.number().int(),accept:z.literal(true)}).parse(body)
  const changed=await db.prepare(`UPDATE energy_offers SET supplier_confirmed_at=? WHERE id=? AND case_id=? AND company_id=? AND revision=? AND sourcing_revision=? AND expires_at>?`).bind(now,i.offerId,e.id,user.company_id,i.offerRevision,e.sourcing_revision,now).run()
  if(!changed.meta.changes)return reply({error:'Offer is unavailable or changed.'},409)
  return update({},'Supplier explicitly confirmed its assisted quotation.')
 }
 if(action==='energyWithdrawOffer') {
  if(!canTrade(user,'offer')||e.selected_offer||e.state!=='quoting')return reply({error:'The supplier withdraws its own offer before selection.'},403)
  const i=z.object({offerId:z.uuid(),note:text()}).parse(body)
  return update({},'A supplier withdrew its offer: '+i.note,guard=>[db.prepare(`UPDATE energy_offers SET expires_at=?,public_terms=NULL,revision=revision+1 WHERE id=? AND case_id=? AND company_id=? AND ${guard}`).bind(now,i.offerId,e.id,user.company_id)])
 }
 if(action==='energyComplete') {
  if(!owner||!canTrade(user,'accept')||!e.selected_offer||e.state==='exception'||e.cancellation_proposed_by)return reply({error:'The authorized buyer completes an agreed mandate after outstanding exceptions are resolved.'},403)
  const counts=await db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN payment_state IN ('paid','refunded') AND accepted_at IS NOT NULL THEN 1 ELSE 0 END) complete,SUM(provider_fee_minor) net_fee FROM energy_delivery_lots WHERE case_id=?`).bind(e.id).first<{total:number;complete:number;net_fee:number}>()
  if(!counts?.total||counts.total!==counts.complete)return reply({error:'All reported delivery instalments must be accepted and provider-paid, including commission.'},409)
  return update({state:'closed',fee_received:counts.net_fee>0?1:0,next_action:'Mandate completed · a repeat requirement creates a new case'},'Buyer confirmed the mandate is complete; provider records confirm all instalments and commission.')
 }
 if(action==='energyLotCorrect') {
  if(!seller||e.state!=='exception')return reply({error:'The contracted supplier corrects a disputed instalment.'},403)
  const i=z.object({lotId:z.uuid(),description:text(500),quantity:text(100),evidence:text(1500),grossMinor:z.number().int().positive().max(9e12),note:text()}).parse(body)
  const lot=await db.prepare("SELECT 1 FROM energy_delivery_lots WHERE id=? AND case_id=? AND rejected_note IS NOT NULL AND payment_state='awaiting_provider'").bind(i.lotId,e.id).first()
  if(!lot)return reply({error:'Only an unpaid disputed instalment can be corrected.'},409)
  return update({state:e.resume_state||'contracted',resume_state:null,next_action:'Buyer reviews the corrected delivery instalment'},'Supplier corrected a disputed instalment: '+i.note,guard=>[db.prepare(`UPDATE energy_delivery_lots SET description=?,quantity=?,evidence_ref=?,gross_minor=?,commission_minor=?,reported_at=?,rejected_note=NULL WHERE id=? AND case_id=? AND ${guard}`).bind(i.description,i.quantity,i.evidence,i.grossMinor,commission(i.grossMinor),now,i.lotId,e.id)])
 }
 if(action==='energyLot') {
  if(!seller||!['contracted','delivery_review','delivered','paid'].includes(e.state))return reply({error:'The contracted supplier reports delivery instalments.'},403)
  const i=z.object({requestKey:z.uuid(),description:text(500),quantity:text(100),evidence:text(1500),grossMinor:z.number().int().positive().max(9e12),currency:z.enum(currencies)}).parse(body)
  if(i.currency!==e.fee_currency)return reply({error:'Use the agreed fee-basis currency. Agree any conversion separately.'},400)
  const existing=await db.prepare('SELECT id FROM energy_delivery_lots WHERE id=? AND case_id=?').bind(i.requestKey,e.id).first()
  if(existing)return reply(existing)
  const fee=commission(i.grossMinor)
  return update({fee_received:0,next_action:'Buyer reviews a reported delivery instalment'},'Supplier reported a delivery instalment; quantity and value await buyer acceptance.',guard=>[db.prepare(`INSERT INTO energy_delivery_lots(id,case_id,sequence,description,quantity,evidence_ref,reported_by,reported_at,gross_minor,currency,commission_minor)
   SELECT ?,?,COALESCE((SELECT MAX(sequence)+1 FROM energy_delivery_lots WHERE case_id=?),1),?,?,?,?,?,?,?,? WHERE ${guard}`).bind(i.requestKey,e.id,e.id,i.description,i.quantity,i.evidence,user.id,now,i.grossMinor,i.currency,fee)])
 }
 if(action==='energyLotReview') {
  if(!owner||!canTrade(user,'accept'))return reply({error:'The authorized buyer reviews delivery instalments.'},403)
  const i=z.object({lotId:z.uuid(),result:z.enum(['accepted','disputed']),note:text()}).parse(body)
  const lot=await db.prepare('SELECT id FROM energy_delivery_lots WHERE id=? AND case_id=? AND accepted_at IS NULL AND rejected_note IS NULL').bind(i.lotId,e.id).first()
  if(!lot)return reply({error:'Delivery was already reviewed. Refresh.'},409)
  return update(i.result==='disputed'?{resume_state:e.state,state:'exception',next_action:'Resolve delivery instalment discrepancy'}:{next_action:'Accepted delivery value is ready for provider-managed payment'},`Buyer ${i.result} a delivery instalment: ${i.note}`,guard=>[db.prepare(`UPDATE energy_delivery_lots SET accepted_by=?,accepted_at=?,rejected_note=? WHERE id=? AND case_id=? AND ${guard}`).bind(i.result==='accepted'?user.id:null,i.result==='accepted'?now:null,i.result==='disputed'?i.note:null,i.lotId,e.id)])
 }
 if(action==='energyCancelProposal') {
  if((!owner&&!seller)||!e.selected_offer)return reply({error:'A contracted party proposes cancellation.'},403)
  const {note}=z.object({note:text()}).parse(body)
  return update({cancellation_proposed_by:user.id,cancellation_note:note,next_action:'Other party responds to cancellation proposal'},'A party proposed cancellation: '+note)
 }
 if(action==='energyCancelDecision') {
  if((!owner&&!seller)||!canTrade(user,'accept')||!e.cancellation_proposed_by)return reply({error:'A current cancellation proposal is required.'},409)
  const proposer=await db.prepare('SELECT company_id FROM users WHERE id=?').bind(e.cancellation_proposed_by).first<{company_id:string}>()
  if(proposer?.company_id===user.company_id)return reply({error:'The other company must respond to cancellation.'},403)
  const i=z.object({accept:z.boolean(),note:text()}).parse(body)
  return update({state:i.accept?'cancelled':e.state,cancellation_proposed_by:null,cancellation_note:i.note,next_action:i.accept?'Cancellation agreed; outstanding refunds and fees remain visible':'Cancellation declined; continue under the agreement'},`Other party ${i.accept?'accepted':'declined'} cancellation: ${i.note}`)
 }
 if(action==='energyRepeat') {
  if(!owner||user.workspace_kind!=='customer')return reply({error:'The mandate owner creates a repeat requirement.'},403)
  const id=crypto.randomUUID(),details={...JSON.parse(e.details),requestKey:id,validUntil:now+7*86400000}
  await db.prepare(`INSERT INTO energy_cases(id,company_id,created_by,side,product,country,delivery_point,title,details,last_actor,last_note,updated_at,created_at,workflow_version)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,2)`).bind(id,user.company_id,user.id,e.side,e.product,e.country,e.delivery_point,e.title+' · repeat',JSON.stringify(details),user.id,'New independent mandate copied from '+e.id,now,now).run()
  return reply({id},201)
 }
 return reply({error:'Unknown commercial action.'},400)
}
