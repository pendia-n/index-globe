import { useEffect,useState } from 'react'
import { call,field } from './client'
import { Form,Notes } from './forms'
import { Documents,downloadDocument } from './documents'
import type { PrivateDocument } from './documents'
type Conversation={id:string;kind:string;context_kind:string|null;context_id:string|null;peer_name:string;company_name:string;preview:string|null;unread:number;updated_at:number}
type Message={id:string;sender_id:string;sender_name:string;body:string;created_at:number}
type Thread={messages:Message[];attachments:{message_id:string;id:string;filename:string}[];hasMore:boolean;nextBefore:number|null;userId:string;kind:string;contextKind:string;contextId:string}
export function MessageTeder({label='Message Teder'}:{label?:string}) {
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 return <><button type="button" className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await call<{id:string}>('dmSupport');location.assign('/workspace/messages/'+result.id)}catch(e){setError(e instanceof Error?e.message:'Could not open support.');setBusy(false)}}}>{busy?'Opening…':label}</button>{error&&<p className="error" role="alert">{error}</p>}</>
}
export function TradeContact({kind,contextId}:{kind:'energy'|'bunker'|'power';contextId:string}) {
 const [contacts,setContacts]=useState<{id:string;username:string;company_name:string}[]|null>(null),[error,setError]=useState('')
 return <section><button type="button" className="secondary" onClick={()=>call<{contacts:NonNullable<typeof contacts>}>('dmContacts',{kind,contextId}).then(r=>{setContacts(r.contacts);setError('')}).catch(e=>setError(e.message))}>Message a trading representative</button>
 {error&&<p role="alert">{error}</p>}
 {contacts&&<Form submit="Open private conversation" onSubmit={async f=>{const r=await call<{id:string}>('dmOpen',{kind,contextId,peerId:field(f,'peer')});location.assign('/workspace/messages/'+r.id)}}><label>Authorized representative<select name="peer" required><option value="">Choose a person</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.company_name} · {c.username}</option>)}</select></label>{!contacts.length&&<p>No active representatives are available. Message Teder for assistance.</p>}</Form>}
 </section>
}
export function Messages({path}:{path:string}) {
 const id=path.split('/')[3], [conversations,setConversations]=useState<Conversation[]>([]),[thread,setThread]=useState<Thread|null>(null),[older,setOlder]=useState<Message[]>([]),[attachments,setAttachments]=useState<Thread['attachments']>([]),[error,setError]=useState(''),[documents,setDocuments]=useState<PrivateDocument[]>([]),[selected,setSelected]=useState<string[]>([]),[text,setText]=useState(''),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID())
 async function refresh(){try{
  const data=await call<{conversations:Conversation[]}>('dmList');setConversations(data.conversations)
  if(id){const next=await call<Thread>('dmMessages',{conversationId:id});setThread(next);if(next.messages.length&&!document.hidden)await call('dmRead',{conversationId:id,through:next.messages[next.messages.length-1].created_at})}
  setError('')
 }catch(e){setError(e instanceof Error?e.message:'Could not load conversations.')}}
 useEffect(()=>{setOlder([]);setOlderComplete(false);setAttachments([]);setThread(null);setSelected([]);void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh()},5000);return()=>window.clearInterval(timer)},[id])
 const [olderComplete,setOlderComplete]=useState(false)
 const conversation=conversations.find(c=>c.id===id)
 const allMessages=[...older,...(thread?.messages??[])].filter((m,i,arr)=>arr.findIndex(x=>x.id===m.id)===i)
 const allAttachments=[...attachments,...(thread?.attachments??[])]
 return <section className="workspace"><div className="section-head"><h1>Messages</h1><button type="button" className="secondary" onClick={()=>void refresh()}>Refresh</button></div><p>Private one-to-one conversations. Updates refresh while this page is open. Contract and quote changes require their separate acceptance actions.</p>
 {error&&<p role="alert" className="error">{error}</p>}
 <div className="message-layout"><nav className="message-list" aria-label="Conversations"><ul className="records">{conversations.map(c=><li key={c.id}><a href={'/workspace/messages/'+c.id} aria-current={c.id===id?'page':undefined}><strong>{c.peer_name}{c.unread?` · ${c.unread} unread`:''}</strong><span>{c.company_name} · {c.kind==='support'?'Teder support':c.context_kind+' trade'}</span><small>{c.preview?.slice(0,120)||'Start the conversation'}</small></a></li>)}</ul>{!conversations.length&&<p>No conversations yet. Open Message Teder or choose a representative in an introduced trade.</p>}</nav>
 <div>{!id?<p>Select a conversation.</p>:!thread?<p role="status">Loading conversation…</p>:<>
 <h2>{conversation?.peer_name||'Private conversation'}</h2>
 {thread.contextId&&<p><a href={'/workspace/'+({energy:'energy',bunker:'bunkers',power:'requests'}[thread.contextKind]||'energy')+'/'+thread.contextId}>Open related trade</a></p>}
 <p>The two named participants can read this thread. A company owner can assign a removed representative’s business conversation to a replacement. Company evidence remains in the verification workspace unless you explicitly attach it here.</p>
 {thread.hasMore&&!olderComplete&&<button type="button" className="secondary" onClick={async()=>{try{const before=older.length?older[0].created_at:thread.messages[0]?.created_at;const page=await call<Thread>('dmMessages',{conversationId:id,before});setOlderComplete(!page.hasMore);setOlder(current=>[...page.messages,...current]);setAttachments(current=>[...page.attachments,...current]);setThread(current=>current?{...current,hasMore:page.hasMore}:current)}catch(e){setError(e instanceof Error?e.message:'Could not load older messages.')}}}>Load older messages</button>}
 <ol className="message-history">{allMessages.map(m=><li key={m.id} className={m.sender_id===thread.userId?'mine':''}><strong>{m.sender_id===thread.userId?'You':m.sender_name}</strong><p>{m.body}</p><small>{new Date(m.created_at).toLocaleString()}</small>{allAttachments.filter(a=>a.message_id===m.id).map(a=><button key={a.id} type="button" className="secondary" onClick={()=>downloadDocument('dm',id,a.id).catch(e=>setError(e.message))}>{a.filename}</button>)}</li>)}</ol>
 <Form submit="Send private message" onSubmit={async()=>{await call('dmSend',{conversationId:id,requestKey,message:text,documents:selected});setText('');setSelected([]);setRequestKey(crypto.randomUUID());await refresh()}}><label>Message<textarea name="message" rows={4} maxLength={4000} required value={text} onChange={e=>setText(e.target.value)}/></label>
 {documents.length>0&&<fieldset><legend>Attach uploaded documents</legend>{documents.map(d=><label key={d.id} className="check"><input type="checkbox" checked={selected.includes(d.id)} disabled={!selected.includes(d.id)&&selected.length>=6} onChange={e=>setSelected(current=>e.target.checked?[...current,d.id]:current.filter(id=>id!==d.id))}/>{d.filename}</label>)}</fieldset>}</Form>
 <details><summary>Upload an attachment</summary><Documents scope="dm" scopeId={id} categories={['other','contract','delivery','invoice','payment']} onChange={setDocuments}/></details>
 <details><summary>Report a concern to Teder</summary><Form submit="Submit report" onSubmit={async f=>{await call('dmReport',{conversationId:id,reason:field(f,'reason')});setError('Report recorded. Message Teder if you need a reply.')}}><Notes label="Concern and relevant message dates" name="reason"/></Form></details>
 </> }</div></div></section>
}

export function RepresentativeHandover() {
 const [data,setData]=useState<{conversations:{id:string;context_kind:string;prior_user_id:string;prior_username:string;other_username:string}[];members:{id:string;username:string}[]}|null>(null),[error,setError]=useState('')
 async function refresh(){setData(await call('dmHandoverQueue'))}
 useEffect(()=>{void refresh().catch(e=>setError(e.message))},[])
 return <section><h2>Conversations needing a replacement</h2><p>A removed representative loses access. A company owner can assign the business conversation and its history to a named replacement.</p>{error&&<p role="alert" className="error">{error}</p>}{data?.conversations.map(c=><Form key={c.id} submit="Assign replacement representative" onSubmit={async f=>{await call('dmHandover',{conversationId:c.id,priorUserId:c.prior_user_id,nextUserId:field(f,'replacement')});await refresh()}}><p>{c.prior_username} ↔ {c.other_username} · {c.context_kind}</p><label>Replacement<select name="replacement" required><option value="">Choose an active teammate</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.username}</option>)}</select></label></Form>)}{data?.conversations.length===0&&<p>No removed representative has a trade conversation awaiting reassignment.</p>}</section>
}
