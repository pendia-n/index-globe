"use client";

import { useState } from "react";

const offerOptions = [
  { name: "Westfield Solar", price: 76, fee: 9, profile: [10, 31, 55, 64, 72, 73, 51, 30] },
  { name: "Meadowbank Solar", price: 83, fee: 10, profile: [5, 15, 34, 59, 66, 64, 61, 54] },
];
const demand = [42, 44, 48, 50, 57, 58, 59, 52];
const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export function Example() {
  const [selection, setSelection] = useState(0);
  const [price, setPrice] = useState(String(offerOptions[0].price));
  const [step, setStep] = useState<"quote" | "review" | "statement">("quote");
  const offer = offerOptions[selection];
  const matched = demand.reduce((total, value, index) => total + Math.min(value, offer.profile[index]), 0);
  const residual = demand.reduce((a,b) => a + b, 0) - matched;
  const quote = Number(price);
  const valid = price.trim() !== "" && Number.isFinite(quote) && quote >= 0 && quote <= 10000;
  const cost = (matched * (quote + offer.fee) + residual * 110) / 1000;
  return <section id="compare" className="example">
    <div className="section-title"><div><p className="eyebrow">Fictional training workspace</p><h2>Compare an offer to your demand</h2></div><p>Great Britain · Half-hour intervals</p></div>
    <div className="example-grid">
      <div className="profile-chart panel">
        <div className="chart-head"><div><h3>Match by delivery interval</h3><p>Business demand and solar export, in kWh</p></div>
          <div className="chart-key"><span><i />Demand</span><span><i />Solar</span></div></div>
        <div className="bars" aria-hidden="true">{times.map((time, index) => <div className="chart-column" key={time}>
          <div className="bar-pair"><span style={{height: demand[index] + "%"}} /><span style={{height: offer.profile[index] + "%"}} /></div><small>{time}</small>
        </div>)}</div>
        <details className="chart-data"><summary>View interval data</summary><div className="table-scroll"><table><thead><tr><th>Time</th><th>Demand (kWh)</th><th>Solar (kWh)</th><th>Matched (kWh)</th></tr></thead>
          <tbody>{times.map((time, i) => <tr key={time}><td>{time}</td><td>{demand[i]}</td><td>{offer.profile[i]}</td><td>{Math.min(demand[i], offer.profile[i])}</td></tr>)}</tbody></table></div></details>
      </div>
      <div className="panel quote-card">
        <h3>Review the quote</h3>
        <label>Generator<select value={selection} onChange={(event) => {
          const next = Number(event.target.value);
          setSelection(next); setPrice(String(offerOptions[next].price)); setStep("quote");
        }}>{offerOptions.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
        <label>Proposed energy price (£/MWh)<input type="number" min="0" max="10000" step="0.01" value={price} onChange={(event) => {setPrice(event.target.value); setStep("quote");}} /></label>
        <dl className="quote-totals"><div><dt>Matched solar</dt><dd>{matched} kWh</dd></div><div><dt>Remaining supply</dt><dd>{residual} kWh</dd></div><div><dt>Illustrative subtotal</dt><dd>{valid ? gbp.format(cost) : "—"}</dd></div></dl>
        <p>Includes a hypothetical supplier fee of £{offer.fee}/MWh and remaining supply at £110/MWh. Excludes tax and network charges.</p>
        {step === "quote" && <button className="button" type="button" disabled={!valid} onClick={() => setStep("review")}>Preview supplier review <span aria-hidden="true">↗</span></button>}
        {step === "review" && <div className="example-step" aria-live="polite">
          <p className="inline-result">Sample quote sent for review at {gbp.format(quote)}/MWh. A live supplier would check the meters, charges and remaining supply terms.</p>
          <button className="button" type="button" onClick={() => setStep("statement")}>Simulate approval and settlement</button>
        </div>}
        {step === "statement" && <div className="example-step" aria-live="polite">
          <p className="inline-result"><strong>Fictional statement</strong><br />{matched} kWh matched with {offer.name}. {residual} kWh supplied at the remaining supply rate. Sample subtotal {gbp.format(cost)}.</p>
          <button className="button secondary" type="button" onClick={() => setStep("quote")}>Return to quote</button>
        </div>}
      </div>
    </div>
  </section>;
}
