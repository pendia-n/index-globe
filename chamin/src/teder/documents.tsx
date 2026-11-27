import { useEffect, useState } from 'react'
import { call,field } from './client'
import { Form } from './forms'
export type PrivateDocument={id:string;category:string;filename:string;mime:string;sha256:string;bytes:number;uploaded_at:number;uploaded_by:string}
export async function downloadDocument(scope:string,scopeId:string,documentId:string) {
 const response=await fetch('/api/teder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'documentDownload',scope,scopeId,documentId})})
 if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||'Download unavailable.')}
 const blob=await response.blob(),url=URL.createObjectURL(blob)
 const anchor=document.createElement('a');anchor.href=url
 anchor.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'evidence'
 anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function Documents({scope,scopeId,categories=['other'],readOnly=false,onChange}:{scope:'company'|'dm'|'energy';scopeId:string;categories?:string[];readOnly?:boolean;onChange?:(documents:PrivateDocument[])=>void}) {
 const [documents,setDocuments]=useState<PrivateDocument[]>([]),[error,setError]=useState('')
 async function refresh(){const data=await call<{documents:PrivateDocument[]}>('documentList',{scope,scopeId});setDocuments(data.documents);onChange?.(data.documents)}
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[scope,scopeId])
 return <section className="evidence"><h3>{scope==='company'?'Private company evidence':scope==='dm'?'Conversation attachments':'Deal evidence'}</h3>
 <p>PDF, PNG or JPEG · maximum 1 MiB each. Download access is checked for every request.</p>
 {error&&<p className="error" role="alert">{error}</p>}
 {!readOnly&&<Form submit="Upload document" onSubmit={async f=>{
  const file=f.get('document');if(!(file instanceof File)||!file.size)throw new Error('Choose a document.')
  if(file.size>1048576)throw new Error('Maximum file size is 1 MiB. Export a smaller copy before uploading.')
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const value of bytes)binary+=String.fromCharCode(value)
  await call('documentUpload',{scope,scopeId,name:file.name,category:field(f,'category'),contents:btoa(binary)})
  setError('');await refresh()
 }}><label>Evidence type<select name="category">{categories.map(c=><option key={c} value={c}>{c.replaceAll('-',' ')}</option>)}</select></label><label>Document<input type="file" name="document" accept="application/pdf,image/png,image/jpeg" required/></label></Form>}
 <ul className="records">{documents.map(d=><li key={d.id}><button type="button" className="secondary" onClick={()=>downloadDocument(scope,scopeId,d.id).catch(e=>setError(e.message))}>{d.filename}</button><small>{d.category} · {Math.ceil(d.bytes/1024)} KiB · {new Date(d.uploaded_at).toLocaleString()} · {d.uploaded_by}</small><details><summary>Integrity fingerprint</summary><code>{d.sha256}</code></details></li>)}</ul>
 {!documents.length&&<p>No documents uploaded.</p>}
 </section>
}
