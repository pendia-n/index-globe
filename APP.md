# Teder
Teder helps approved companies negotiate physical power supply for a delivery window and keep a shared record after they agree. The Singapore power pilot lets a buyer invite up to ten approved suppliers to one private tender. Each supplier sees its own negotiation. The buyer compares replies and can select one firm offer. The selected counterparties then record the agreement, schedule, delivery review and external settlement.

Company owners register one workspace per legal entity using its registration jurisdiction and registry identifier. A reviewer checks the registry record, representative and pilot eligibility before enabling requests and offers. Each company has five named seats, including the owner. An unused invitation reserves a seat for 24 hours or until the owner revokes it. Review authority is granted to a trusted account through an authenticated D1 administrative operation after identity verification. There is no public reviewer registration.

The browser signs in using an HttpOnly signed session cookie. Save the generated recovery code during registration. A password reset requires the username and current recovery code, replaces it with a newly saved code and revokes existing sessions. There is no email reset. The JWT signing secret is stored only in the ignored local environment file and a Worker secret. Keep a protected backup of the signing secret. Rotation requires a deliberate migration because it also protects password and recovery verifiers.

The buyer and seller sign and settle outside Teder. A delivery report identifies its source and evidence reference. Suppliers can include half-hour readings for the buyer to compare against the scheduled amount. The buyer can reconcile delivery or open a dispute and review a corrected report. The app does not move funds, schedule a grid transaction, or independently confirm a meter reading. A live deal requires eligible participants, an appropriate route and review of the pilot's legal and market role.

## Operator setup

From `chamin/`, run `node scripts/grant-reviewer.mjs <registered-username>` using an authenticated Wrangler account after confirming the identity of the intended reviewer. That grants review access to an existing company owner. The reviewer can then approve other companies from Company Reviews. Registration does not grant reviewer access or activate a company for trading.

Use `pnpm build` and the global `wrangler deploy --config dist/server/wrangler.json` to release. Apply D1 migrations separately with `wrangler d1 migrations apply DB --remote`. The production Worker needs only the named JWT secret. Keep the ignored .env private and upload only that key as a Worker secret.
