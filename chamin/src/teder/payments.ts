import StripeClient from 'stripe'
import { z } from 'zod'
import type { Bindings } from './security'
import type { Actor } from './access'
import { canTrade } from './access'
import { commission } from './money'
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}})
function client(env:Bindings) {
 if(!env.STRIPE_SECRET_KEY)throw new Error('Payment provider configuration is pending. Message Teder for assistance.')
 return new StripeClient(env.STRIPE_SECRET_KEY,{httpClient:StripeClient.createFetchHttpClient(),maxNetworkRetries:2,timeout:20000})
}
const bankCurrencies={USD:['us_bank_transfer','us_bank_transfer_payments'],GBP:['gb_bank_transfer','gb_bank_transfer_payments'],EUR:['eu_bank_transfer','sepa_bank_transfer_payments'],JPY:['jp_bank_transfer','jp_bank_transfer_payments']} as const
export type PaymentAttempt={id:string;lot_id:string;provider_account:string;checkout_session:string|null;checkout_url:string|null;payment_intent:string|null;state:string;currency:string;total_minor:number;commission_minor:number;expires_at:number|null;last_event_at:number;dispute_id:string|null}
async function paymentReady(env:Bindings) {
 if(!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)return false
 if(env.STRIPE_MODE==='test')return true
 const approval=await env.DB.prepare("SELECT value FROM platform_configuration WHERE key='payments_live_approved'").first<{value:string}>()
 return approval?.value==='true'
}
export async function paymentsApi(action:string,body:unknown,env:Bindings,user:Actor,origin:string) {
 try {
  const db=env.DB,now=Date.now()
  if(action==='paymentConfiguration') {
   if(!user.bunker_operator)return reply({error:'Teder operator access required.'},403)
   return reply({configured:!!env.STRIPE_SECRET_KEY,webhookConfigured:!!env.STRIPE_WEBHOOK_SECRET,liveApproved:(await db.prepare("SELECT value FROM platform_configuration WHERE key='payments_live_approved'").first<{value:string}>())?.value==='true',routes:(await db.prepare('SELECT * FROM payment_route_approvals ORDER BY country,product,currency').all()).results,mode:env.STRIPE_MODE==='test'?'test':'live'})
  }
  if(action==='paymentApproveRoute') {
   if(!user.bunker_operator)return reply({error:'Teder operator access required.'},403)
   const i=z.object({product:z.enum(['gas','oil','coal','power','flexibility']),country:z.string().regex(/^[A-Z]{2}$/),currency:z.enum(['USD','GBP','EUR','JPY']),maxMinor:z.number().int().positive().max(9e12),validUntil:z.number().int(),reference:z.string().trim().min(1).max(1500),enable:z.boolean()}).parse(body)
   if(i.validUntil<=now)return reply({error:'Approval expiry must be in the future.'},400)
   await db.batch([db.prepare(`INSERT INTO payment_route_approvals VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(product,country,currency) DO UPDATE SET max_minor=excluded.max_minor,valid_until=excluded.valid_until,approval_reference=excluded.approval_reference,approved_by=excluded.approved_by,approved_at=excluded.approved_at`).bind(i.product,i.country,i.currency,i.maxMinor,i.validUntil,i.reference,user.id,now),db.prepare(`INSERT INTO platform_configuration VALUES('payments_live_approved',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(String(i.enable),user.id,now)])
   return reply({ok:true})
  }
  if(action==='paymentStatus') {
   const connection=await db.prepare('SELECT provider_account,charges_enabled,updated_at FROM payment_connections WHERE company_id=?').bind(user.company_id).first()
   return reply({ready:await paymentReady(env),configured:!!env.STRIPE_SECRET_KEY,mode:env.STRIPE_MODE==='test'?'test':'live',connection})
  }
  if(!await paymentReady(env))return reply({error:'Split payments await Teder’s payment-account configuration and provider approval. Your trade remains recorded; no payment was initiated.'},409)
  if(action==='paymentOnboard'||action==='paymentDashboard') {
   if(user.role!=='owner'||!canTrade(user,'accept'))return reply({error:'A verified company owner connects and manages supplier payments.'},403)
   const stripe=client(env)
   let connection=await db.prepare('SELECT provider_account FROM payment_connections WHERE company_id=?').bind(user.company_id).first<{provider_account:string}>()
   if(!connection) {
    if(action==='paymentDashboard')return reply({error:'Connect a supplier payment account first.'},409)
    const company=await db.prepare('SELECT name,country FROM companies WHERE id=?').bind(user.company_id).first<{name:string;country:string}>()
    if(!company?.country)return reply({error:'Company registration country is required for payment onboarding.'},409)
    const bankCapability=company.country==='US'?'us_bank_transfer_payments':company.country==='GB'?'gb_bank_transfer_payments':company.country==='JP'?'jp_bank_transfer_payments':'sepa_bank_transfer_payments'
    const account=await stripe.v2.core.accounts.create({display_name:company.name,identity:{country:company.country},dashboard:'full',defaults:{responsibilities:{fees_collector:'stripe',losses_collector:'stripe'}},configuration:{merchant:{capabilities:{card_payments:{requested:true},[bankCapability]:{requested:true}}}},metadata:{teder_company:user.company_id}},{idempotencyKey:'teder-supplier-'+user.company_id})
    await db.prepare('INSERT INTO payment_connections(company_id,provider_account,updated_at) VALUES(?,?,?) ON CONFLICT(company_id) DO NOTHING').bind(user.company_id,account.id,now).run()
    connection=await db.prepare('SELECT provider_account FROM payment_connections WHERE company_id=?').bind(user.company_id).first<{provider_account:string}>()
   }
   const useCase=action==='paymentDashboard'?{type:'account_dashboard' as const,account_dashboard:{refresh_url:origin+'/workspace/payments'}}:{type:'account_onboarding' as const,account_onboarding:{refresh_url:origin+'/workspace/payments',return_url:origin+'/workspace/payments'}}
   const link=await stripe.v2.core.accountLinks.create({account:connection!.provider_account,use_case:useCase})
   return reply({url:link.url})
  }
  if(action==='paymentCheckout') {
   const i=z.object({caseId:z.uuid(),lotId:z.uuid()}).parse(body)
   if(!canTrade(user,'accept'))return reply({error:'Payment acceptance permission is required.'},403)
   const lot=await db.prepare(`SELECT l.*,e.company_id buyer_id,e.product,e.country,e.fee_payer,e.fee_revision,e.buyer_fee_revision,e.state case_state,o.company_id supplier_id,
    i.fee_accepted_revision FROM energy_delivery_lots l JOIN energy_cases e ON e.id=l.case_id JOIN energy_offers o ON o.id=e.selected_offer
    JOIN energy_invitations i ON i.case_id=e.id AND i.company_id=o.company_id WHERE l.id=? AND e.id=? AND e.company_id=?`).bind(i.lotId,i.caseId,user.company_id).first<{id:string;currency:string;gross_minor:number;commission_minor:number;accepted_at:number|null;payment_state:string;buyer_id:string;supplier_id:string;product:string;country:string;fee_payer:string;fee_revision:number;buyer_fee_revision:number;fee_accepted_revision:number;case_state:string}>()
   if(!lot||!lot.accepted_at||['exception','cancelled','closed'].includes(lot.case_state)||!['awaiting_provider','failed','pending'].includes(lot.payment_state))return reply({error:'An accepted, unpaid instalment in an active trade is required.'},409)
   if(lot.buyer_fee_revision!==lot.fee_revision||lot.fee_accepted_revision!==lot.fee_revision||lot.commission_minor!==commission(lot.gross_minor))return reply({error:'Current fee acceptance and the agreed 2% calculation are required.'},409)
   if(!await db.prepare("SELECT 1 FROM companies WHERE id=? AND status='approved'").bind(lot.supplier_id).first())return reply({error:'The supplier company must remain approved before payment.'},409)
   const bank=bankCurrencies[lot.currency as keyof typeof bankCurrencies]
   if(!bank)return reply({error:'Bank-transfer splitting for this currency is not enabled. Agree an approved route and currency with Teder.'},409)
   const total=lot.gross_minor+(lot.fee_payer==='buyer'?lot.commission_minor:0)
   if(env.STRIPE_MODE!=='test'&&!await db.prepare('SELECT 1 FROM payment_route_approvals WHERE product=? AND country=? AND currency=? AND max_minor>=? AND valid_until>?').bind(lot.product,lot.country,lot.currency,total,now).first())return reply({error:'This product, route, currency or payment size awaits provider approval.'},409)
   const connection=await db.prepare('SELECT provider_account FROM payment_connections WHERE company_id=?').bind(lot.supplier_id).first<{provider_account:string}>()
   if(!connection)return reply({error:'The supplier owner must connect their payment account first.'},409)
   const stripe=client(env)
   const account=await stripe.v2.core.accounts.retrieve(connection.provider_account,{include:['configuration.merchant','defaults']})
   const capabilities=account.configuration?.merchant?.capabilities as Record<string,{status?:string}>|undefined
   if(capabilities?.[bank[1]]?.status!=='active'||account.defaults?.responsibilities?.losses_collector!=='stripe'||account.defaults?.responsibilities?.fees_collector!=='stripe')return reply({error:'Supplier bank-transfer capability and the agreed provider responsibility settings must be active.'},409)
   await db.prepare('UPDATE payment_connections SET charges_enabled=1,updated_at=? WHERE company_id=?').bind(now,lot.supplier_id).run()
   await db.prepare("UPDATE payment_attempts SET state='expired' WHERE lot_id=? AND state='open' AND expires_at<?").bind(lot.id,Math.floor(now/1000)).run()
   let attempt=await db.prepare("SELECT * FROM payment_attempts WHERE lot_id=? AND state IN ('creating','open','pending','paid','disputed')").bind(lot.id).first<PaymentAttempt>()
   if(attempt?.checkout_url&&attempt.state==='open')return reply({url:attempt.checkout_url})
   if(attempt&&attempt.state!=='creating')return reply({error:'A payment is already processing or has been recorded. Refresh its status before retrying.'},409)
   if(!attempt) {
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO payment_attempts(id,lot_id,attempt,provider_account,currency,total_minor,commission_minor,created_at,updated_at)
     SELECT ?,?,COALESCE((SELECT MAX(attempt)+1 FROM payment_attempts WHERE lot_id=?),1),?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_attempts WHERE lot_id=? AND state IN ('creating','open','pending','paid','disputed')) ON CONFLICT DO NOTHING`).bind(id,lot.id,lot.id,connection.provider_account,lot.currency,total,lot.commission_minor,now,now,lot.id).run()
    attempt=await db.prepare("SELECT * FROM payment_attempts WHERE lot_id=? AND state='creating'").bind(lot.id).first<PaymentAttempt>()
   }
   if(!attempt)return reply({error:'Payment state changed. Refresh before continuing.'},409)
   let customer=await db.prepare('SELECT provider_customer FROM payment_customers WHERE buyer_company_id=? AND supplier_company_id=?').bind(user.company_id,lot.supplier_id).first<{provider_customer:string}>()
   if(!customer) {
    const created=await stripe.customers.create({metadata:{teder_company:user.company_id}},{stripeAccount:connection.provider_account,idempotencyKey:'teder-customer-'+lot.supplier_id+'-'+user.company_id})
    await db.prepare('INSERT INTO payment_customers VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(user.company_id,lot.supplier_id,created.id).run()
    customer={provider_customer:created.id}
   }
   const session=await stripe.checkout.sessions.create({mode:'payment',customer:customer.provider_customer,allowed_payment_method_types:['customer_balance'],
    integration_identifier:'teder_'+attempt.id.replaceAll('-','').slice(0,8),
    payment_method_options:{customer_balance:{funding_type:'bank_transfer',bank_transfer:{type:bank[0],...(lot.currency==='EUR'?{eu_bank_transfer:{country:'NL'}}:{})}}},
    line_items:[{quantity:1,price_data:{currency:lot.currency.toLowerCase(),unit_amount:attempt.total_minor,product_data:{name:'Accepted energy delivery '+lot.id,description:'Includes the agreed Teder commission. Supplier is the contracting merchant.'}}}],
    payment_intent_data:{application_fee_amount:attempt.commission_minor,metadata:{teder_attempt:attempt.id,teder_lot:lot.id,teder_case:i.caseId}},
    metadata:{teder_attempt:attempt.id,teder_lot:lot.id},success_url:origin+'/workspace/energy/'+i.caseId+'?payment=returned',cancel_url:origin+'/workspace/energy/'+i.caseId,
   },{stripeAccount:connection.provider_account,idempotencyKey:'teder-checkout-'+attempt.id})
   await db.batch([db.prepare("UPDATE payment_attempts SET checkout_session=?,checkout_url=?,expires_at=?,state='open',updated_at=? WHERE id=? AND state='creating'").bind(session.id,session.url,session.expires_at,now,attempt.id),db.prepare("UPDATE energy_delivery_lots SET payment_state='pending' WHERE id=? AND payment_state IN ('awaiting_provider','failed')").bind(lot.id)])
   return reply({url:session.url})
  }
  if(action==='paymentRefund') {
   const i=z.object({lotId:z.uuid(),amountMinor:z.number().int().positive(),requestKey:z.uuid(),reason:z.string().trim().min(1).max(1000)}).parse(body)
   if(user.role!=='owner'||!canTrade(user,'accept'))return reply({error:'The supplier owner authorizes refunds.'},403)
   const payment=await db.prepare(`SELECT p.*,l.case_id FROM payment_attempts p JOIN energy_delivery_lots l ON l.id=p.lot_id JOIN energy_cases e ON e.id=l.case_id JOIN energy_offers o ON o.id=e.selected_offer WHERE p.lot_id=? AND o.company_id=? AND p.state IN ('paid','disputed') ORDER BY p.attempt DESC LIMIT 1`).bind(i.lotId,user.company_id).first<PaymentAttempt&{case_id:string;refunded_minor:number}>()
   if(!payment?.payment_intent||i.amountMinor>payment.total_minor-payment.refunded_minor)return reply({error:'Refund must be within the remaining paid amount.'},409)
   await client(env).refunds.create({payment_intent:payment.payment_intent,amount:i.amountMinor,refund_application_fee:true,metadata:{teder_reason:i.reason}},{stripeAccount:payment.provider_account,idempotencyKey:'teder-refund-'+i.requestKey})
   await db.prepare('INSERT INTO energy_events(case_id,actor_id,note,occurred_at) VALUES(?,?,?,?)').bind(payment.case_id,user.id,'Supplier requested a provider refund: '+i.reason,now).run()
   return reply({message:'Refund requested. Provider events will confirm the result.'})
  }
  return reply({error:'Unknown payment action.'},400)
 }catch(error){
  if(error instanceof z.ZodError)return reply({error:'Check the payment fields.'},400)
  if(error instanceof StripeClient.errors.StripeError)return reply({error:'The payment provider could not complete this action. Check account requirements or contact Teder.'},502)
  return reply({error:error instanceof Error?error.message:'Payment action unavailable.'},409)
 }
}

export async function stripeWebhook(request:Request,env:Bindings) {
 if(request.method!=='POST')return reply({error:'Use POST.'},405)
 if(!env.STRIPE_WEBHOOK_SECRET||!env.STRIPE_SECRET_KEY)return reply({error:'Payment events are not configured.'},503)
 if(Number(request.headers.get('content-length')??0)>1048576)return reply({error:'Event too large.'},413)
 const raw=await request.text()
 if(new TextEncoder().encode(raw).length>1048576)return reply({error:'Event too large.'},413)
 const stripe=client(env)
 let event:StripeClient.Event
 try{event=await stripe.webhooks.constructEventAsync(raw,request.headers.get('stripe-signature')||'',env.STRIPE_WEBHOOK_SECRET,300,StripeClient.createSubtleCryptoProvider())}catch{return reply({error:'Invalid provider signature.'},400)}
 if(event.livemode!==(env.STRIPE_MODE!=='test'))return reply({error:'Payment environment mismatch.'},400)
 if(await env.DB.prepare('SELECT 1 FROM provider_events WHERE id=?').bind(event.id).first())return reply({received:true})
 const object=event.data.object as unknown as {id:string;metadata?:Record<string,string>;payment_intent?:string;charge?:string}
 const attempt=await env.DB.prepare(`SELECT * FROM payment_attempts WHERE id=? OR checkout_session=? OR payment_intent=? OR charge_id=? LIMIT 1`).bind(object.metadata?.teder_attempt??'',object.id,object.payment_intent??object.id,object.charge??object.id).first<PaymentAttempt>()
 if(!attempt)return reply({received:true})
 if(event.account&&event.account!==attempt.provider_account)return reply({error:'Provider account mismatch.'},400)
 if(!event.account&&!event.type.startsWith('application_fee.'))return reply({error:'Connected-account event required.'},400)
 try {
  const session=await stripe.checkout.sessions.retrieve(attempt.checkout_session!,{}, {stripeAccount:attempt.provider_account})
  const intentId=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id
  let state='pending',chargeId:string|null=null,refunded=0,feeRefunded=0,disputeId=attempt.dispute_id
  if(session.status==='expired')state='failed'
  if(intentId) {
   const intent=await stripe.paymentIntents.retrieve(intentId,{}, {stripeAccount:attempt.provider_account})
   if(intent.amount!==attempt.total_minor||intent.currency!==attempt.currency.toLowerCase()||intent.application_fee_amount!==attempt.commission_minor)return reply({error:'Payment amount or commission mismatch.'},400)
   if(intent.status==='canceled'||intent.status==='requires_payment_method')state='failed'
   if(intent.status==='succeeded') {
    chargeId=typeof intent.latest_charge==='string'?intent.latest_charge:intent.latest_charge?.id??null
    if(!chargeId)return reply({error:'Successful charge is not yet available.'},503)
    const charge=await stripe.charges.retrieve(chargeId,{expand:['application_fee']},{stripeAccount:attempt.provider_account})
    const fee=charge.application_fee
    if(!fee||typeof fee==='string'||fee.amount!==attempt.commission_minor)return reply({error:'Commission allocation is not yet confirmed.'},503)
    if(event.type.startsWith('charge.dispute.'))disputeId=object.id
    const dispute=disputeId?await stripe.disputes.retrieve(disputeId,{}, {stripeAccount:attempt.provider_account}):null
    refunded=charge.amount_refunded;feeRefunded=fee.amount_refunded
    state=refunded>0?'refunded':dispute&&dispute.status!=='won'&&dispute.status!=='warning_closed'?'disputed':'paid'
   }
  }
  const now=Date.now(),caseRow=await env.DB.prepare('SELECT case_id FROM energy_delivery_lots WHERE id=?').bind(attempt.lot_id).first<{case_id:string}>()
  await env.DB.batch([
   env.DB.prepare(`UPDATE payment_attempts SET state=?,payment_intent=?,charge_id=?,refunded_minor=?,fee_refunded_minor=?,dispute_id=?,last_event_at=?,updated_at=?
    WHERE id=? AND last_event_at<=? AND (?<>'paid' OR state NOT IN ('refunded','disputed') OR last_event_at<?)`).bind(state,intentId??null,chargeId,refunded,feeRefunded,disputeId,event.created,now,attempt.id,event.created,state,event.created),
   env.DB.prepare(`UPDATE energy_delivery_lots SET payment_state=(SELECT CASE WHEN state IN ('paid','refunded','disputed','failed') THEN state ELSE 'pending' END FROM payment_attempts WHERE id=?),provider_payment_id=?,provider_fee_minor=? WHERE id=? AND EXISTS(SELECT 1 FROM payment_attempts WHERE id=? AND last_event_at=?)`).bind(attempt.id,intentId??null,attempt.commission_minor-feeRefunded,attempt.lot_id,attempt.id,event.created),
   env.DB.prepare(`UPDATE energy_cases SET fee_received=CASE WHEN NOT EXISTS(SELECT 1 FROM energy_delivery_lots WHERE case_id=energy_cases.id AND payment_state<>'paid') THEN 1 ELSE 0 END,
    next_action=CASE WHEN ?='paid' THEN 'Provider confirmed payment and commission; continue deliveries or complete the mandate' ELSE 'Review provider payment status and any outstanding obligations' END,updated_at=?,revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM payment_attempts WHERE id=? AND last_event_at=?)`).bind(state,now,caseRow?.case_id??'',attempt.id,event.created),
   env.DB.prepare('INSERT INTO provider_events VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(event.id,event.type,event.created,object.id),
  ])
  return reply({received:true})
 }catch{return reply({error:'Provider reconciliation is pending. Retry this event.'},503)}
}
