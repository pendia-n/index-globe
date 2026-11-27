export const energyProducts = {
 gas: 'Natural gas / LNG', oil: 'Crude oil / refined products / bunker fuel', coal: 'Physical coal',
 power: 'Electricity · solar, hydro, nuclear, wind, gas or coal generation', flexibility: 'Storage / flexibility',
} as const
export const specificationHints: Record<string,string> = {
 gas:'Pipeline gas or LNG; gas quality, daily profile, hub/terminal, transport or regas rights and responsible shipper.',
 oil:'Crude assay or fuel grade, sulphur, delivery basis, tank/port, transport, inspection and title transfer.',
 coal:'Calorific value, moisture, ash, sulphur, origin, transport, terminal and inspection terms.',
 power:'Generation source, consumption/generation shape, meter or bidding zone, supplier sleeve, balancing and energy attributes.',
 flexibility:'MW and MWh, asset/site, availability windows, dispatch rights, telemetry, qualified aggregator and performance terms.',
}
export type EnergyCase = {
 sourcing_revision:number;workflow_version:number;blind_brief:string|null;route_checks:string|null;fee_revision:number;fee_payer:string;fee_basis:string;fee_currency:string;buyer_fee_revision:number|null;commission_bps:number;operating_cost_minor:number;operating_minutes:number;resume_state:string|null;cancellation_proposed_by:string|null;cancellation_note:string|null;
 id:string; company_id:string; company_name?:string; side:'buy'|'sell'; product:string; country:string; delivery_point:string;
 title:string; details:string; state:string; revision:number; operator_id:string|null; next_action:string; next_at:number|null;
 route_note:string|null; fee_terms:string|null; selected_offer:string|null; contract_ref:string|null; security_ref:string|null;
 buyer_signed:number; seller_signed:number; delivery_ref:string|null; delivery_accepted:number; invoice_ref:string|null;
 payment_ref:string|null; payment_received:number; fee_ref:string|null; fee_payment_ref:string|null; fee_received:number; updated_at:number;
}
