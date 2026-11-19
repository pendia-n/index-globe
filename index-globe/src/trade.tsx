import { env } from "cloudflare:workers";
import { route } from "rwsdk/router";
import { currentUser } from "./auth";
import { Shell } from "./shell";
import { isPowerSource, powerSources, type PowerSource } from "./power-sources";

const { DB, DOCUMENTS } = env as unknown as { DB: D1Database; DOCUMENTS: R2Bucket };
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Party = "buyer" | "seller" | "supplier";
type MeterParty = Exclude<Party, "supplier">;
type State = "negotiating" | "supplier_review" | "changes_requested" | "reviewed";
type Offer = {
  id: string; seller_id: string; seller: string; site: string; region: string;
  starts_on: string; ends_on: string; volume_kwh: number; price_pence: number;
  status: "open" | "withdrawn"; source: PowerSource;
};
type Deal = {
  id: string; offer_id: string; producer_site: string; buyer_id: string; seller_id: string;
  supplier_id: string | null; buyer: string; seller: string; reviewer: string | null;
  buyer_site: string; status: State; quote_version: number;
  supplier_name: string | null; supplier_reference: string | null; supplier_note: string | null;
  sleeve_price_pence: number | null; remaining_price_pence: number | null;
  available_from: string; available_to: string; available_kwh: number; source: PowerSource;
};
type Terms = {
  version: number; author_id: string; author: string; starts_on: string;
  ends_on: string; volume_kwh: number; price_pence: number; note: string;
};
type MeterFile = { id: string; object_key: string; role: MeterParty; intervals: number };

const offerQuery = `
  SELECT power_offers.*, users.username AS seller
  FROM power_offers JOIN users ON users.id = seller_id
`;
const dealQuery = `
  SELECT deals.*, o.source, o.site AS producer_site, b.username AS buyer, s.username AS seller, p.username AS reviewer,
    o.starts_on AS available_from, o.ends_on AS available_to, o.volume_kwh AS available_kwh
  FROM deals
  JOIN power_offers o ON o.id = deals.offer_id
  JOIN users b ON b.id = deals.buyer_id JOIN users s ON s.id = deals.seller_id
  LEFT JOIN users p ON p.id = deals.supplier_id
`;
const dealScope = "(deals.buyer_id = ? OR deals.seller_id = ? OR deals.supplier_id = ?)";
const states: Record<State, string> = {
  negotiating: "Negotiating",
  supplier_review: "Supplier review",
  changes_requested: "Changes requested",
  reviewed: "Supplier review recorded",
};
const notices: Record<string, string> = {
  saved: "Changes saved.",
  bad: "Check the dates, volume and price. Dates and volume must fit within the listed offer.",
  site: "Choose an electricity source and enter the site, region, dates, volume and price.",
  closed: "This offer is no longer open for new requests.",
  stale: "The deal changed while you were working. Review the current terms and try again.",
  supplier: "Enter a registered username for a reviewer who is outside this deal.",
  review: "Enter the supplier name, agreement reference, and both rates to record the review.",
  attachment: "Choose a CSV under 512 KB with timestamp_utc and kwh columns. Use unique half-hour UTC intervals within the agreed dates.",
  uploaded: "Meter file saved. The comparison uses the latest file from each party.",
  capacity: "The quote changed or the listed volume has already been reserved. Check the current terms.",
  file_limit: "This meter file has reached its revision limit.",
};

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const amount = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });
const pounds = (pence: number) => money.format(pence / 100);
const mwh = (kwh: number) => amount.format(kwh / 1000);
const kwh = (wh: number) => amount.format(wh / 1000);
const urlFor = (id: string) => "/deals/" + id;
const offerUrl = (id: string) => "/offers/" + id;

function redirect(path: string, notice?: string) {
  return new Response(null, {
    status: 303, headers: { Location: path + (notice ? "?notice=" + notice : "") },
  });
}

function missing() {
  return new Response("This workspace item was not found.", { status: 404 });
}

function text(form: FormData, field: string, length: number) {
  const input = form.get(field);
  if (typeof input !== "string") return "";
  const value = input.trim();
  return value.length <= length ? value : "";
}

