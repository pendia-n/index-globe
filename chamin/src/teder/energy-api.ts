import { z } from 'zod'
import { supportsJurisdiction } from './registries'
import type { Bindings } from './security'
import type { EnergyCase } from './energy-products'
const text = (max=1500) => z.string().trim().min(1).max(max)
const products = z.enum(['gas','oil','coal','power','flexibility'])
type Actor = { id:string; company_id:string; status:string; workspace_kind:string; bunker_operator:number; role:string }
class EnergyFailure extends Error { constructor(message:string, public status=400) { super(message) } }
export async function energyApi(action:string, body:unknown, env:Bindings, user:Actor) {
 try {
  const db=env.DB, now=Date.now(), operator=!!user.bunker_operator
  const stmt=(sql:string,...values:(string|number|null)[])=>db.prepare(sql).bind(...values)
  const all=async(sql:string,...values:(string|number|null)[])=>(await stmt(sql,...values).all()).results
  const result=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
  const fail=(message:string,status=400):never=>{throw new EnergyFailure(message,status)}
  if(action==='energyList') {
   return result({cases:await all(`SELECT e.*,c.name company_name FROM energy_cases e JOIN companies c ON c.id=e.company_id
    WHERE ?=1 OR e.company_id=? OR EXISTS(SELECT 1 FROM energy_invitations i WHERE i.case_id=e.id AND i.company_id=?) ORDER BY e.updated_at DESC LIMIT 200`,Number(operator),user.company_id,user.company_id)})
  }
  if(action==='energyCreate') {
   if(user.role==='viewer') fail('Your company role cannot submit cases.',403)
   if(user.workspace_kind!=='customer') fail('Use a customer company account.',403)
   const i=z.object({requestKey:z.uuid(),side:z.enum(['buy','sell']),product:products,country:z.string().refine(supportsJurisdiction),deliveryPoint:text(200),title:text(160),
    quantity:text(100),window:text(200),specification:text(3000),deliveryTerms:text(1500),contact:text(254),consent:z.literal(true),validUntil:z.number().int().positive()}).parse(body)
   if(i.validUntil<=now) fail('Choose a future response or availability deadline.')
   await stmt(`INSERT INTO energy_cases(id,company_id,created_by,side,product,country,delivery_point,title,details,last_actor,last_note,updated_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,i.requestKey,user.company_id,user.id,i.side,i.product,i.country.toUpperCase(),i.deliveryPoint,i.title,JSON.stringify(i),user.id,'Submitted with permission for Teder to approach relevant counterparties.',now,now).run()
   const own=await stmt('SELECT id FROM energy_cases WHERE id=? AND company_id=?',i.requestKey,user.company_id).first()
   if(!own) fail('Submission reference is already in use.',409)
   return result({id:i.requestKey},201)
  }
  if(action==='energyMetrics') {
   if(!operator) fail('Operations access required.',403)
   return result({routes:await all(`SELECT product,country,state,COUNT(*) cases,SUM(fee_received) fees_received FROM energy_cases GROUP BY product,country,state`),
    repeat:await all(`SELECT c.name,COUNT(*) completed FROM energy_cases e JOIN companies c ON c.id=e.company_id WHERE fee_received=1 GROUP BY e.company_id HAVING COUNT(*)>1`)})
  }
  const input=z.object({caseId:z.uuid()}).passthrough().parse(body)
  const row=await stmt('SELECT e.*,c.name company_name FROM energy_cases e JOIN companies c ON c.id=e.company_id WHERE e.id=?',input.caseId).first<EnergyCase>()
  if(!row) fail('Case not found.',404)
  const e=row!, owner=e.company_id===user.company_id
  const invited=!!await stmt('SELECT 1 FROM energy_invitations WHERE case_id=? AND company_id=?',e.id,user.company_id).first()
  if(!operator&&!owner&&!invited) fail('Case not found.',404)
  if(!operator&&user.status!=='approved'&&!owner) fail('Company approval is required.',403)
  const offers=await all(`SELECT o.*,c.name company_name FROM energy_offers o JOIN companies c ON c.id=o.company_id WHERE o.case_id=? AND (?=1 OR o.company_id=?)`,e.id,Number(operator||owner),user.company_id)
  if(action==='energyDetail') {
   const selectedParty=e.selected_offer?await stmt('SELECT 1 FROM energy_offers WHERE id=? AND company_id=?',e.selected_offer,user.company_id).first():null
   const fullAccess=operator||owner||!!selectedParty
   const visibleRecord=fullAccess?e:{...e,details:JSON.stringify({...JSON.parse(e.details),contact:'Shared through Teder'}),contract_ref:null,security_ref:null,fee_terms:null,delivery_ref:null,invoice_ref:null,payment_ref:null,fee_ref:null,fee_payment_ref:null,route_note:null}
   return result({record:visibleRecord,offers,events:await all('SELECT note,occurred_at FROM energy_events WHERE case_id=? AND (?=1 OR actor_id=?) ORDER BY id DESC LIMIT 150',e.id,Number(fullAccess),user.id),
    companies:operator||owner?await all(`SELECT id,name FROM companies WHERE status='approved' AND workspace_kind='customer' AND id<>? LIMIT 300`,e.company_id):[],
    matches:operator||owner?await all(`SELECT s.id,s.product,s.country,s.delivery_point,s.title,c.name company_name FROM energy_cases s JOIN companies c ON c.id=s.company_id
     WHERE s.side<>? AND s.product=? AND s.country=? AND s.company_id<>? AND s.state='available' AND c.status='approved'
     AND CAST(json_extract(s.details,'$.validUntil') AS INTEGER)>? LIMIT 30`,e.side,e.product,e.country,e.company_id,now):[]})
  }
  if(user.role==='viewer') fail('Your company role cannot change trades.',403)
  if(!operator&&user.status!=='approved'&&action!=='energyDetail') fail('Company approval is required for trading actions.',403)
  const active=!['closed','cancelled'].includes(e.state)
  if(!active) fail('This case is closed.',409)
  if(action==='energyInvite') {
   if(!owner&&!operator) fail('Only the case owner or Teder can invite a counterparty.',403)
   if(e.side!=='buy'||e.state!=='quoting'||!e.route_note) fail('Teder must clear the route before supplier invitations.',409)
   const i=z.object({companyId:z.uuid()}).parse(body)
   if(i.companyId===e.company_id||!await stmt("SELECT 1 FROM companies WHERE id=? AND status='approved' AND workspace_kind='customer'",i.companyId).first()) fail('Choose an approved counterparty.')
   await db.batch([stmt('INSERT INTO energy_invitations VALUES(?,?,?) ON CONFLICT DO NOTHING',e.id,i.companyId,now),stmt('INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(?,?,?,?)',e.id,user.id,'Supplier invited to quote privately.',now)])
   return result({ok:true})
  }
  if(action==='energyQuote') {
   if(!invited||owner||user.status!=='approved'||e.state!=='quoting') fail('An invited, approved supplier can quote while sourcing is open.',403)
   if(JSON.parse(e.details).validUntil<=now) fail('The sourcing deadline has passed. Ask Teder to review a new requirement.',409)
   const i=z.object({amount:z.number().finite().positive().max(1e12),currency:z.string().regex(/^[A-Z]{3}$/),unit:text(80),terms:text(3000),expiresAt:z.number().int()}).parse(body)
   if(i.expiresAt<=now) fail('Quote expiry must be in the future.')
   const quoteResult=await db.batch([stmt(`INSERT INTO energy_offers(id,case_id,company_id,amount,currency,unit,terms,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM energy_cases WHERE id=? AND state='quoting')
    ON CONFLICT(case_id,company_id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,unit=excluded.unit,terms=excluded.terms,expires_at=excluded.expires_at,revision=energy_offers.revision+1`,crypto.randomUUID(),e.id,user.company_id,i.amount,i.currency,i.unit,i.terms,i.expiresAt,now,e.id),
    stmt('INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(?,?,?,?)',e.id,user.id,'A supplier submitted or revised its private quote.',now)])
   if(!quoteResult[0].meta.changes) fail('Sourcing has closed. Refresh this case.',409)
   return result({ok:true})
  }
  if(action!=='energyChange') fail('Unknown energy action.')
  const i=z.object({revision:z.number().int(),change:z.enum(['triage','clear','select','contract','sign','delivery','acceptDelivery','invoice','payment','receipt','fee','feePayment','feeReceipt','exception','resolve','cancel']),note:text(3500),reference:z.string().trim().max(1500).optional(),offerId:z.uuid().optional(),offerRevision:z.number().int().optional(),nextAt:z.number().int().optional()}).parse(body)
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
    fields.route_note=i.note; fields.state=e.side==='sell'?'available':'quoting'; fields.next_action=e.side==='sell'?'Available for relevant buyer introductions':'Invite suppliers and obtain quotes';break
   case 'select': {
    if(!owner||e.side!=='buy'||e.state!=='quoting') fail('The buyer selects a current offer.',403)
    const offer=await stmt(`SELECT o.id FROM energy_offers o JOIN companies c ON c.id=o.company_id WHERE o.id=? AND o.case_id=? AND o.expires_at>? AND o.revision=? AND c.status='approved'`,i.offerId??'',e.id,now,i.offerRevision??-1).first()
    if(!offer) fail('Offer is missing, expired, or supplier approval changed.',409)
    fields.selected_offer=i.offerId!;fields.state='contracting';fields.next_action='Agree contract, payment security and Teder fee terms';break
   }
   case 'contract':
    if(!operator||e.state!=='contracting'||e.buyer_signed||e.seller_signed) fail('Contract setup is available to operations before signatures.',409)
    fields.contract_ref=ref();fields.security_ref=i.note;fields.fee_terms=i.note;break
   case 'sign':
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
    if(!owner||e.state!=='delivered'||!e.invoice_ref||e.payment_received) fail('Buyer reports payment against the recorded invoice.',409)
    fields.payment_ref=ref();break
   case 'receipt':
    if(!seller||e.state!=='delivered'||!e.payment_ref) fail('Supplier confirms actual receipt against a reported payment.',409)
    fields.payment_received=1;fields.state='paid';fields.next_action='Reconcile Teder service fee';break
   case 'fee':
    if(!operator||e.state!=='paid'||!e.fee_terms||e.fee_payment_ref) fail('Operations issues the agreed fee after payment reconciliation.',409)
    fields.fee_ref=ref();break
   case 'feePayment':
    if((!owner&&!seller)||!e.fee_ref||e.fee_received) fail('A trading party reports payment against the Teder fee invoice.',409)
    fields.fee_payment_ref=ref();break
   case 'feeReceipt':
    if(!operator||!e.fee_payment_ref||!e.payment_received) fail('Operations confirms the fee after checking actual receipt.',409)
    fields.fee_received=1;fields.state='closed';fields.next_action='Completed · request a new sourcing mandate';break
   case 'exception':
    if(!operator&&!owner&&!seller) fail('Only trading parties or operations can open an exception.',403)
    if(e.state==='exception') fail('Resolve the current exception first.',409)
    fields.state='exception';fields.next_action=`Resolve exception from ${e.state}: ${i.note}`;break
   case 'resolve':
    if(!operator||e.state!=='exception') fail('Operations resolves an exception with evidence.',403)
    ref();fields.state=e.next_action.match(/^Resolve exception from ([a-z_]+):/)?.[1]??'checking';fields.next_action=i.note;break
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
