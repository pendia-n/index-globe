import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Factory, Flame, Waves, Wind, Sun, Atom, BatteryCharging, Layers } from 'lucide-react'
import type { User } from './client'

const marketSources = [
  { name: 'Solar', Icon: Sun }, { name: 'Wind', Icon: Wind }, { name: 'Hydro', Icon: Waves },
  { name: 'Nuclear', Icon: Atom }, { name: 'Gas generation', Icon: Flame }, { name: 'Coal generation', Icon: Factory },
  { name: 'Storage-backed', Icon: BatteryCharging },
]

const example = [
  { title: 'Request', state: 'Invited suppliers', rows: [['Delivery point', 'Example grid connection'], ['Delivery window', '18:00–22:00 SGT'], ['Requested volume', '2.00 MWh']] },
  { title: 'Compare', state: 'Two private replies', rows: [['Supplier A · Firm', 'SGD 148.00 / MWh'], ['Supplier B · Indicative', 'SGD 142.00 / MWh'], ['Award authority', 'Buyer company owner']] },
  { title: 'Deliver', state: 'Supplier reported', rows: [['Agreed quantity', '2.00 MWh'], ['Reported quantity', '1.95 MWh'], ['Buyer review', '0.05 MWh shortfall']] },
]

export function Brand() {
  return <a href="/" className="brand" aria-label="Teder home"><img src="/teder.svg" alt="" width="35" height="35" />teder</a>
}

export function Landing({ user }: { user: User | null }) {
  const [stage, setStage] = useState(0)
  const panel = example[stage]
  return <>
    <section className="hero">
      <img className="hero-photo" src="/transmission.webp" alt="" width="1600" height="1067" fetchPriority="high" />
      <div className="hero-copy">
        <div className="eyebrow">Private B2B energy trading</div>
        <h1>Trade energy.<br />Track delivery.</h1>
        <p>Invite approved suppliers, compare offers on the same delivery terms, and manage the deal through reconciliation.</p>
        <div className="hero-actions"><a className="button" href={user ? '/workspace' : '/register'}>{user ? 'Open workspace' : 'Register your company'} <ArrowUpRight size={18} /></a>
          <a href="#markets">Explore market access <ArrowRight size={16} /></a></div>
      </div>
    </section>
    <section className="market-band" id="markets" aria-labelledby="markets-title">
      <div><span className="eyebrow">Pilot market</span><h2 id="markets-title">Physical power · Singapore</h2>
        <p>Approved companies can negotiate grid-delivered electricity by location, delivery window, and generation requirement.</p></div>
      <ul className="source-list" aria-label="Generation sources that buyers can request">
        {marketSources.map(({ name, Icon }) => <li key={name}><Icon size={17} aria-hidden="true" />{name}</li>)}
      </ul>
    </section>
    <section className="walkthrough" aria-labelledby="workflow-title">
      <div><div className="eyebrow">Trade workflow</div><h2 id="workflow-title">From request to reconciliation</h2>
        <p>Request the supply you need, negotiate privately with each supplier, and reconcile what arrived against the deal.</p>
        <a href="/about">See how Teder works <ArrowRight size={16} /></a></div>
      <div className="trade-console">
        <div className="console-head"><strong><Layers size={17} aria-hidden="true" /> Supply request</strong><span>Sample data</span></div>
        <div className="demo-controls" aria-label="Example trade stage">
          {example.map((step, index) => <button type="button" className="secondary" aria-pressed={stage === index} key={step.title} onClick={() => setStage(index)}>{step.title}</button>)}
        </div>
        <div role="status" className="console-content"><b>{panel.state}</b><dl>{panel.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
      </div>
    </section>
    <div className="expansion"><strong>Additional markets</strong><p>Physical gas, oil products, and cross-border power are planned. Each market requires approved counterparties, delivery routes, and operating arrangements.</p></div>
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