function decimal(value: string, precision: number, limit: number) {
  if (!new RegExp("^\\d+(?:\\.\\d{1," + precision + "})?$").test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number(whole) * 10 ** precision + Number(fraction.padEnd(precision, "0"));
  return Number.isSafeInteger(scaled) && scaled <= limit ? scaled : null;
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readTerms(form: FormData) {
  const start = text(form, "start", 10);
  const end = text(form, "end", 10);
  const volume = decimal(text(form, "volume", 16), 3, 1_000_000_000);
  const price = decimal(text(form, "price", 14), 2, 10_000_000);
  if (!isDate(start) || !isDate(end) || end < start || volume == null || volume === 0 || price == null) return null;
  if (Date.parse(end) - Date.parse(start) > 366 * 86_400_000) return null;
  return { start, end, volume, price };
}

function inOffer(terms: NonNullable<ReturnType<typeof readTerms>>, start: string, end: string, volume: number) {
  return terms.start >= start && terms.end <= end && terms.volume <= volume;
}

function readVersion(form: FormData) {
  const value = text(form, "version", 10);
  return /^\d+$/.test(value) ? Number(value) : 0;
}

function roleOf(deal: Deal, user: User): Party {
  if (deal.buyer_id === user.id) return "buyer";
  if (deal.seller_id === user.id) return "seller";
  return "supplier";
}

const lookupOffer = (id: string) => DB.prepare(offerQuery + " WHERE power_offers.id = ?").bind(id).first<Offer>();

const lookupDeal = (id: string, user: User) =>
  DB.prepare(dealQuery + " WHERE deals.id = ? AND " + dealScope).bind(id, user.id, user.id, user.id).first<Deal>();

async function quotes(id: string) {
  const results = await DB.prepare(`
    SELECT q.*, u.username AS author FROM deal_quotes q JOIN users u ON u.id = q.author_id
    WHERE deal_id = ? ORDER BY version DESC
  `).bind(id).all<Terms>();
  return results.results;
}

function Notice({ request }: { request: Request }) {
  const key = new URL(request.url).searchParams.get("notice") ?? "";
  return Object.hasOwn(notices, key) ? <p className="trade-notice" role="status">{notices[key]}</p> : null;
}

function TermsFields({ start, end, volume, price, newOffer = false }: {
  start?: string; end?: string; volume?: number; price?: number; newOffer?: boolean;
}) {
  return <div className="trade-fields">
    <label>Delivery starts · UTC<input name="start" type="date" defaultValue={start} required /></label>
    <label>Delivery ends · UTC<input name="end" type="date" defaultValue={end} required /></label>
    <label>{newOffer ? "Available" : "Proposed"} volume · MWh<input name="volume" type="number" inputMode="decimal" min=".001" max="1000000" step=".001" defaultValue={volume} required /></label>
    <label>Energy price · £/MWh<input name="price" type="number" inputMode="decimal" min="0" max="100000" step=".01" defaultValue={price} required /></label>
  </div>;
}

function Workspace({ user, offers, deals, request }: {
  user: User; offers: Offer[]; deals: Deal[]; request: Request;
}) {
  return <Shell user={user} active="workspace">
    <div className="trade-wrap">
      <header className="trade-heading">
        <div><p className="eyebrow">Great Britain · Electricity</p><h1>Trading desk</h1>
          <p>Find a producer, agree a quote, and invite a supplier to review the deal.</p></div>
        <a className="button" href="/workspace/offer">List electricity supply</a>
      </header>
      <Notice request={request} />
      <div className="trade-board">
        <section className="trade-section" aria-labelledby="my-deals">
          <h2 id="my-deals">Your deals</h2>
          {deals.length === 0 ? <p className="trade-empty">No deals yet. Open an offer to send your first request.</p> :
            <ul className="trade-list">
              {deals.map((deal) => <li key={deal.id}><a href={urlFor(deal.id)}>
                <span><strong>{deal.producer_site} → {deal.buyer_site}</strong><small>{roleOf(deal, user)} · Quote {deal.quote_version}</small></span>
                <span className="trade-status">{states[deal.status]}</span>
              </a></li>)}
            </ul>}
        </section>
        <section className="trade-section" aria-labelledby="offers">
          <h2 id="offers">Available power offers</h2>
          <form action="/workspace#offers" method="get" className="source-filter">
            <label>Filter by source<select name="source" defaultValue={new URL(request.url).searchParams.get("source") ?? ""}>
              <option value="">All sources</option>
              {Object.entries(powerSources).map(([key, source]) => <option key={key} value={key}>{source.label}</option>)}
            </select></label>
            <button className="button secondary">Apply</button>
          </form>
          {offers.length === 0 ? <p className="trade-empty">No producers have listed supply yet. If you export electricity, list your site and available volume.</p> :
            <ul className="trade-offers">
              {offers.map((offer) => <li key={offer.id}>
                <a href={offerUrl(offer.id)} className="trade-offer">
                  <span className="trade-offer-top"><span>{powerSources[offer.source].label} · {offer.region}</span><span>{offer.seller_id === user.id ? "Your offer" : "Seller-listed"}</span></span>
                  <strong>{offer.site}</strong>
                  <span>{offer.starts_on} to {offer.ends_on}</span>
                  <span className="trade-offer-numbers"><b>{mwh(offer.volume_kwh)} MWh</b><b>{pounds(offer.price_pence)}<small> / MWh</small></b></span>
                </a>
              </li>)}
            </ul>}
        </section>
      </div>
    </div>
  </Shell>;
}

function NewOffer({ user, request }: { user: User; request: Request }) {
  return <Shell user={user} active="workspace">
    <div className="trade-wrap trade-narrow">
      <a className="trade-back" href="/workspace">← Trading desk</a>
      <header className="trade-heading"><div><p className="eyebrow">Producer</p><h1>List electricity supply</h1>
        <p>Publish an indicative offer using export volume your site can commit for this period.</p></div></header>
      <Notice request={request} />
      <form className="trade-form panel" action="/workspace/offer" method="post">
        <div className="trade-fields">
          <label>Electricity source<select name="source" defaultValue="" required><option value="" disabled>Choose a source</option>
            {Object.entries(powerSources).map(([key, source]) => <option key={key} value={key}>{source.label}</option>)}
          </select></label>
          <label>Generation site<input name="site" maxLength={100} required /></label>
          <label>Site region · Great Britain<input name="region" placeholder="e.g. West Midlands" maxLength={60} required /></label>
        </div>
        <TermsFields newOffer />
        <label className="trade-check"><input name="permission" type="checkbox" value="yes" required />I represent this site and can discuss selling its export volume.</label>
        <button className="button" type="submit">Publish offer</button>
      </form>
    </div>
  </Shell>;
}

function OfferPage({ user, offer, existing, request }: {
  user: User; offer: Offer; existing: { id: string } | null; request: Request;
}) {
  const ownsOffer = user.id === offer.seller_id;
  return <Shell user={user} active="workspace">
    <div className="trade-wrap">
      <a className="trade-back" href="/workspace">← Trading desk</a>
      <header className="trade-heading"><div><p className="eyebrow">{powerSources[offer.source].label} · {offer.region}</p><h1>{offer.site}</h1>
        <p>{powerSources[offer.source].category} · Listed by {offer.seller}. Site and volumes supplied by the producer.</p></div>
        <span className="trade-status">{offer.status === "open" ? "Open for requests" : "Withdrawn"}</span>
      </header>
      <Notice request={request} />
      <div className="trade-split">
        <section className="panel trade-summary">
          <h2>Listed terms</h2>
          <dl>
            <div><dt>Available</dt><dd>{mwh(offer.volume_kwh)} MWh</dd></div>
            <div><dt>Asking price</dt><dd>{pounds(offer.price_pence)} / MWh</dd></div>
            <div><dt>Delivery dates</dt><dd>{offer.starts_on} to {offer.ends_on}</dd></div>
          </dl>
          <p>Supplier charges and remaining demand are confirmed during supplier review.</p>
        </section>
        <section className="panel">
          {ownsOffer ? <>
            <h2>Manage your offer</h2>
            <p>Existing deal requests are in your trading desk.</p>
            {offer.status === "open" && <form action={offerUrl(offer.id) + "/withdraw"} method="post">
              <button className="button secondary" type="submit">Stop accepting new requests</button>
            </form>}
          </> : existing ? <>
            <h2>Your request</h2><p>A negotiation for this offer already exists.</p>
            <a className="button" href={urlFor(existing.id)}>Open deal</a>
          </> : offer.status === "open" ? <>
            <h2>Request this supply</h2>
            <form action={offerUrl(offer.id) + "/request"} method="post" className="trade-form">
              <label>Business site<input name="site" maxLength={100} required /></label>
              <TermsFields start={offer.starts_on} end={offer.ends_on} volume={offer.volume_kwh / 1000} price={offer.price_pence / 100} />
              <label>Message to producer <small>Optional</small><textarea name="note" maxLength={400} rows={3} /></label>
              <button className="button" type="submit">Send request</button>
            </form>
          </> : <p>This producer has stopped accepting requests.</p>}
        </section>
      </div>
    </div>
  </Shell>;
}

type MeterReading = Map<string, number>;

function parseMeter(raw: string, start: string, end: string): MeterReading | null {
  const [header, ...lines] = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (header !== "timestamp_utc,kwh" || lines.length === 0) return null;
  const readings: MeterReading = new Map();
  for (const line of lines) {
    const cells = line.split(",");
    if (cells.length !== 2) return null;
    const [timestamp, reading] = cells;
    if (!/^\d{4}-\d{2}-\d{2}T\d\d:(00|30):00Z$/.test(timestamp)) return null;
    const date = timestamp.slice(0, 10);
    const value = decimal(reading, 3, 10_000_000_000);
    if (!isDate(date) || Number(timestamp.slice(11, 13)) > 23 || date < start || date > end ||
      readings.has(timestamp) || value == null) return null;
    readings.set(timestamp, value);
  }
  return readings;
}

function meterFiles(id: string) {
  return DB.prepare(`
    SELECT f.id, f.object_key, f.role, f.intervals
    FROM deal_meter_files f WHERE f.deal_id = ? AND f.sequence = (
      SELECT MAX(g.sequence) FROM deal_meter_files g WHERE g.deal_id = f.deal_id AND g.role = f.role
    )
  `).bind(id).all<MeterFile>().then(({ results }) => results);
}

async function compareMeters(files: MeterFile[], quote: Terms) {
  const buyer = files.find((file) => file.role === "buyer");
  const seller = files.find((file) => file.role === "seller");
  if (!buyer || !seller) return null;
  const [consumptionFile, exportFile] = await Promise.all([
    DOCUMENTS.get(buyer.object_key), DOCUMENTS.get(seller.object_key),
  ]);
  if (!consumptionFile || !exportFile) return null;
  const [consumptionText, exportText] = await Promise.all([consumptionFile.text(), exportFile.text()]);
  const consumption = parseMeter(consumptionText, quote.starts_on, quote.ends_on);
  const exports = parseMeter(exportText, quote.starts_on, quote.ends_on);
  if (!consumption || !exports) return null;
  let matched = 0;
  let remaining = 0;
  let complete = 0;
  const exceptions: string[] = [];
  const expected = ((Date.parse(quote.ends_on) - Date.parse(quote.starts_on)) / 86_400_000 + 1) * 48;
  const start = Date.parse(quote.starts_on);
  for (let i = 0; i < expected; i++) {
    const interval = new Date(start + i * 1_800_000).toISOString().replace(".000Z", "Z");
    const used = consumption.get(interval);
    const exported = exports.get(interval);
    if (used == null || exported == null) {
      if (exceptions.length < 3) exceptions.push(interval);
      continue;
    }
    const volume = Math.min(used, exported, quote.volume_kwh * 1000 - matched);
    matched += volume;
    remaining += used - volume;
    complete++;
  }
  return { matched, remaining, complete, expected, exceptions };
}

type Comparison = NonNullable<Awaited<ReturnType<typeof compareMeters>>>;

function MeterPanel({ deal, role, files, comparison }: {
  deal: Deal; role: Party; files: MeterFile[]; comparison: Comparison | null;
}) {
  const base = urlFor(deal.id);
  const canCompare = files.length === 2;
  const reviewed = deal.status === "reviewed";
  return <section className="panel trade-meter">
    <header className="trade-heading"><div><h2>Meter comparison</h2>
      <p>Compare the supplier-authorized buyer consumption and producer export records.</p></div></header>
    {files.length > 0 && <ul className="trade-meter-list">{files.map((file) => <li key={file.id}>
      <a href={base + "/meters/" + file.id}>{file.role === "buyer" ? "Consumption CSV" : "Export CSV"}</a>
      <span>{file.intervals} intervals</span>
    </li>)}</ul>}
    {reviewed && role !== "supplier" && <form className="trade-upload" action={base + "/meters"} method="post" encType="multipart/form-data">
      <label>{role === "buyer" ? "Upload consumption CSV" : "Upload export CSV"}
        <input type="file" name="meter" accept=".csv,text/csv" required />
      </label>
      <p className="trade-small">Columns <code>timestamp_utc,kwh</code>. Use half-hour UTC timestamps, such as <code>2026-12-01T12:30:00Z</code>. Upload only records you have permission to share.</p>
      <button className="button secondary">Upload private CSV</button>
    </form>}
    {!reviewed && <p className="trade-empty">Meter uploads open after the invited supplier reviewer records their approval.</p>}
    {reviewed && !canCompare && <p className="trade-empty">A half-hour comparison needs both meter files.</p>}
    {canCompare && !comparison && <p className="trade-notice" role="status">A source file could not be read. Upload it again to continue.</p>}
    {comparison && <>
      <dl className="trade-meter-metrics">
        <div><dt>Matched supply</dt><dd>{kwh(comparison.matched)} kWh</dd></div>
        <div><dt>Remaining demand</dt><dd>{kwh(comparison.remaining)} kWh</dd></div>
        <div><dt>Intervals compared</dt><dd>{comparison.complete} / {comparison.expected}</dd></div>
      </dl>
      {comparison.exceptions.length > 0 && <p className="trade-notice">Missing readings start at {comparison.exceptions.join(", ")}. These intervals are excluded from the totals.</p>}
      <p className="trade-small">Draft comparison for the complete intervals uploaded. The supplier confirms actual allocations and invoices.</p>
    </>}
  </section>;
}

function QuoteHistory({ history }: { history: Terms[] }) {
  return <section className="panel trade-history">
    <h2>Quote versions</h2>
    <ol className="trade-versions">{history.map((item, index) => <li key={item.version}>
      <span className="trade-version">V{item.version}</span>
      <div><strong>{item.author}{index === 0 ? " · Current quote" : ""}</strong>
        <p>{mwh(item.volume_kwh)} MWh · {pounds(item.price_pence)}/MWh · {item.starts_on} to {item.ends_on}</p>
        {item.note && <p className="trade-note">{item.note}</p>}</div>
    </li>)}</ol>
  </section>;
}

function DealActions({ deal, quote, user }: { deal: Deal; quote: Terms; user: User }) {
  const role = roleOf(deal, user);
  const base = urlFor(deal.id);
  const isOtherQuote = quote.author_id !== user.id;
  const canCounter = (deal.status === "negotiating" && isOtherQuote) || deal.status === "changes_requested";
  if (deal.status === "supplier_review" && role === "supplier") return <section className="panel">
    <h2>Supplier review</h2>
    <form action={base + "/review"} method="post" className="trade-form">
      <input type="hidden" name="version" value={quote.version} />
      <div className="trade-fields">
        <label>Supplier organization<input name="supplier_name" maxLength={100} /></label>
        <label>Review reference<input name="reference" maxLength={100} /></label>
        <label>Supplier fee · £/MWh<input name="fee" type="number" step=".01" min="0" max="100000" /></label>
        <label>Remaining supply · £/MWh<input name="residual" type="number" step=".01" min="0" max="100000" /></label>
      </div>
      <label>Review note<textarea name="note" maxLength={400} rows={3} /></label>
      <p className="trade-small">Record the outcome of the commercial review. Official supply agreements and billing stay with the supplier.</p>
      <div className="trade-cta">
        <button name="decision" value="approve" className="button">Record review approval</button>
        <button name="decision" value="request" className="button secondary">Request changes</button>
      </div>
    </form>
  </section>;
  if (deal.status === "supplier_review" && !deal.supplier_id && role === "buyer") return <section className="panel">
    <h2>Invite a supplier reviewer</h2>
    <form className="trade-form" action={base + "/supplier"} method="post">
      <p>Share this deal with your supplier’s approved reviewer using their Index Globe username.</p>
      <label>Reviewer username<input name="username" required maxLength={32} autoCapitalize="none" autoComplete="off" /></label>
      <button className="button">Grant deal access</button>
    </form>
  </section>;
  if (canCounter && role !== "supplier") return <section className="panel">
    <h2>{deal.status === "changes_requested" ? "Revise the terms" : "Respond to the quote"}</h2>
    {deal.status === "negotiating" && <form method="post" action={base + "/accept"} className="trade-form trade-accept">
      <input type="hidden" name="version" value={quote.version} />
      <p>Send this exact quote to supplier review. The supply agreement takes effect through the supplier.</p>
      <button className="button">Agree to these terms</button>
    </form>}
    <details open={deal.status === "changes_requested"}>
      <summary>Propose different terms</summary>
      <form className="trade-form trade-counter" method="post" action={base + "/counter"}>
        <input type="hidden" name="version" value={quote.version} />
        <TermsFields start={quote.starts_on} end={quote.ends_on} volume={quote.volume_kwh / 1000} price={quote.price_pence / 100} />
        <label>Message <small>Optional</small><textarea name="note" maxLength={400} rows={3} /></label>
        <button className="button secondary">Send revised quote</button>
      </form>
    </details>
  </section>;
  return <section className="panel">
    <h2>{deal.status === "reviewed" ? "Supplier terms" : "Next step"}</h2>
    {deal.status === "reviewed" ? <dl className="trade-lines">
      <div><dt>Supplier</dt><dd>{deal.supplier_name}</dd></div>
      <div><dt>Review reference</dt><dd>{deal.supplier_reference}</dd></div>
      <div><dt>Energy + supplier fee</dt><dd>{pounds(quote.price_pence + (deal.sleeve_price_pence ?? 0))}/MWh</dd></div>
      <div><dt>Remaining supply</dt><dd>{pounds(deal.remaining_price_pence ?? 0)}/MWh</dd></div>
    </dl> : <p>{deal.status === "supplier_review"
      ? deal.reviewer ? "Waiting for " + deal.reviewer + " to review the agreed terms." : "The buyer can invite a supplier reviewer."
      : deal.status === "changes_requested" ? "Waiting for a revised quote."
      : "Waiting for the counterparty to accept or send a revised quote."}</p>}
  </section>;
}

function DealPage({ deal, user, history, files, comparison, request }: {
  deal: Deal; user: User; history: Terms[]; files: MeterFile[]; comparison: Comparison | null; request: Request;
}) {
  const current = history[0];
  const role = roleOf(deal, user);
  return <Shell user={user} active="workspace">
    <div className="trade-wrap">
      <a className="trade-back" href="/workspace">← Trading desk</a>
      <header className="trade-heading">
        <div><p className="eyebrow">{powerSources[deal.source].label} · {role}</p><h1>{deal.producer_site}</h1><p>Supply to {deal.buyer_site}</p></div>
        <span className="trade-status">{states[deal.status]}</span>
      </header>
      <Notice request={request} />
      <div className="trade-parties">
        <div><span>Producer</span><strong>{deal.seller}</strong></div>
        <div><span>Buyer</span><strong>{deal.buyer}</strong></div>
        <div><span>Supplier reviewer</span><strong>{deal.reviewer ?? "Not assigned"}</strong></div>
      </div>
      <div className="trade-split">
        <section className="panel trade-summary">
          <h2>Quote {current.version}</h2>
          <dl><div><dt>Contract volume</dt><dd>{mwh(current.volume_kwh)} MWh</dd></div>
            <div><dt>Energy price</dt><dd>{pounds(current.price_pence)} / MWh</dd></div>
            <div><dt>Delivery dates</dt><dd>{current.starts_on} to {current.ends_on}</dd></div>
          </dl>
          <a href={urlFor(deal.id) + "/export"} className="button secondary">Download deal record</a>
        </section>
        <DealActions deal={deal} quote={current} user={user} />
      </div>
      {deal.supplier_note && <aside className="trade-notice"><strong>Supplier review note</strong><p className="trade-note">{deal.supplier_note}</p></aside>}
      {(deal.status === "supplier_review" || deal.status === "reviewed") && <MeterPanel deal={deal} role={role} files={files} comparison={comparison} />}
      <QuoteHistory history={history} />
    </div>
  </Shell>;
}

async function createOffer(form: FormData, user: User) {
  const terms = readTerms(form);
  const site = text(form, "site", 100);
  const region = text(form, "region", 60);
  const source = text(form, "source", 30);
  if (!isPowerSource(source) || !terms || !site || !region || text(form, "permission", 3) !== "yes") {
    return redirect("/workspace/offer", "site");
  }
  const id = crypto.randomUUID();
  await DB.prepare(`
    INSERT INTO power_offers (id,seller_id,site,region,starts_on,ends_on,volume_kwh,price_pence,source)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(id, user.id, site, region, terms.start, terms.end, terms.volume, terms.price, source).run();
  return redirect(offerUrl(id), "saved");
}

async function withdrawOffer(id: string, user: User) {
  const result = await DB.prepare(`
    UPDATE power_offers SET status = 'withdrawn' WHERE id = ? AND seller_id = ?
  `).bind(id, user.id).run();
  return result.meta.changes ? redirect(offerUrl(id), "saved") : missing();
}

async function requestOffer(id: string, form: FormData, user: User) {
  const offer = await lookupOffer(id);
  if (!offer || offer.seller_id === user.id) return missing();
  const terms = readTerms(form);
  const site = text(form, "site", 100);
  if (offer.status !== "open") return redirect(offerUrl(id), "closed");
  if (!terms || !site || !inOffer(terms, offer.starts_on, offer.ends_on, offer.volume_kwh)) {
    return redirect(offerUrl(id), "bad");
  }
  const dealId = crypto.randomUUID();
  const [created] = await DB.batch([
    DB.prepare(`
      INSERT OR IGNORE INTO deals (id,offer_id,buyer_id,seller_id,buyer_site)
      SELECT ?,id,?,seller_id,? FROM power_offers WHERE id = ? AND status = 'open'
    `).bind(dealId, user.id, site, id),
    DB.prepare(`
      INSERT INTO deal_quotes (deal_id,version,author_id,starts_on,ends_on,volume_kwh,price_pence,note)
      SELECT id,1,?,?,?,?,?,? FROM deals WHERE id = ?
    `).bind(user.id, terms.start, terms.end, terms.volume, terms.price, text(form, "note", 400), dealId),
  ]);
  if (created.meta.changes) return redirect(urlFor(dealId));
  const existing = await DB.prepare("SELECT id FROM deals WHERE offer_id = ? AND buyer_id = ?")
    .bind(id, user.id).first<{ id: string }>();
  return existing ? redirect(urlFor(existing.id)) : redirect(offerUrl(id), "closed");
}

async function counter(deal: Deal, current: Terms, form: FormData, user: User) {
  const path = urlFor(deal.id);
  const terms = readTerms(form);
  const readyForResponse = deal.status === "negotiating" && current.author_id !== user.id;
  if (!readyForResponse && deal.status !== "changes_requested") return redirect(path, "stale");
  if (!terms || !inOffer(terms, deal.available_from, deal.available_to, deal.available_kwh)) {
    return redirect(path, "bad");
  }
  const version = current.version + 1;
  const [update] = await DB.batch([
    DB.prepare(`
      UPDATE deals SET quote_version = ?, status = 'negotiating', agreed_by = NULL, agreed_at = NULL, updated_at = unixepoch()
      WHERE id = ? AND quote_version = ? AND status = ?
    `).bind(version, deal.id, current.version, deal.status),
    DB.prepare(`
      INSERT OR IGNORE INTO deal_quotes (deal_id,version,author_id,starts_on,ends_on,volume_kwh,price_pence,note)
      SELECT id,?,?,?,?,?,?,? FROM deals WHERE id = ? AND quote_version = ? AND status = 'negotiating'
    `).bind(version, user.id, terms.start, terms.end, terms.volume, terms.price, text(form, "note", 400), deal.id, version),
  ]);
  return redirect(path, update.meta.changes ? "saved" : "stale");
}

async function accept(deal: Deal, current: Terms, user: User) {
  const path = urlFor(deal.id);
  if (deal.status !== "negotiating" || user.id === current.author_id) return redirect(path, "stale");
  const result = await DB.prepare(`
    UPDATE deals SET status = 'supplier_review', agreed_by = ?, agreed_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ? AND quote_version = ? AND status = 'negotiating'
      AND ? + COALESCE((
        SELECT SUM(q.volume_kwh)
        FROM deals d JOIN deal_quotes q ON q.deal_id = d.id AND q.version = d.quote_version
        WHERE d.offer_id = ? AND d.status IN ('supplier_review','reviewed')
      ),0) <= ?
  `).bind(user.id, deal.id, current.version, current.volume_kwh, deal.offer_id, deal.available_kwh).run();
  return redirect(path, result.meta.changes ? "saved" : "capacity");
}

async function invite(deal: Deal, form: FormData, user: User) {
  const path = urlFor(deal.id);
  if (deal.buyer_id !== user.id || deal.status !== "supplier_review" || deal.supplier_id) return redirect(path, "stale");
  const username = text(form, "username", 32).toLowerCase();
  const reviewer = await DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: string }>();
  if (!reviewer || reviewer.id === deal.seller_id || reviewer.id === user.id) return redirect(path, "supplier");
  const update = await DB.prepare(`
    UPDATE deals SET supplier_id = ?, updated_at = unixepoch()
    WHERE id = ? AND quote_version = ? AND status = 'supplier_review' AND supplier_id IS NULL
  `).bind(reviewer.id, deal.id, deal.quote_version).run();
  return redirect(path, update.meta.changes ? "saved" : "stale");
}

async function supplierReview(deal: Deal, form: FormData, user: User) {
  const path = urlFor(deal.id);
  if (deal.supplier_id !== user.id || deal.status !== "supplier_review") return redirect(path, "stale");
  const decision = text(form, "decision", 8);
  const note = text(form, "note", 400);
  const name = text(form, "supplier_name", 100);
  const reference = text(form, "reference", 100);
  const fee = decimal(text(form, "fee", 14), 2, 10_000_000);
  const remaining = decimal(text(form, "residual", 14), 2, 10_000_000);
  if (decision !== "request" && (decision !== "approve" || !name || !reference || fee == null || remaining == null)) {
    return redirect(path, "review");
  }
  const review = decision === "approve";
  const update = await DB.prepare(`
    UPDATE deals SET status = ?, supplier_name = ?, supplier_reference = ?, supplier_note = ?,
      sleeve_price_pence = ?, remaining_price_pence = ?, reviewed_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ? AND quote_version = ? AND status = 'supplier_review' AND supplier_id = ?
  `).bind(review ? "reviewed" : "changes_requested", review ? name : null, review ? reference : null,
    note, review ? fee : null, review ? remaining : null, deal.id, deal.quote_version, user.id).run();
  return redirect(path, update.meta.changes ? "saved" : "stale");
}

async function uploadMeter(deal: Deal, quote: Terms, form: FormData, user: User, role: MeterParty) {
  const path = urlFor(deal.id);
  if (deal.status !== "reviewed") return redirect(path, "stale");
  const file = form.get("meter");
  if (!(file instanceof File) || file.size === 0 || file.size > 512 * 1024) return redirect(path, "attachment");
  const raw = await file.text();
  const readings = parseMeter(raw, quote.starts_on, quote.ends_on);
  if (!readings) return redirect(path, "attachment");
  const id = crypto.randomUUID();
  const key = deal.id + "/" + role + "/" + id + ".csv";
  await DOCUMENTS.put(key, raw, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
  try {
    const uploaded = await DB.prepare(`
      INSERT INTO deal_meter_files (id,deal_id,user_id,role,object_key,intervals,sequence)
      SELECT ?,?,?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM deal_meter_files WHERE deal_id = ? AND role = ?
      HAVING COALESCE(MAX(sequence),0) < 20
    `).bind(id, deal.id, user.id, role, key, readings.size, deal.id, role).run();
    if (!uploaded.meta.changes) {
      await DOCUMENTS.delete(key);
      return redirect(path, "file_limit");
    }
  } catch (error) {
    await DOCUMENTS.delete(key);
    throw error;
  }
  return redirect(path, "uploaded");
}

function attachment(body: BodyInit, filename: string, type = "text/plain; charset=utf-8") {
  return new Response(body, { headers: {
    "Content-Type": type,
    "Content-Disposition": 'attachment; filename="' + filename + '"',
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

function dealSheet(deal: Deal, quote: Terms) {
  const output = [
    "Index Globe | Trade review record",
    "Electricity source: " + powerSources[deal.source].label,
    "Producer site: " + deal.producer_site, "Buyer site: " + deal.buyer_site,
    "Quote: " + quote.version, "Status: " + states[deal.status],
    "Delivery dates (UTC): " + quote.starts_on + " to " + quote.ends_on,
    "Volume: " + mwh(quote.volume_kwh) + " MWh", "Energy rate: " + pounds(quote.price_pence) + "/MWh",
    "Supplier: " + (deal.supplier_name ?? "Awaiting review"),
    "Supplier reference: " + (deal.supplier_reference ?? "Awaiting review"),
  ];
  if (deal.status === "reviewed" && deal.sleeve_price_pence !== null && deal.remaining_price_pence !== null) {
    output.push("Supplier fee: " + pounds(deal.sleeve_price_pence) + "/MWh",
      "Remaining supply: " + pounds(deal.remaining_price_pence) + "/MWh");
  }
  output.push("For review. The supplier confirms official delivery and billing.");
  return attachment(output.join("\n") + "\n", "index-globe-deal.txt");
}

async function tradeForm(request: Request, upload = false) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return null;
  const media = upload ? "multipart/form-data;" : "application/x-www-form-urlencoded";
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith(media)) return null;
  const max = upload ? 530_000 : 8192;
  const length = Number(request.headers.get("Content-Length"));
  if (length > max || (upload && length <= 0)) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function invalidForm() {
  return new Response("Invalid form submission.", { status: 400 });
}

async function dealAction(request: Request, id: string, action: string) {
  const user = await currentUser(request);
  if (!user) return redirect("/login");
  const deal = await lookupDeal(id, user);
  if (!deal) return missing();
  const role = roleOf(deal, user);
  if (role === "supplier" && action !== "review") return missing();
  const form = await tradeForm(request, action === "meters");
  if (!form) return invalidForm();
  const history = await quotes(id);
  const current = history[0];
  if (!current || current.version !== deal.quote_version) return redirect(urlFor(id), "stale");
  if (action === "supplier") return invite(deal, form, user);
  if (action === "meters" && role !== "supplier") return uploadMeter(deal, current, form, user, role);
  if (current.version !== readVersion(form)) return redirect(urlFor(id), "stale");
  if (action === "accept") return accept(deal, current, user);
  if (action === "counter") return counter(deal, current, form, user);
  if (action === "review") return supplierReview(deal, form, user);
  return missing();
}

export const tradeRoutes = [
  route("/workspace", { get: async ({ request }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const source = new URL(request.url).searchParams.get("source") ?? "";
    const [offers, deals] = await Promise.all([
      DB.prepare(offerQuery + " WHERE status = 'open' AND (? IS NULL OR source = ?) ORDER BY created_at DESC, power_offers.id LIMIT 60").bind(isPowerSource(source) ? source : null, isPowerSource(source) ? source : null).all<Offer>(),
      DB.prepare(dealQuery + " WHERE " + dealScope + " ORDER BY updated_at DESC, deals.id LIMIT 60")
        .bind(user.id, user.id, user.id).all<Deal>(),
    ]);
    return <Workspace user={user} offers={offers.results} deals={deals.results} request={request} />;
  } }),
  route("/workspace/offer", {
    get: async ({ request }) => {
      const user = await currentUser(request);
      return user ? <NewOffer user={user} request={request} /> : redirect("/login");
    },
    post: async ({ request }) => {
      const user = await currentUser(request);
      if (!user) return redirect("/login");
      const form = await tradeForm(request);
      return form ? createOffer(form, user) : invalidForm();
    },
  }),
  route("/offers/:id", { get: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const [offer, existing] = await Promise.all([
      lookupOffer(params.id),
      DB.prepare("SELECT id FROM deals WHERE offer_id = ? AND buyer_id = ?")
        .bind(params.id, user.id).first<{ id: string }>(),
    ]);
    return offer ? <OfferPage user={user} offer={offer} existing={existing} request={request} /> : missing();
  } }),
  route("/offers/:id/request", { post: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const form = await tradeForm(request);
    return form ? requestOffer(params.id, form, user) : invalidForm();
  } }),
  route("/offers/:id/withdraw", { post: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    return request.headers.get("Origin") === new URL(request.url).origin ? withdrawOffer(params.id, user) : invalidForm();
  } }),
  route("/deals/:id", { get: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const deal = await lookupDeal(params.id, user);
    if (!deal) return missing();
    const history = await quotes(deal.id);
    if (!history[0]) return missing();
    const files = deal.status === "reviewed" ? await meterFiles(deal.id) : [];
    const comparison = await compareMeters(files, history[0]);
    return <DealPage deal={deal} user={user} history={history} files={files} comparison={comparison} request={request} />;
  } }),
  route("/deals/:id/export", { get: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const deal = await lookupDeal(params.id, user);
    if (!deal) return missing();
    const quote = (await quotes(deal.id)).find((item) => item.version === deal.quote_version);
    return quote ? dealSheet(deal, quote) : missing();
  } }),
  route("/deals/:id/meters/:file", { get: async ({ request, params }) => {
    const user = await currentUser(request);
    if (!user) return redirect("/login");
    const deal = await lookupDeal(params.id, user);
    if (!deal) return missing();
    const file = await DB.prepare("SELECT id,object_key,role,intervals FROM deal_meter_files WHERE id = ? AND deal_id = ?")
      .bind(params.file, deal.id).first<MeterFile>();
    if (!file) return missing();
    const object = await DOCUMENTS.get(file.object_key);
    return object ? attachment(object.body, "meter-" + file.role + ".csv", "text/csv; charset=utf-8") : missing();
  } }),
  route("/deals/:id/:action", { post: ({ request, params }) => dealAction(request, params.id, params.action) }),
];
