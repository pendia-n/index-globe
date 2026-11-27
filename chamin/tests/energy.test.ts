import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import Database from 'better-sqlite3'
import {energyApi} from '../src/teder/energy-api'
const sql=new Database(':memory:')
sql.pragma('foreign_keys=ON')
for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync('migrations/'+file,'utf8'))
class Statement {
 values:unknown[]=[]
 constructor(public query:string){}
 bind(...values:unknown[]){this.values=values;return this}
 async first(){return sql.prepare(this.query).get(...this.values)??null}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){const info=sql.prepare(this.query).run(...this.values);return {meta:{changes:info.changes}}}
}
const env={DB:{prepare:(q:string)=>new Statement(q),batch:async(statements:Statement[])=>{
 sql.exec('BEGIN')
 try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}
}},TEDER_JWT_SECRET:'fictional-test-value'} as any
function actor(name:string,operator=0,status='approved'){
 const company_id=crypto.randomUUID(),id=crypto.randomUUID()
 sql.prepare('INSERT INTO companies(id,name,registration,status,workspace_kind) VALUES(?,?,?,?,?)').run(company_id,name,name,status,operator?'operations':'customer')
 sql.prepare("INSERT INTO users(id,username,password_hash,recovery_hash,company_id,role) VALUES(?,?,'test','test',?,'owner')").run(id,name,company_id)
 return {id,company_id,status,workspace_kind:operator?'operations':'customer',bunker_operator:operator,role:'owner'}
}
const buyer=actor('buyer'),seller=actor('seller'),rival=actor('rival'),outsider=actor('outsider'),ops=actor('ops',1)
async function request(user:any,action:string,body:any={},status=200){const response=await energyApi(action,{action,...body},env,user);const data:any=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data}
const caseId=crypto.randomUUID()
await request(buyer,'energyCreate',{requestKey:caseId,side:'buy',product:'gas',country:'GB',deliveryPoint:'NBP',title:'Industrial gas requirement',quantity:'100 MWh/day',window:'December UTC',specification:'Pipeline specification',deliveryTerms:'Qualified shipper arranges delivery',contact:'buyer@example.test',credit:'LC',masterAgreement:'Physical supply agreement',mandateReference:'Site mandate',consent:true,validUntil:Date.now()+86400000},201)
sql.prepare('UPDATE energy_cases SET workflow_version=1 WHERE id=?').run(caseId)
await request(outsider,'energyDetail',{caseId},404)
let revision=0
async function change(user:any,change:string,extra:any={}){await request(user,'energyChange',{caseId,revision,change,note:'Evidence checked with responsible parties',reference:'external-evidence-001',...extra});revision++}
await request(buyer,'energyChange',{caseId,revision,change:'clear',note:'Attempt unauthorized route clearance'},409)
await change(ops,'triage')
await change(ops,'clear')
await request(buyer,'energyInvite',{caseId,companyId:seller.company_id})
await request(buyer,'energyInvite',{caseId,companyId:rival.company_id})
const quote={caseId,totalMinor:500000,structuredTerms:'Delivered terms',amount:50,currency:'GBP',unit:'MWh delivered',terms:'Transport included; invoice net 15',expiresAt:Date.now()+86400000}
await request(seller,'energyQuote',quote)
await request(rival,'energyQuote',{...quote,amount:55})
assert.equal((await request(seller,'energyDetail',{caseId})).offers.length,1)
const offer=(await request(buyer,'energyDetail',{caseId})).offers.find((o:any)=>o.company_id===seller.company_id)
await request(buyer,'energyChange',{caseId,revision,change:'select',note:'Selected',offerId:offer.id,offerRevision:99},409)
await change(buyer,'select',{offerId:offer.id,offerRevision:0})
await request(seller,'energyQuote',quote,409)
await request(buyer,'energyChange',{caseId,revision,change:'sign',note:'Premature signature'},409)
await change(ops,'contract',{note:'Bank guarantee via buyer bank; provider and draw terms verified. Buyer pays Teder GBP 50 after supplier receipt.'})
await change(buyer,'sign')
await change(seller,'sign')
const rivalView=await request(rival,'energyDetail',{caseId})
assert.equal(rivalView.record.contract_ref,null)
assert(!JSON.stringify(rivalView).includes('Bank guarantee'))
await change(seller,'delivery')
await change(buyer,'exception')
await request(seller,'energyChange',{caseId,revision,change:'invoice',note:'Cannot bypass dispute',reference:'invoice'},409)
await change(ops,'resolve')
await change(buyer,'acceptDelivery')
await change(seller,'invoice')
await change(buyer,'payment')
await request(buyer,'energyChange',{caseId,revision,change:'receipt',note:'Cannot self-confirm'},409)
await change(seller,'receipt')
await change(ops,'fee')
await change(buyer,'feePayment')
await change(ops,'feeReceipt')
assert.equal((await request(buyer,'energyDetail',{caseId})).record.state,'closed')
assert.equal((await request(ops,'energyMetrics')).routes[0].fees_received,1)
console.log('PASS · migrations, private invitations, quote isolation, stale quote rejection, contracts, exceptions, delivery, payment and fee receipt')
