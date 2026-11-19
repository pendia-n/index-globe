import { env } from "cloudflare:workers";

const encoder = new TextEncoder();
const { DB } = env as unknown as { DB: D1Database };

export async function pilotStatus(user: string) {
  const row = await DB.prepare("SELECT stripe_invoice_id, paid_at FROM pilot_requests WHERE user_id = ?")
    .bind(user).first<{ stripe_invoice_id: string | null; paid_at: string | null }>();
  if (row?.paid_at) return "Pilot invoice paid. Activation follows your supplier agreement.";
  if (row?.stripe_invoice_id) return "A Stripe invoice has been issued for your agreed pilot.";
  if (row) return "Pilot review requested.";
  return undefined;
}

export async function requestPilot(user: string) {
  await DB.prepare("INSERT INTO pilot_requests (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").bind(user).run();
}

export async function stripeWebhook(request: Request) {
  const { INDEX_GLOBE_STRIPE_WEBHOOK_SECRET: secret, INDEX_GLOBE_STRIPE_LIVE: mode } = env as unknown as {
    INDEX_GLOBE_STRIPE_WEBHOOK_SECRET?: string;
    INDEX_GLOBE_STRIPE_LIVE?: string;
  };
  if (!secret) return new Response("Stripe billing is not configured.", { status: 503 });
  const signature = request.headers.get("Stripe-Signature") ?? "";
  const entries = signature.split(",").map((part) => part.trim().split("="));
  const timestamp = entries.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = entries.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/i.test(value)).map(([, value]) => value);
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures.length) {
    return new Response("Invalid signature.", { status: 400 });
  }

  const raw = await request.text();
  if (raw.length > 262_144) return new Response("Event too large.", { status: 413 });
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = encoder.encode(timestamp + "." + raw);
  const valid = await Promise.all(signatures.map((hex) =>
    crypto.subtle.verify("HMAC", key, Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)), signed)));
  if (!valid.includes(true)) return new Response("Invalid signature.", { status: 400 });

  let event: { id?: string; livemode?: boolean; type?: string; data?: { object?: {
    id?: string; status?: string; paid_out_of_band?: boolean; amount_paid?: number; currency?: string;
  } } };
  try {
    event = JSON.parse(raw);
    if (!event || typeof event !== "object") throw new Error();
  } catch {
    return new Response("Invalid event.", { status: 400 });
  }
  if (typeof event.livemode !== "boolean" || event.livemode !== (mode === "true")) {
    return new Response("Wrong Stripe mode.", { status: 400 });
  }
  const invoice = event.data?.object;
  if (event.type === "invoice.paid" && typeof event.id === "string" && invoice?.status === "paid" &&
      typeof invoice.id === "string" && Number.isSafeInteger(invoice.amount_paid) &&
      typeof invoice.currency === "string") {
    await DB.prepare(`UPDATE pilot_requests SET paid_at = CURRENT_TIMESTAMP, stripe_paid_event_id = ?
      WHERE stripe_invoice_id = ? AND paid_at IS NULL AND agreed_minor_units = ? AND agreed_currency = ?`)
      .bind(event.id, invoice.id, invoice.amount_paid, invoice.currency).run();
  }
  return Response.json({ received: true });
}
