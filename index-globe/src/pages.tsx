import { Shell } from "./shell";
type User = { username: string };
type PublicPage = "about" | "pricing" | "announcements";

const flows = [
  {
    key: "physical", label: "Physical electricity", icon: "↗", note: "The grid balances supply and demand. Metered matching attributes a contractual volume at each interval.",
    steps: [
      ["Generation site", "A generation site exports electricity to the network.", "Export meter"],
      ["Shared power grid", "Network and market operators manage electricity flows.", "Grid operator"],
      ["Business site", "The business draws power and its meter records consumption.", "Import meter"],
    ],
  },
  {
    key: "financial", label: "Contracts and money", icon: "↔", note: "The licensed supplier issues official invoices or credits and handles payment. Renewable certificate rights are recorded separately.",
    steps: [
      ["Agree an offer", "Buyer and producer agree price, period and terms.", "Index Globe"],
      ["Supplier reviews", "Confirm eligibility, remaining supply and the billing method.", "Licensed supplier"],
      ["Invoice and pay", "Metered volumes inform the bill and producer payment.", "Licensed supplier"],
    ],
  },
];

export function PublicScreen({ page, user, pilotStatus }: { page: PublicPage; user?: User | null; pilotStatus?: string }) {
  return <Shell user={user} active={page}>
    {page === "about" && <article className="about-page">
      <header className="page-intro"><p className="eyebrow">How it works</p><h1>One deal, two paths.</h1><p>Compare electricity from different sources. The grid operator manages delivery and a licensed supplier handles billing and settlement.</p></header>
      <div className="flows">{flows.map(flow => <section className={"flow " + flow.key} key={flow.key}>
        <h2><span aria-hidden="true">{flow.icon}</span> {flow.label}</h2>
        <ol>{flow.steps.map(([title, body, actor]) => <li key={title}><small>{actor}</small><strong>{title}</strong><p>{body}</p></li>)}</ol>
        <p className="flow-note">{flow.note}</p>
      </section>)}</div>
      <div className="about-bottom"><h2>When a deal can go live</h2><p>A comparison can show which intervals match and how agreed prices apply. A live deal becomes active only after the supplier, generator and buyer confirm the signed terms.</p><a href="/" className="button secondary">Browse the power market</a></div>
    </article>}
    {page === "pricing" && <article className="pricing-page">
      <header className="page-intro"><p className="eyebrow">Pricing</p><h1>Start exploring. Pay for a live pilot.</h1><p>Software pricing is separate from the price of electricity and the supplier’s charges.</p></header>
      <div className="plans">
        <section className="panel plan"><h2>Explore</h2><strong className="plan-price">Free</strong><p>For buyers and generators evaluating their next deal.</p><ul><li>Browse published offers and requests</li><li>Create a private workspace</li><li>Draft offers and review terms with a counterparty</li></ul><a className="button secondary" href={user ? "/workspace" : "/signup"}>{user ? "Open workspace" : "Create workspace"}</a></section>
        <section className="panel plan paid"><h2>Supplier pilot</h2><strong className="plan-price">Fixed quote</strong><p>For a supplier running a real transaction with approved data.</p><ul><li>Agree scope and onboarding cost up front</li><li>Review one supplier format and billing cycle</li><li>Set a recurring workspace fee after the pilot</li></ul>
          {user ? pilotStatus ? <p className="inline-result" role="status">{pilotStatus}</p> : <form action="/pricing/pilot" method="post"><button className="button">Request pilot review</button></form> : <a className="button" href="/signup">Create a workspace to request a pilot</a>}
        </section>
      </div>
      <p className="pricing-note">A pilot request records your interest. Payment and activation follow a separate agreement.</p>
    </article>}
    {page === "announcements" && <article className="announcements-page">
      <header className="page-intro"><p className="eyebrow">Index Globe updates</p><h1>Announcements</h1></header>
      <section className="panel empty-news"><h2>No announcements yet</h2><p>Product and pilot updates will appear here.</p><a href="/" className="button secondary">Browse the power market</a></section>
    </article>}
  </Shell>;
}
