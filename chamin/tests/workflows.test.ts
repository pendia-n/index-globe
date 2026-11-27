import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import Database from 'better-sqlite3'
import StripeClient from 'stripe'
import {tederApi} from '../src/teder/api'
import {stripeWebhook} from '../src/teder/payments'
import {createSession} from '../src/teder/security'

const sql=new Database(':memory:');sql.pragma('foreign_keys=ON')
for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'))
class Statement {
 values:unknown[]=[]
 constructor(public query:string){}
 bind(...values:unknown[]){this.values=values.map(v=>v instanceof ArrayBuffer?Buffer.from(v):v);return this}
 async first(){try{return sql.prepare(this.query).get(...this.values)??null}catch(e){console.error('Isolated SQL failure',this.query);throw e}}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){let statement;try{statement=sql.prepare(this.query)}catch(e){console.error('Isolated SQL failure',this.query);throw e};if(statement.reader)return {results:statement.all(...this.values),meta:{changes:(sql.prepare('SELECT changes() n').get() as {n:number}).n}};const info=statement.run(...this.values);return {meta:{changes:info.changes}}}
}
const env={DB:{prepare:(q:string)=>new Statement(q),batch:async(statements:Statement[])=>{sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());sql.exec('COMMIT');return rows}catch(e){sql.exec('ROLLBACK');throw e}}},TEDER_JWT_SECRET:'fictional-isolated-worker-secret-over-32-characters',STRIPE_SECRET_KEY:undefined,STRIPE_WEBHOOK_SECRET:undefined,STRIPE_MODE:undefined} as any
const origin='https://isolated.teder.test',cookies=new Map<string,string>()
async function api(user:string,action:string,body:Record<string,unknown>={},expected=200){
 const response=await tederApi(new Request(origin+'/api/teder'+(action==='documentUpload'?'?upload=document':''),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies.get(user)||''},body:JSON.stringify({action,...body})}),env)
 if(response.headers.get('set-cookie'))cookies.set(user,response.headers.get('set-cookie')!.split(';')[0])
 if(action==='documentDownload'){assert.equal(response.status,expected);return response}
 const data:any=await response.json();assert.equal(response.status,expected,action+' '+JSON.stringify(data));return data
}
const password='Synthetic123!',operatorCompany=crypto.randomUUID(),operator=crypto.randomUUID()
sql.prepare("INSERT INTO companies(id,name,registration,workspace_kind,status) VALUES(?,'Teder Operations','operator-test','operations','approved')").run(operatorCompany)
sql.prepare("INSERT INTO users(id,username,password_hash,recovery_hash,company_id,role,authority_status) VALUES(?,'malka','unused','unused',?,'owner','verified')").run(operator,operatorCompany)
sql.prepare('INSERT INTO bunker_operators(user_id,granted_at) VALUES(?,?)').run(operator,Date.now())
cookies.set('malka',(await createSession(env,{id:operator,auth_version:1})).split(';')[0])
async function register(name:string,number:string,invite?:string){const code=crypto.randomUUID().replaceAll('-','')+'12345678';return api(name,'register',{username:name,password,code,recoveryConfirmation:code,saved:true,company:name+' Energy',country:'GB',registration:number,...(invite?{invite}:{})},201)}
async function session(name:string){return (await api(name,'session')).user}
async function approve(name:string){
 const user=await session(name)
 const document=await api(name,'documentUpload',{scope:'company',scopeId:user.company_id,category:'authority',name:'mandate.pdf',contents:btoa('%PDF-1.4 fictional mandate '+name) },201)
 await api(name,'submitCompanyApplication',{email:name+'@example.test',registry:'Independent registry reference',authority:'Director mandate',applicantName:name,position:'Director',address:'Test registered address',officerName:'Authorizing Director',officerContact:'Independent switchboard',permissionScope:'Request, offer and accept physical energy contracts',authorityLimit:'As specified per contract',authorityUntil:Date.now()+86400000*365,documents:[document.id]})
 const row=sql.prepare('SELECT id FROM company_applications WHERE company_id=? AND decision IS NULL').get(user.company_id) as {id:string}
 await api('malka','review',{companyId:user.company_id,applicationId:row.id,result:'clarification',note:'Please confirm mandate scope',registryCheck:'Registry independently checked',authorityCheck:'Officer callback pending',identityCheck:'Additional ID not required for this test'})
 await api(name,'submitCompanyApplication',{email:name+'@example.test',registry:'Independent registry reference',authority:'Director mandate confirmed',applicantName:name,position:'Director',address:'Test registered address',officerName:'Authorizing Director',officerContact:'Independent switchboard',permissionScope:'Request, offer and accept',authorityLimit:'Contract specific',authorityUntil:Date.now()+86400000*365,documents:[document.id]})
 await api('malka','review',{companyId:user.company_id,applicationId:row.id,result:'approved',note:'Registry and authority independently confirmed',registryCheck:'Registry matched',authorityCheck:'Officer confirmed through independently obtained switchboard',identityCheck:'Identity assessed and documented'})
 assert.equal((await session(name)).role,'owner')
 return await session(name)
}
await register('buyer','12345678');await register('seller','12345679');await register('outsider','12345680')
assert.equal((await session('buyer')).role,'applicant')
await api('buyer','invite',{role:'trader'},403)
const support=await api('buyer','dmSupport')
await api('buyer','dmSend',{conversationId:support.id,requestKey:crypto.randomUUID(),message:'Please review my authority'},201)
assert.equal((await api('malka','dmUnread')).unread,1)
await api('outsider','dmMessages',{conversationId:support.id},404)
await api('malka','dmSend',{conversationId:support.id,requestKey:crypto.randomUUID(),message:'Please upload the mandate'},201)
const buyer=await approve('buyer'),seller=await approve('seller')
await api('outsider','documentList',{scope:'company',scopeId:buyer.company_id},404)
const caseId=crypto.randomUUID()
await api('buyer','energyCreate',{requestKey:caseId,side:'buy',product:'gas',country:'GB',deliveryPoint:'Named delivery point',title:'Private industrial requirement',quantity:'100 MWh',window:'Future UTC window',specification:'Pipeline quality',deliveryTerms:'Qualified shipper',contact:'buyer@example.test',credit:'Bank LC available',masterAgreement:'Physical supply agreement',mandateReference:'Authorized site mandate',consent:true,validUntil:Date.now()+86400000},201)
async function detail(name='buyer'){return api(name,'energyDetail',{caseId})}
async function change(user:string,action:string,body:Record<string,unknown>={}){const e=(await detail(user)).record;return api(user,action,{caseId,revision:e.revision,...body})}
await change('malka','energyChange',{change:'triage',note:'Assigned operator',nextAt:Date.now()+3600000})
await change('malka','energyChange',{change:'clear',note:'Route checked',blindBrief:'Verified industrial buyer requires 100 MWh; LC available',routeChecks:'Named shipper; access, sanctions, credit and legal role checked',reference:'Independent route records'})
await change('malka','energyTerms',{payer:'seller',basis:'Accepted energy delivery value excluding taxes, in GBP',currency:'GBP',terms:'2% deducted from supplier proceeds; supplier bears provider fees. Shortlist introduction under confidentiality; cancellations and refunds reconcile commission.'})
await change('buyer','energyAcceptMandate',{accept:true})
await api('malka','energyInvite',{caseId,companyId:seller.company_id})
const masked=await detail('seller');assert.equal(masked.record.company_name,'Verified buyer');assert(!JSON.stringify(masked.record).includes('buyer@example.test'))
await api('seller','dmContacts',{kind:'energy',contextId:caseId},403)
await change('seller','energyAcceptMandate',{accept:true})
const quote={caseId,amount:50,currency:'GBP',unit:'MWh',totalMinor:500000,terms:'Delivered with transport',structuredTerms:'Credit LC, transportation included',expiresAt:Date.now()+3600000}
await api('malka','energyAssistedQuote',{...quote,supplierId:seller.company_id})
let offer=(await detail('seller')).offers[0]
await api('malka','energyNormalize',{caseId,revision:(await detail('malka')).record.revision,offerId:offer.id,offerRevision:offer.revision,publicTerms:'Delivered offer with transportation included',normalizedTotalMinor:500000},409)
await change('seller','energyConfirmOffer',{offerId:offer.id,offerRevision:offer.revision,accept:true})
await change('malka','energyNormalize',{offerId:offer.id,offerRevision:offer.revision,publicTerms:'Delivered offer with transportation included',normalizedTotalMinor:500000})
await change('buyer','energyShortlist',{offerId:offer.id})
await change('malka','energyDisclose',{offerId:offer.id})
assert.equal((await detail('buyer')).offers[0].company_name,'seller Energy')
const contacts=await api('buyer','dmContacts',{kind:'energy',contextId:caseId});assert.equal(contacts.contacts[0].id,seller.id)
const dm=await api('buyer','dmOpen',{kind:'energy',contextId:caseId,peerId:seller.id})
const attachment=await api('buyer','documentUpload',{scope:'dm',scopeId:dm.id,category:'other',name:'spec.pdf',contents:btoa('%PDF-1.4 agreed specification')},201)
const key=crypto.randomUUID()
await api('buyer','dmSend',{conversationId:dm.id,requestKey:key,message:'Please confirm this specification',documents:[attachment.id]},201)
await api('buyer','dmSend',{conversationId:dm.id,requestKey:key,message:'Please confirm this specification',documents:[attachment.id]})
assert.equal((await api('seller','dmMessages',{conversationId:dm.id})).messages.length,1)
await api('outsider','documentDownload',{scope:'dm',scopeId:dm.id,documentId:attachment.id},404)
await api('malka','dmMessages',{conversationId:dm.id},404)
await change('buyer','energyChange',{change:'select',offerId:offer.id,offerRevision:offer.revision,note:'Counterparty and credit checks completed'})
await change('malka','energyChange',{change:'contract',reference:'Signed contract v1',note:'Supplier ships, buyer accepts delivery; bank guarantee; 2% agreement already recorded'})
await change('buyer','energyChange',{change:'sign',note:'Accepted contract v1'})
await change('seller','energyChange',{change:'sign',note:'Accepted contract v1'})
const lotId=crypto.randomUUID()
await change('seller','energyLot',{requestKey:lotId,description:'First delivery',quantity:'100 MWh',evidence:'Meter issuer / statement 1',grossMinor:500000,currency:'GBP'})
await change('buyer','energyLotReview',{lotId,result:'disputed',note:'Quantity discrepancy'})
await change('seller','energyLotCorrect',{lotId,description:'Corrected delivery',quantity:'99 MWh',evidence:'Corrected statement 2',grossMinor:495000,note:'Quantity corrected from meter records'})
await change('buyer','energyLotReview',{lotId,result:'accepted',note:'Confirmed corrected quantity and value'})
await api('buyer','paymentCheckout',{caseId,lotId},409)
await api('buyer','energyChange',{caseId,revision:(await detail()).record.revision,change:'feeReceipt',note:'Attempt unsupported manual confirmation'},409)
// Provider integration is exercised with a local HTTP fixture. No Stripe account is contacted.
env.STRIPE_SECRET_KEY='isolated-provider-key';env.STRIPE_WEBHOOK_SECRET='isolated-event-key';env.STRIPE_MODE='test'
sql.prepare('INSERT INTO payment_connections(company_id,provider_account,updated_at) VALUES(?,?,?)').run(seller.company_id,'acct_supplier_fixture',Date.now())
const originalFetch=globalThis.fetch
let refund=0,feeRefund=0
const sessionObject={id:'cs_fixture',object:'checkout.session',status:'complete',payment_status:'paid',payment_intent:'pi_fixture',url:'https://checkout.stripe.com/fixture',expires_at:Math.floor(Date.now()/1000)+3600}
globalThis.fetch=async(input:any,options:any)=>{
 const url=String(input),body=options?.body?.toString()||''
 let value:any
 if(url.includes('/v2/core/accounts/'))value={id:'acct_supplier_fixture',object:'v2.core.account',configuration:{merchant:{capabilities:{card_payments:{status:'active'},gb_bank_transfer_payments:{status:'active'}}}},defaults:{responsibilities:{losses_collector:'stripe',fees_collector:'stripe'}}}
 else if(url.includes('/customers'))value={id:'cus_fixture',object:'customer'}
 else if(url.endsWith('/checkout/sessions')){assert(body.includes('application_fee_amount%5D=9900')||decodeURIComponent(body).includes('application_fee_amount]=9900'));value=sessionObject}
 else if(url.includes('/checkout/sessions/'))value=sessionObject
 else if(url.includes('/payment_intents/'))value={id:'pi_fixture',object:'payment_intent',status:'succeeded',amount:495000,currency:'gbp',application_fee_amount:9900,latest_charge:'ch_fixture'}
 else if(url.includes('/charges/'))value={id:'ch_fixture',object:'charge',amount_refunded:refund,application_fee:{id:'fee_fixture',amount:9900,amount_refunded:feeRefund}}
 else throw new Error('Unexpected provider request: '+url)
 return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json','request-id':'fixture-request'}})
}
try{
 const checkout=await api('buyer','paymentCheckout',{caseId,lotId});assert.equal(checkout.url,sessionObject.url)
 const signer=new StripeClient('isolated-signature-key')
 async function event(id:string,type:string,created:number){const payload=JSON.stringify({id,object:'event',account:'acct_supplier_fixture',type,created,livemode:false,data:{object:type==='charge.refunded'?{id:'ch_fixture',object:'charge',payment_intent:'pi_fixture'}:{...sessionObject}}});const signature=signer.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});const response=await stripeWebhook(new Request(origin+'/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload}),env);assert.equal(response.status,200,await response.text())}
 const now=Math.floor(Date.now()/1000)
 await event('evt_paid','checkout.session.completed',now)
 await event('evt_paid','checkout.session.completed',now)
 assert.equal((await detail()).lots[0].payment_state,'paid')
 assert.equal((await detail()).record.fee_received,1)
 await change('buyer','energyComplete')
 assert.equal((await detail()).record.state,'closed')
 refund=495000;feeRefund=9900
 await event('evt_refund','charge.refunded',now+1)
 assert.equal((await detail()).lots[0].payment_state,'refunded')
 assert.equal((await detail()).record.fee_received,0)
 const invalid=await stripeWebhook(new Request(origin+'/api/stripe/webhook',{method:'POST',body:'{}'}),env);assert.equal(invalid.status,400)
}finally{globalThis.fetch=originalFetch}
// Capacity includes reserved invitations, and every member has an independent login.
for(let i=0;i<4;i++){const invite=await api('buyer','invite',{role:'trader'});await register('member'+i,'',new URL(invite.link).searchParams.get('invite')!)}
await api('buyer','invite',{role:'trader'},409)
await api('buyer','teamPermissions',{member:'member0',request:false,offer:false,accept:false})
await api('member0','session') // Session was deliberately invalidated after permission changes.
await api('member0','login',{username:'member0',password})
assert.equal((await session('member0')).can_accept,0)
await api('buyer','teamMember',{member:'member1',operation:'remove'})
const access=await api('','accessRequest',{country:'GB',region:'',registration:'12345678',fullName:'Additional Representative',email:'additional@example.test',username:'additional',note:'Director-approved replacement'},201)
const queue=await api('buyer','accessQueue')
await api('buyer','accessDecision',{requestId:queue.requests[0].id,result:'approved',note:'Authority independently confirmed'})
const tracking=await api('','accessTrack',{receipt:access.receipt});assert(tracking.invite)
await register('additional','',tracking.invite)
await api('buyer','teamPermissions',{member:'additional',request:false,offer:false,accept:false})
await api('additional','login',{username:'additional',password})
await api('additional','energyChange',{caseId,revision:(await detail('buyer')).record.revision,change:'sign',note:'Unauthorized agreement'},409)
// A removed representative's company owner can assign the existing one-to-one business history.
const replacement=(await api('buyer','team')).members.find((m:any)=>m.username==='member2')
assert(replacement)
const secondDm=await api('member2','dmOpen',{kind:'energy',contextId:caseId,peerId:seller.id})
await api('member2','dmSend',{conversationId:secondDm.id,requestKey:crypto.randomUUID(),message:'Business record before handover'},201)
await api('buyer','teamMember',{member:'member2',operation:'remove'})
const handovers=await api('buyer','dmHandoverQueue');assert(handovers.conversations.some((c:any)=>c.id===secondDm.id))
await api('buyer','dmHandover',{conversationId:secondDm.id,priorUserId:(sql.prepare("SELECT id FROM users WHERE username='member2'").get() as any).id,nextUserId:(sql.prepare("SELECT id FROM users WHERE username='member3'").get() as any).id})
assert((await api('member3','dmMessages',{conversationId:secondDm.id})).messages.some((m:any)=>m.body==='Business record before handover'))
await api('member2','dmMessages',{conversationId:secondDm.id},401)
await api('buyer','teamMember',{member:'member2',operation:'restore'})
await api('buyer','invite',{role:'trader'},409)
assert.equal((await api('buyer','team')).members.filter((m:any)=>!m.disabled_at).length,5)
const repeated=await api('buyer','energyRepeat',{caseId,revision:(await detail()).record.revision},201)
const repeatId=repeated.id
let repeatDetail=await api('buyer','energyDetail',{caseId:repeatId})
await api('buyer','energyRevise',{caseId:repeatId,revision:repeatDetail.record.revision,validUntil:Date.now()+86400000,quantity:'200 MWh',window:'Updated future UTC window',specification:'Revised pipeline quality',deliveryTerms:'Transport included',credit:'LC confirmed',masterAgreement:'Revised physical agreement'})
repeatDetail=await api('buyer','energyDetail',{caseId:repeatId})
assert.equal(repeatDetail.record.state,'checking');assert.equal(repeatDetail.record.sourcing_revision,1)
assert.equal(JSON.parse(repeatDetail.record.details).quantity,'200 MWh')
await api('outsider','energyDetail',{caseId:repeatId},404)
console.log('PASS · real API auth, applicant review/clarification, private evidence, support/trade DMs, staged disclosure, supplier-confirmed assisted quotes, delivery correction, signed provider settlement/refund, closure and five-seat access requests')
