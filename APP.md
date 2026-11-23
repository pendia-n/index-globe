# Teder
Teder helps approved companies negotiate physical power supply for a delivery window and keep a shared record after they agree. The Singapore pilot covers a private request between one buyer and one supplier, versioned quotes and counteroffers, agreement acknowledgement, partner schedule and delivery references, reconciliation, and an external settlement reference.

Company owners register independently. A reviewer checks their company identity, representative and trading eligibility outside Teder before enabling requests and offers. The owner can invite traders, delivery operators and viewers. Review authority is granted to a trusted account through an authenticated D1 administrative operation after identity verification. There is no public reviewer registration.

The browser signs in using an HttpOnly signed session cookie. Save the generated recovery code during registration. A password reset requires the username and current recovery code, replaces it with a newly saved code and revokes existing sessions. There is no email reset. The JWT signing secret is stored only in the ignored local environment file and a Worker secret. Keep a protected backup of the signing secret. Rotation requires a deliberate migration because it also protects password and recovery verifiers.

The buyer and seller sign and settle outside Teder. A delivery record identifies its source and reference and can be accepted or disputed by the buyer. The app does not move funds, schedule a grid transaction, or independently confirm a meter reading. A live deal requires eligible participants, an appropriate route and review of the pilot's legal and market role.

## Operator setup

From `chamin/`, run `node scripts/grant-reviewer.mjs <registered-username>` using an authenticated Wrangler account after confirming the identity of the intended reviewer. That grants review access to an existing company owner. The reviewer can then approve other companies from Company Reviews. Registration does not grant reviewer access or activate a company for trading.

Use `pnpm build` and the global `wrangler deploy --config dist/server/wrangler.json` to release. Apply D1 migrations separately with `wrangler d1 migrations apply DB --remote`. The production Worker needs only the named JWT secret. Keep the ignored .env private and upload only that key as a Worker secret.
