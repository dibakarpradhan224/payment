# Cafin Pay: wallet & payment gateway

One backend, one database and one wallet shared by the **website**, **Telegram bot**, **Telegram Mini App**, **REST/Merchant API** and **admin panel**.
Stack: Node 22 + TypeScript + Fastify + Prisma on **Supabase (PostgreSQL)**; Next.js + Tailwind frontend; Caddy for HTTPS.

```
payment-gateway/
├── backend/            Fastify API, services, jobs, Telegram bot, Prisma schema, tests
│   ├── prisma/         schema.prisma + sql/constraints.sql (DB-level safety rules)
│   └── src/            routes/ services/ providers/ middleware/ validators/ jobs/ telegram/ lib/
├── frontend/           Next.js app: user app, /miniapp (Telegram), /admin console
├── docs/               API.md, WEBHOOKS.md
├── Caddyfile  docker-compose.yml  .env.example
```
(Adapted from the suggested layout: the bot lives in `backend/src/telegram` because it shares the services directly; the Mini App and admin UI are routes of the one Next.js app, so they share auth, UI kit and session.)

## 0. Updating an existing install
**Fastest and most reliable (works even if Prisma cannot reach your database from your PC):** open Supabase > SQL Editor > New query, paste this, click Run:
```sql
ALTER TABLE "ApiToken" ADD COLUMN IF NOT EXISTS "tokenEnc" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'ALL';
DROP INDEX IF EXISTS apitoken_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS apitoken_one_active_per_kind ON "ApiToken" ("userId", "kind") WHERE "status" = 'ACTIVE';
```
(`kind` splits API tokens into a Payout token and a Merchant token. An older all-in-one token keeps working until you remove it on the API page.)
Then in `backend/` run `npm run prisma:generate` and restart `npm run dev`. If the API page says "No token yet" although you had one, or shows "database is behind the code", this step is missing.

Or with Prisma:
If you are upgrading: in `backend/` run `npm install`, then `npm run prisma:migrate -- --name token_enc` (adds one column so you can view your API token again after entering your PIN), then `npm run prisma:generate`. Old tokens must be reset once to become viewable.

## 1. Setup (local)
1. **Supabase:** create a project. Project Settings > Database > Connection string: copy the pooled URL (port 6543) and direct URL (port 5432).
2. **Backend:** `cd backend && cp .env.example .env`, then fill `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, and generate secrets:
   `openssl rand -base64 48` for each of `SESSION_SECRET`, `OTP_PEPPER`, `SETTINGS_KEY`. **Back up `SETTINGS_KEY`:** it decrypts provider secrets saved from the admin panel.
3. `npm install`, then create the schema: `npx prisma migrate dev --name init` (commit the generated `prisma/migrations/`; deployments use `npx prisma migrate deploy`).
   Quick start alternative: `npx prisma db push`.
4. In the **Supabase SQL editor** run `backend/prisma/sql/constraints.sql` (non-negative balances, immutable ledger, one-active-API-token, **row-level security on every table**). Re-run after any migration that adds tables.
5. Set `ADMIN_EMAIL` and `ADMIN_SECRET` (12+ chars) in `.env`: the first start creates a Super Admin from them. Sign in at `/admin`. If you ever change `ADMIN_SECRET` later, or get locked out, run `npm run admin:reset` (in `backend/`) to make the database match `.env` again. Wrap the value in quotes if it contains `#`.
6. `npm run dev` (API on :4000). In another shell: `cd ../frontend && cp .env.example .env.local && npm install && npm run dev` (app on :3000).
   Without SMTP configured, development prints OTP codes to the API console. **SMTP is required in production** (the API refuses to run OTP flows without it).

## 2. Provider setup
**Pay With UPI.** Set your receiving UPI ID in Admin > Settings > UPI receiving. The user types an amount; 2-3 seconds later a **Pay With UPI** link appears. On a phone it opens the system chooser (PhonePe, Paytm, Amazon Pay, FamPay, GPay, BHIM...) with the amount and a `DEP-XXXXXXXX` note filled in. The wallet is credited automatically when your **verified bank feed** reports the payment, so `POST /webhooks/bank` (signed, see `docs/WEBHOOKS.md`) must be fed. Without a feed, nothing can be auto-credited: use Admin > Deposits > Mark paid.

**Transaction ID fallback.** If a payment was not detected, the user can enter the bank transaction ID under "Paid but the balance did not change?"; it only credits when a verified bank record matches.

