import {AccessQueue} from './company-access-ui'
import { useEffect,useState } from 'react'
import { call } from './client'
type Overview={pending:number;clarifications:number;openCases:number;unread:number;reports:{id:string;reason:string;created_at:number}[];due:{id:string;title:string;next_action:string;next_at:number}[];recent:{id:string;title:string;state:string;updated_at:number}[];paymentsConfigured:boolean}
export function Operations() {
 const [data,setData]=useState<Overview|null>(null),[error,setError]=useState('')
 async function refresh(){try{setData(await call('operatorOverview'));setError('')}catch(e){setError(e instanceof Error?e.message:'Could not load operations.')}}
 useEffect(()=>{void refresh();const interval=window.setInterval(()=>{if(!document.hidden)void refresh()},15000);return()=>clearInterval(interval)},[])
 return <section className="workspace"><div className="section-head"><div><span className="eyebrow">Teder operator · malka</span><h1>Your operations desk</h1></div><button className="secondary" type="button" onClick={()=>void refresh()}>Refresh</button></div>
 {error&&<p role="alert" className="error">{error}</p>}{!data?<p role="status">Loading your queues…</p>:<>
 <div className="offer-grid"><a className="market-card" href="/workspace/review"><h2>{data.pending} applications</h2><p>{data.clarifications} awaiting clarification</p></a><a className="market-card" href="/workspace/messages"><h2>{data.unread} unread messages</h2><p>Private customer conversations</p></a><a className="market-card" href="/workspace/energy"><h2>{data.openCases} open cases</h2><p>Requirements, supply and execution</p></a></div>
 <h2>Updates due</h2><ul className="records">{data.due.map(c=><li key={c.id}><a href={'/workspace/energy/'+c.id}><strong>{c.title}</strong><span>{c.next_action} · {new Date(c.next_at).toLocaleString()}</span></a></li>)}</ul>{!data.due.length&&<p>No overdue next actions.</p>}
 <h2>Recent energy cases</h2><ul className="records">{data.recent.map(c=><li key={c.id}><a href={'/workspace/energy/'+c.id}><strong>{c.title}</strong><span>{c.state} · {new Date(c.updated_at).toLocaleString()}</span></a></li>)}</ul>
 <h2>Reported concerns</h2><ul className="records">{data.reports.map(r=><li key={r.id}>{r.reason}<small>{new Date(r.created_at).toLocaleString()}</small></li>)}</ul>{!data.reports.length&&<p>No open reports.</p>}
 <AccessQueue/><h2>Payment-provider readiness</h2><p><a href="/workspace/payments">Manage provider readiness and route approvals</a></p><p>{data.paymentsConfigured?'Payment connection is configured. Each supplier and route must also be enabled.':'Live split payments await a verified provider account and approval for Teder’s business. The workspace records this condition and prevents an unsupported checkout.'}</p>
 </> }</section>
}
