import { commercialAction } from './energy-commercial'
import { currencies } from './money'
import { canTrade } from './access'
import { z } from 'zod'
import { supportsJurisdiction } from './registries'
import type { Bindings } from './security'
import type { Actor } from './access'
import type { EnergyCase } from './energy-products'
const text = (max=1500) => z.string().trim().min(1).max(max)
const products = z.enum(['gas','oil','coal','power','flexibility'])
class EnergyFailure extends Error { constructor(message:string, public status=400) { super(message) } }
export async function energyApi(action:string, body:unknown, env:Bindings, user:Actor) {
 try {
  const db=env.DB, now=Date.now(), operator=!!user.bunker_operator
  const stmt=(sql:string,...values:(string|number|null)[])=>db.prepare(sql).bind(...values)
  const all=async(sql:string,...values:(string|number|null)[])=>(await stmt(sql,...values).all()).results
  const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
  const fail=(message:string,status=400):never=>{throw new EnergyFailure(message,status)}
  if(action==='energyList') {
   const rows=await all(`SELECT e.*,c.name company_name,i.disclosed_at FROM energy_cases e JOIN companies c ON c.id=e.company_id
    LEFT JOIN energy_invitations i ON i.case_id=e.id AND i.company_id=?
    WHERE ?=1 OR e.company_id=? OR (i.company_id IS NOT NULL AND i.revoked_at IS NULL) ORDER BY e.updated_at DESC LIMIT 200`,user.company_id,Number(operator),user.company_id)
   return result({cases:rows.map(row=>operator||row.company_id===user.company_id?row:{id:row.id,side:row.side,product:row.product,country:row.country,delivery_point:row.disclosed_at?row.delivery_point:'See private brief',title:row.disclosed_at||row.workflow_version===1?row.title:'Private '+row.product+' requirement',state:row.state,next_action:'Review your private invitation',updated_at:row.updated_at})})
  }
  if(action==='energyCreate') {
   if(user.role==='viewer') fail('Your company role cannot submit cases.',403)
   if(user.workspace_kind!=='customer') fail('Use a customer company account.',403)
   const i=z.object({requestKey:z.uuid(),side:z.enum(['buy','sell']),product:products,country:z.string().refine(supportsJurisdiction),deliveryPoint:text(200),title:text(160),
    quantity:text(100),window:text(200),specification:text(3000),deliveryTerms:text(1500),contact:z.email().max(254),credit:text(1500),masterAgreement:text(1000),mandateReference:text(500),consent:z.literal(true),validUntil:z.number().int().positive()}).parse(body)
   if(i.validUntil<=now) fail('Choose a future response or availability deadline.')
   await stmt(`INSERT INTO energy_cases(id,company_id,created_by,side,product,country,delivery_point,title,details,last_actor,last_note,updated_at,created_at,workflow_version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,2) ON CONFLICT(id) DO NOTHING`,i.requestKey,user.company_id,user.id,i.side,i.product,i.country.toUpperCase(),i.deliveryPoint,i.title,JSON.stringify(i),user.id,'Submitted with permission for Teder to approach relevant counterparties.',now,now).run()
   const own=await stmt('SELECT id FROM energy_cases WHERE id=? AND company_id=?',i.requestKey,user.company_id).first()
   if(!own) fail('Submission reference is already in use.',409)
   return result({id:i.requestKey},201)
  }
  if(action==='energyMetrics') {
   if(!operator) fail('Operations access required.',403)
   return result({routes:await all(`SELECT product,country,state,COUNT(*) cases,SUM(fee_received) fees_received,SUM(operating_minutes) operating_minutes,SUM(operating_cost_minor) operating_cost_minor FROM energy_cases GROUP BY product,country,state`),
    repeat:await all(`SELECT c.name,COUNT(*) completed FROM energy_cases e JOIN companies c ON c.id=e.company_id WHERE fee_received=1 AND state='closed' GROUP BY e.company_id HAVING COUNT(*)>1`)})
  }
  const input=z.object({caseId:z.uuid()}).passthrough().parse(body)
  const row=await stmt('SELECT e.*,c.name company_name FROM energy_cases e JOIN companies c ON c.id=e.company_id WHERE e.id=?',input.caseId).first<EnergyCase>()
  if(!row) fail('Case not found.',404)
  const e=row!, owner=e.company_id===user.company_id
  const invited=!!await stmt('SELECT 1 FROM energy_invitations WHERE case_id=? AND company_id=? AND revoked_at IS NULL',e.id,user.company_id).first()
  if(!operator&&!owner&&!invited) fail('Case not found.',404)
  if(!operator&&user.status!=='approved'&&!owner) fail('Company approval is required.',403)
  const offers=await all(`SELECT o.*,c.name company_name,i.shortlisted_at,i.disclosed_at,i.fee_accepted_revision FROM energy_offers o JOIN companies c ON c.id=o.company_id
   JOIN energy_invitations i ON i.case_id=o.case_id AND i.company_id=o.company_id WHERE i.revoked_at IS NULL AND o.sourcing_revision=(SELECT sourcing_revision FROM energy_cases WHERE id=o.case_id) AND o.case_id=? AND (?=1 OR o.company_id=?) ORDER BY o.created_at,o.id`,e.id,Number(operator||owner),user.company_id)
  if(action==='energyDetail') {
   const invitation=await stmt('SELECT * FROM energy_invitations WHERE case_id=? AND company_id=? AND revoked_at IS NULL',e.id,user.company_id).first<{disclosed_at:number|null;fee_accepted_revision:number|null}>()
   const selectedParty=e.selected_offer?await stmt('SELECT 1 FROM energy_offers WHERE id=? AND company_id=?',e.selected_offer,user.company_id).first():null
   const fullAccess=operator||owner||!!selectedParty
   const identityVisible=e.workflow_version===1||!!invitation?.disclosed_at
   const original=JSON.parse(e.details)
   const visibleRecord=fullAccess?e:{...e,company_name:identityVisible?e.company_name:'Verified buyer',title:identityVisible?e.title:'Private '+e.product+' requirement',delivery_point:identityVisible?e.delivery_point:'See Teder brief',details:JSON.stringify(identityVisible?{...original,contact:'Contact your introduced representative'}:{quantity:'See Teder brief',window:'See Teder brief',specification:e.blind_brief||'Teder is preparing the private brief.',deliveryTerms:'See Teder brief',validUntil:original.validUntil,contact:'Contact Teder',credit:'See private brief'}),contract_ref:null,security_ref:null,delivery_ref:null,invoice_ref:null,payment_ref:null,fee_ref:null,fee_payment_ref:null,fee_terms:e.workflow_version===1?null:e.fee_terms,route_note:null,route_checks:null}
   const visibleOffers=offers.map((offer,index)=>{
    if(operator||offer.company_id===user.company_id||e.workflow_version===1)return offer
    return {...offer,company_name:offer.disclosed_at?offer.company_name:'Supplier '+(index+1),terms:offer.public_terms||'Awaiting Teder commercial review',structured_terms:offer.disclosed_at?offer.structured_terms:null}
   })
   return result({record:visibleRecord,offers:visibleOffers,invitation,canUpload:fullAccess,events:await all('SELECT note,occurred_at FROM energy_events WHERE case_id=? AND (?=1 OR actor_id=?) ORDER BY id DESC LIMIT 150',e.id,Number(fullAccess),user.id),
    versions:await all(`SELECT v.offer_id,v.revision,v.snapshot,v.created_at FROM energy_offer_versions v JOIN energy_offers o ON o.id=v.offer_id WHERE v.case_id=? AND (?=1 OR o.company_id=?) ORDER BY v.created_at DESC LIMIT 100`,e.id,Number(operator),user.company_id),
    lots:fullAccess?await all('SELECT * FROM energy_delivery_lots WHERE case_id=? ORDER BY sequence',e.id):[],
    companies:operator||e.workflow_version===1&&owner?await all(`SELECT id,name FROM companies WHERE status='approved' AND workspace_kind='customer' AND id<>? LIMIT 300`,e.company_id):[],
    matches:operator||owner?await all(`SELECT s.id,s.product,s.country,CASE WHEN ?=1 THEN s.delivery_point ELSE 'Route to be confirmed' END delivery_point,
      CASE WHEN ?=1 THEN s.title ELSE 'Potential supply match' END title,CASE WHEN ?=1 THEN c.name ELSE 'Verified supplier' END company_name
     FROM energy_cases s JOIN companies c ON c.id=s.company_id WHERE s.side<>? AND s.product=? AND s.country=? AND s.company_id<>? AND s.state='available' AND c.status='approved'
     AND CAST(json_extract(s.details,'$.validUntil') AS INTEGER)>? LIMIT 30`,Number(operator),Number(operator),Number(operator),e.side,e.product,e.country,e.company_id,now):[]})
  }
  const commercial=await commercialAction(action,body,env,user,e)
  if(commercial)return commercial
  if(user.role==='viewer'||user.role==='applicant') fail('Current verified trading authority is required.',403)
  if(!operator&&user.status!=='approved'&&action!=='energyDetail') fail('Company approval is required for trading actions.',403)
  const active=!['closed','cancelled'].includes(e.state)
  if(!active) fail('This case is closed.',409)
  if(action==='energyInvite') {
   if(!owner&&!operator) fail('Only the case owner or Teder can invite a counterparty.',403)
   if(e.workflow_version===2&&!operator) fail('Ask Teder to coordinate the confidential supplier invitations.',403)
   if(e.side!=='buy'||e.state!=='quoting'||!e.route_note) fail('Teder must clear the route before supplier invitations.',409)
   const i=z.object({companyId:z.uuid()}).parse(body)
   if(i.companyId===e.company_id||!await stmt("SELECT 1 FROM companies WHERE id=? AND status='approved' AND workspace_kind='customer'",i.companyId).first()) fail('Choose an approved counterparty.')
   await db.batch([stmt('INSERT INTO energy_invitations(case_id,company_id,invited_at) VALUES(?,?,?) ON CONFLICT(case_id,company_id) DO UPDATE SET revoked_at=NULL,invited_at=excluded.invited_at',e.id,i.companyId,now),stmt('INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(?,?,?,?)',e.id,user.id,'Supplier invited to quote privately.',now)])
   return result({ok:true})
  }
  if(action==='energyQuote'||action==='energyAssistedQuote') {
   const assisted=action==='energyAssistedQuote'
   if(e.state!=='quoting'||JSON.parse(e.details).validUntil<=now) fail('The sourcing window is closed.',409)
   const i=z.object({supplierId:z.uuid().optional(),totalMinor:z.number().int().positive().max(9e12),structuredTerms:text(3000),amount:z.number().finite().positive().max(1e12),currency:z.enum(currencies),unit:text(80),terms:text(3000),expiresAt:z.number().int()}).parse(body)
   if(assisted&&!operator)fail('Only Teder operations can transcribe an externally supplied offer.',403)
   if(!assisted&&(!invited||owner||!canTrade(user,'offer')))fail('An invited authorized supplier submits its own offer.',403)
   const supplier=assisted?i.supplierId:user.company_id
   if(!supplier||!await stmt(`SELECT 1 FROM energy_invitations i JOIN companies c ON c.id=i.company_id WHERE i.case_id=? AND i.company_id=? AND i.revoked_at IS NULL AND c.status='approved' AND (?=1 OR i.fee_accepted_revision=?)`,e.id,supplier,e.workflow_version===1?1:0,e.fee_revision).first())fail('The supplier invitation and current fee acceptance are required.',409)
   if(i.expiresAt<=now)fail('Quote expiry must be in the future.')
   const quoteResult=await db.batch([stmt(`INSERT INTO energy_offers(id,case_id,company_id,amount,currency,unit,terms,expires_at,created_at,total_minor,structured_terms,entered_by,supplier_confirmed_at,sourcing_revision)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM energy_cases WHERE id=? AND state='quoting' AND sourcing_revision=?)
    ON CONFLICT(case_id,company_id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,unit=excluded.unit,terms=excluded.terms,expires_at=excluded.expires_at,total_minor=excluded.total_minor,structured_terms=excluded.structured_terms,entered_by=excluded.entered_by,supplier_confirmed_at=excluded.supplier_confirmed_at,sourcing_revision=excluded.sourcing_revision,public_terms=NULL,normalized_total_minor=NULL,normalized_by=NULL,normalized_at=NULL,revision=energy_offers.revision+1`,crypto.randomUUID(),e.id,supplier!,i.amount,i.currency,i.unit,i.terms,i.expiresAt,now,i.totalMinor,i.structuredTerms,user.id,assisted?null:now,e.sourcing_revision,e.id,e.sourcing_revision),
    stmt(`INSERT INTO energy_events(case_id,actor_id,note,occurred_at) SELECT ?,?,?,? WHERE changes()=1`,e.id,user.id,assisted?'Teder transcribed an offer; supplier confirmation is required.':'A supplier submitted or revised its private quote.',now)])
   if(!quoteResult[0].meta.changes)fail('Sourcing changed. Refresh this case.',409)
   return result({ok:true})
  }
  if(action!=='energyChange') fail('Unknown energy action.')
  const i=z.object({revision:z.number().int(),change:z.enum(['triage','clear','select','contract','sign','delivery','acceptDelivery','invoice','payment','receipt','fee','feePayment','feeReceipt','exception','resolve','cancel']),note:text(3500),reference:z.string().trim().max(1500).optional(),offerId:z.uuid().optional(),offerRevision:z.number().int().optional(),blindBrief:z.string().trim().max(4000).optional(),routeChecks:z.string().trim().max(5000).optional(),nextAt:z.number().int().optional()}).parse(body)
  const selected=e.selected_offer?await stmt('SELECT * FROM energy_offers WHERE id=? AND case_id=?',e.selected_offer,e.id).first<{company_id:string;expires_at:number}>():null
  const seller=selected?.company_id===user.company_id
  const fields:Record<string,string|number|null>={}
  const ref=()=>i.reference||fail('Supply an evidence or agreement reference.')
  switch(i.change) {
   case 'triage':
    if(!operator) fail('Operations access required.',403)
    fields.operator_id=user.id; fields.next_action=i.note; fields.next_at=i.nextAt??null; break
   case 'clear':
    if(!operator||!e.operator_id||!['submitted','checking'].includes(e.state)) fail('Assign an operator before clearing the route.',409)
    if(!await stmt("SELECT 1 FROM companies WHERE id=? AND status='approved'",e.company_id).first()) fail('Company approval is required before opening execution.')
    if(e.workflow_version===2&&(!i.blindBrief||!i.routeChecks)) fail('Record a non-identifying tender brief and the completed route/credit/legal checklist.')
    fields.blind_brief=i.blindBrief??null;fields.route_checks=i.routeChecks??null;
    fields.route_note=i.note; fields.state=e.side==='sell'?'available':'quoting'; fields.next_action=e.side==='sell'?'Available for relevant buyer introductions':'Invite suppliers and obtain quotes';break
   case 'select': {
    if(!canTrade(user,'accept')) fail('Contract acceptance permission is required.',403)
    if(e.workflow_version===2&&!await stmt(`SELECT 1 FROM energy_offers o JOIN energy_invitations i ON i.case_id=o.case_id AND i.company_id=o.company_id WHERE o.id=? AND o.case_id=? AND i.disclosed_at IS NOT NULL AND i.fee_accepted_revision=? AND o.public_terms IS NOT NULL AND o.supplier_confirmed_at IS NOT NULL AND o.sourcing_revision=(SELECT sourcing_revision FROM energy_cases WHERE id=o.case_id)`,i.offerId??'',e.id,e.fee_revision).first()) fail('Shortlist, agreed fee terms, identity disclosure and reviewed offer are required before selection.',409)
    if(e.workflow_version===2&&e.buyer_fee_revision!==e.fee_revision) fail('Accept the current fee agreement before selection.',409)
    if(!owner||e.side!=='buy'||e.state!=='quoting') fail('The buyer selects a current offer.',403)
    const offer=await stmt(`SELECT o.id FROM energy_offers o JOIN companies c ON c.id=o.company_id WHERE o.id=? AND o.case_id=? AND o.expires_at>? AND o.revision=? AND c.status='approved'`,i.offerId??'',e.id,now,i.offerRevision??-1).first()
    if(!offer) fail('Offer is missing, expired, or supplier approval changed.',409)
    fields.selected_offer=i.offerId!;fields.state='contracting';fields.next_action='Agree contract, payment security and Teder fee terms';break
   }
   case 'contract':
    if(!operator||e.state!=='contracting'||e.buyer_signed||e.seller_signed) fail('Contract setup is available to operations before signatures.',409)
    fields.contract_ref=ref();fields.security_ref=i.note;if(e.workflow_version===1)fields.fee_terms=i.note;break
   case 'sign':
    if(!canTrade(user,'accept')) fail('Contract acceptance permission is required.',403)
    if((!owner&&!seller)||e.state!=='contracting'||!e.contract_ref||!e.security_ref||!e.fee_terms) fail('Both parties must review recorded contract, security and fee terms.',409)
    if(owner) fields.buyer_signed=1; else fields.seller_signed=1
    if((owner&&e.seller_signed)||(seller&&e.buyer_signed)) {fields.state='contracted';fields.next_action='Track agreed delivery milestones'}
    break
   case 'delivery':
    if(!seller||!['contracted','delivery_review'].includes(e.state)) fail('The selected supplier reports delivery after both parties accept terms.',403)
    fields.delivery_ref=ref();fields.delivery_accepted=0;fields.state='delivery_review';fields.next_action='Buyer reviews delivery evidence';break
   case 'acceptDelivery':
    if(!owner||e.state!=='delivery_review'||!e.delivery_ref) fail('Buyer acceptance requires a delivery report.',409)
    fields.delivery_accepted=1;fields.state='delivered';fields.next_action='Reconcile invoice and payment';break
   case 'invoice':
    if(!seller||e.state!=='delivered'||e.payment_ref) fail('Supplier records invoice after accepted delivery and before payment.',409)
    fields.invoice_ref=ref();break
   case 'payment':
    if(e.workflow_version===2) fail('Use the provider-managed instalment payment flow.',409)
    if(!owner||e.state!=='delivered'||!e.invoice_ref||e.payment_received) fail('Buyer reports payment against the recorded invoice.',409)
    fields.payment_ref=ref();break
   case 'receipt':
    if(e.workflow_version===2) fail('Payment receipt is confirmed by the provider.',409)
    if(!seller||e.state!=='delivered'||!e.payment_ref) fail('Supplier confirms actual receipt against a reported payment.',409)
    fields.payment_received=1;fields.state='paid';fields.next_action='Reconcile Teder service fee';break
   case 'fee':
    if(e.workflow_version===2) fail('This mandate uses provider-managed commission allocation per accepted delivery.',409)
    if(!operator||e.state!=='paid'||!e.fee_terms||e.fee_payment_ref) fail('Operations issues the agreed fee after payment reconciliation.',409)
    fields.fee_ref=ref();break
   case 'feePayment':
    if(e.workflow_version===2) fail('Commission is confirmed by the payment provider.',409)
    if((!owner&&!seller)||!e.fee_ref||e.fee_received) fail('A trading party reports payment against the Teder fee invoice.',409)
    fields.fee_payment_ref=ref();break
   case 'feeReceipt':
    if(e.workflow_version===2) fail('Commission is confirmed by a verified payment-provider event.',409)
    if(!operator||!e.fee_payment_ref||!e.payment_received) fail('Operations confirms the fee after checking actual receipt.',409)
    fields.fee_received=1;fields.state='closed';fields.next_action='Completed · request a new sourcing mandate';break
   case 'exception':
    if(!operator&&!owner&&!seller) fail('Only trading parties or operations can open an exception.',403)
    if(e.state==='exception') fail('Resolve the current exception first.',409)
    fields.resume_state=e.state;fields.state='exception';fields.next_action=`Resolve exception from ${e.state}: ${i.note}`;break
   case 'resolve':
    if(!operator||e.state!=='exception') fail('Operations resolves an exception with evidence.',403)
    ref();fields.state=e.resume_state??e.next_action.match(/^Resolve exception from ([a-z_]+):/)?.[1]??'checking';fields.next_action=i.note;break
   case 'cancel':
    if(!owner&&!operator) fail('Only the owner or operations can close sourcing.',403)
    if(e.selected_offer) fail('For an agreed deal, open an exception and document the parties’ cancellation agreement.')
    fields.state='cancelled';fields.next_action=i.note;break
  }
  fields.last_actor=user.id;fields.last_note=`${i.change}: ${i.note}${i.reference?' · '+i.reference:''}`;fields.updated_at=now
  const update=await stmt(`UPDATE energy_cases SET ${Object.keys(fields).map(k=>k+'=?').join(',')},revision=revision+1 WHERE id=? AND revision=? AND (?<>'select' OR EXISTS(SELECT 1 FROM energy_offers o JOIN companies c ON c.id=o.company_id WHERE o.id=? AND o.case_id=energy_cases.id AND o.revision=? AND o.expires_at>? AND c.status='approved')) RETURNING id`,...Object.values(fields),e.id,i.revision,i.change,i.offerId??'',i.offerRevision??-1,now).first()
  if(!update) fail('This case changed. Refresh before continuing.',409)
  return result({ok:true})
 } catch(error) {
  if(error instanceof z.ZodError) return Response.json({error:'Check the required fields and limits.'},{status:400})
  if(error instanceof EnergyFailure) return Response.json({error:error.message},{status:error.status})
  throw error
 }
}