**Payout provider.** Admin > Settings > payout. It is a template, not code: URL/body with `{destination} {amount} {amount_paise} {reference} {token} {secret}`, plus how to read success/failure/reference from the response. Example for a GET-style provider:
```json
{ "method": "GET", "url": "https://provider.example/api.php?token={token}&paytm={destination}&amount={amount}&comment=Payout",
  "headers": {}, "timeoutMs": 15000,
  "success": { "path": "status", "equals": ["success", "SUCCESS", true] },
  "failure": { "path": "status", "equals": ["failed", "error", false] },
  "referencePath": "txn_id", "status": null, "secrets": { "token": "YOUR_TOKEN" } }
```
"Test" shows the exact request with secrets masked and **sends nothing**. If your provider has a status endpoint, fill `status` (same shape): it is what lets a timed-out payout be settled safely. Without one, timeouts go to manual review (never auto-refunded, never resent). Provider URLs must be public https (SSRF guard).

**Telegram.** Create a bot with @BotFather; set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (16+ random chars). Then `cd backend && set -a && . ./.env && set +a && npx tsx scripts/set-telegram-webhook.ts` (webhook, commands, and the "Wallet" Mini App menu button pointing at `/miniapp`). Users link in the app: Settings > Telegram > Get link code > send `/link CODE` to the bot. **The bot never asks for a PIN**: money actions open the Mini App, where the PIN is entered.

## 3. Production (VPS + Docker)
1. Point your domain's DNS at the server; open ports 80/443. Install Docker.
2. Copy the repo, create `backend/.env` (production values: `NODE_ENV=production`, `APP_URL=https://YOUR_DOMAIN`, SMTP, secrets) and root `.env` (`DOMAIN=YOUR_DOMAIN`).
3. Run migrations once against Supabase from your machine (`prisma migrate deploy`) and apply `constraints.sql`.
4. `docker compose up -d --build`. Caddy obtains HTTPS automatically. Check `https://YOUR_DOMAIN/health`.
5. Run **one** backend instance unless you replace the in-memory rate limiters with Redis (jobs themselves are multi-instance safe).
6. Back up Supabase (point-in-time recovery on a paid plan) and keep `SETTINGS_KEY` somewhere safe.

## 4. Tests
- `cd backend && npm test`: 49 unit tests (tax, money, signatures, UTR format, QR parsing, SSRF guard, payout response mapping, roles, Telegram initData, webhook signing, secret box).
- `npm run test:integration`: 64 tests (money rules plus an 18-step end-to-end run over HTTP: signup, OTP, PIN, deposits, transfers, API token, URL API, admin). Concurrency/financial tests against a **throwaway** Postgres with migrations + `constraints.sql` applied: double withdrawal, duplicate UTR (6 users at once), replayed webhooks, double refund, opposing transfers, racing payers, payout timeout without resend, DB constraints, API token rotation.
- `npm run typecheck` in both `backend/` and `frontend/`.

## 5. How the money rules are enforced
| Rule | Where it is enforced |
|---|---|
| No negative balance / race conditions | Row lock (`SELECT … FOR UPDATE`) in `services/wallet.ts` + DB `CHECK` |
| No double transaction-ID / UPI-order / webhook credit | `UNIQUE(provider, providerReference)`, `UNIQUE(utr)`, event-id table, idempotency keys |
| No double refund | `UNIQUE(refundOf)` + wallet lock |
| No double payout | Claim `PENDING→PROCESSING` before calling the provider; never resend; status check or manual review |
| Server-side tax | `services/tax.ts`; client values are never read; rate stored per transaction |
| Immutable ledger | DB trigger blocks edits to money fields and deletes |
| Unverified transaction ID never credited | Needs matching signed bank record (UTR + amount + destination + payer note) |

## 6. Known limits (read before going live)
- **Not externally audited and not yet run end to end against live providers.** Test with a throwaway database and a small real UPI payment first; have a security review done before real money.
- Real-money payments/payouts can carry regulatory requirements (licensing, KYC, data rules) depending on your country and model. Check with a lawyer.
- UTR "stealing" risk is reduced (payer note matching, global uniqueness) but not eliminated without a bank feed that carries the payer note.
- Wallet-to-wallet transfers are atomic, so a failed transfer debits nothing; "refund on failure" applies to external payouts.
- Rate limiters are in-memory (single instance). Receipts are print-to-PDF pages, not server-generated PDFs.


## Updating an existing install (Pay With UPI, no Razorpay)
1. Run `backend/prisma/sql/upi-orders.sql` in the Supabase SQL editor (or `npx prisma migrate dev --name upi_orders`), then `npm run prisma:generate` in `backend/`.
2. Remove the `RAZORPAY_*` lines from `.env`. The old `RazorpayPayment` table is only history; drop it when you no longer need it.
3. The minimum withdrawal becomes ₹15 on first start (an admin can change it later under Admin > Settings > Limits & fees).
4. Admin > **Site** has maintenance mode, per-feature on/off switches, announcement banner and site details.