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
  if (page === '/announcements') return <section className="information"><h1>Announcements</h1><p>No announcements yet.</p><a href="/about">Read about the pilot</a></section>
  if (page === '/pricing') return <section className="information"><h1>Pricing</h1><p>Register a company to request pilot access. Pilot service fees, if any, are agreed with participants before trading. Companies settle physical supply under their signed agreements.</p><a className="button" href="/register">Register your company</a></section>
  return <section className="information"><h1>About Teder</h1><p>Teder gives buyers and suppliers a shared record of physical energy procurement, from a private tender to delivery review.</p>
    <h2>Company access</h2><p>Register one workspace for your legal entity. Each workspace supports five named seats, including the owner. A reviewer confirms company identity and pilot eligibility before trading starts.</p>
    <h2>How trades work</h2><p>Buyers send one requirement to selected suppliers. Each supplier negotiates privately. The buyer compares terms and selects a firm offer. Both parties acknowledge the signed agreement, record scheduling, and reconcile supplier-reported quantities.</p>
    <h2>Delivery and settlement</h2><p>Market participants arrange physical delivery and settle with each other. Teder records their supporting references and review decisions.</p>
    <h2>Market coverage</h2><p>The current pilot covers Singapore grid-delivered power. Physical oil and gas and cross-border routes require separate market arrangements.</p>
    <p className="photo-credit">Transmission photograph by <a href="https://commons.wikimedia.org/wiki/File:Matthew_Henry_2016-09-08_(Unsplash).jpg">Matthew Henry</a>.</p>
  </section>
}
