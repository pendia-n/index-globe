import { useEffect, useState } from 'react'
import { call } from './client'

type Notice = { id:string; kind:string; href:string; occurred_at:number; read_at:number|null }
const titles: Record<string,string> = {
  energy_update:'Your energy case has an update',
  energy_invitation:'Your company was invited to an energy tender',
  enquiry_received:'A new bunker enquiry needs review',
  enquiry_assigned:'A bunker enquiry was assigned to your company',
  company_application:'A company submitted an application',
  company_approved:'Company verification approved',
  company_correction:'Company application needs correction',
  supplier_invited:'Your company was invited to quote',
  quote_received:'A supplier sent a quote',
  counter_received:'A buyer sent a counteroffer',
  request_cancelled:'The buyer cancelled a request',
  request_revised:'The buyer revised a request',
  offer_selected:'A buyer selected your offer',
  order_confirmed:'The supplier confirmed the order',
  order_declined:'The supplier declined the selection',
  order_withdrawn:'The buyer withdrew the selection',
  fulfilment_nominate:'The supplier updated the nomination',
  fulfilment_delay:'The supplier reported a delay',
  fulfilment_report:'The supplier submitted a delivery report',
  fulfilment_deliveryReview:'The buyer reviewed delivery',
  fulfilment_invoice:'The supplier recorded an invoice',
  fulfilment_voidInvoice:'The supplier voided an invoice',
  fulfilment_pay:'The buyer reported payment',
  fulfilment_receipt:'The supplier reviewed payment',
  fulfilment_cancelProposal:'The other party proposed cancelling the order',
  fulfilment_cancelDecision:'The other party responded to cancellation',
  broker_assigned:'A buyer appointed your company as broker',
  fee_issued:'A Teder service fee was issued',
  fee_reported:'A Teder fee payer reported payment',
  fee_received:'Receipt of a Teder service fee was confirmed',
  ownership_requested:'You were nominated as company owner',
}
const date = new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})

export function TradeInbox() {
  const [notices,setNotices] = useState<Notice[] | null>(null)
  const [error,setError] = useState('')
  async function refresh() {
    try {
      setError('')
      setNotices((await call<{notifications:Notice[]}>('tradeInbox')).notifications)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the inbox.') }
  }
  async function mark(notice: Notice) {
    try {
      await call('tradeInboxRead',{notificationId:notice.id})
      setNotices(current => current?.map(item => item.id === notice.id ? {...item,read_at:Date.now()} : item) ?? null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not mark the update as read.') }
  }
  useEffect(() => { void refresh() }, [])
  return <section className="workspace">
    <div className="section-head"><h1>Trade inbox</h1><button className="secondary" type="button" onClick={() => void refresh()}>Refresh inbox</button></div>
    <p>Updates for your workspace from the last 90 days.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!notices && !error && <p role="status">Loading updates…</p>}
    {notices?.length === 0 && <p>No updates yet.</p>}
    {notices?.length ? <ul className="records">{notices.map(notice => <li key={notice.id}>
      <a href={notice.href}>{titles[notice.kind] ?? 'Trade update'}</a>
      <small>{date.format(notice.occurred_at)} UTC · {notice.read_at ? 'Read' : 'Unread'}</small>
      {!notice.read_at && <button type="button" className="secondary" onClick={() => void mark(notice)}>Mark as read</button>}
    </li>)}</ul> : null}
  </section>
}
