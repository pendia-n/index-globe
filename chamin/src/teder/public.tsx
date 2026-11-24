import { ArrowUpRight } from 'lucide-react'
import type { User } from './client'

export function Brand() {
  return <a href="/" className="brand" aria-label="Teder home"><img src="/teder.svg" alt="" width="35" height="35" />teder</a>
}

export function Landing({ user }: { user: User | null }) {
  return <>
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Private energy procurement</p>
        <h1>Source marine fuel</h1>
        <p>Send your vessel’s fuel requirements and delivery window. We’ll check whether the port and grade can be supported.</p>
        <div className="hero-actions">
          <a className="button" href="/bunker">Submit a bunker request <ArrowUpRight size={18} /></a>
          {user && <a href="/workspace/bunkers">Open marine fuel workspace</a>}
        </div>
      </div>
    </section>
    <section className="information" id="markets">
      <h2>Port enquiries</h2>
      <p>Submit requests for Singapore, Fujairah, or Rotterdam. Availability depends on the order and supplier.</p>
    </section>
  </>
}

export function Information({ page }: { page: string }) {
  if (page === '/announcements') return <section className="information"><h1>Announcements</h1><p>No announcements yet.</p><a href="/bunker">Request or check marine fuel coverage</a></section>
  if (page === '/pricing') return <section className="information"><h1>Pricing</h1><p>Teder agrees any service fee with the payer separately. The fuel supplier invoices the buyer for the fuel under their agreement.</p><a className="button" href="/bunker">Submit a bunker request</a></section>
  return <section className="information"><h1>About Teder</h1>
    <p>Teder gives buyers, suppliers, and their appointed brokers a private workspace for marine fuel procurement.</p>
    <h2>Company verification</h2><p>Register a workspace for your legal entity and submit evidence of your authority to act. Approval is separate from supplier or broker eligibility at a port.</p>
    <h2>Quotes and orders</h2><p>Buyers and their appointed brokers can invite eligible suppliers for an active port. Suppliers quote privately. The buyer selects an offer and the supplier confirms the order.</p>
    <h2>Delivery and settlement</h2><p>The buyer and supplier arrange delivery and payment under their agreement. Teder records nomination, shared evidence, disputes, invoices, and receipt confirmations.</p>
    <a className="button" href="/bunker">Request marine fuel</a>
  </section>
}
