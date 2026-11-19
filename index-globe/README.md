# Index Globe

RedwoodSDK on Cloudflare Workers. D1 stores account, trade and pilot state. The private R2 binding `DOCUMENTS` is for pilot evidence. See the parent `APP.md` for the product and settlement model.

## Local development

Run `pnpm install`, `wrangler d1 migrations apply index-globe-db --local` and `pnpm dev`. Use an HTTPS origin for secure cookies or an HTTP loopback origin supported by your browser. The root `.env` supplies `INDEX_GLOBE_JWT_SECRET`. Never commit it.

## Stripe sandbox

Create an event destination in the dedicated Index Globe Stripe sandbox. Subscribe to the snapshot `invoice.paid` event and point it to `/api/stripe/webhook` on an accessible sandbox Worker. Set `INDEX_GLOBE_STRIPE_WEBHOOK_SECRET` using a Worker secret. Leave `INDEX_GLOBE_STRIPE_LIVE` unset for the sandbox.

The initial offer is a manually agreed fixed pilot fee. Issue the Stripe invoice from Index Globe’s own account. Before collecting payment, an operator records that invoice ID, its agreed amount in minor units and lowercase currency against the matching pilot request. The signed event must match all three fields before the workspace records payment. Stripe events do not activate an electricity contract. Separate live webhook configuration is required before accepting live pilot payments.
