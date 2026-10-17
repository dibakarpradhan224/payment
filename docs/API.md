# API Gateway (v1)

Base URL: `https://yourdomain.com/api/v1` — authenticate with `Authorization: Bearer pg_live_...`.
Never put the token in a URL, a browser, or a Telegram message. Server-to-server only.

## Get a token (dashboard / Mini App, cookie session, requires your 4-digit PIN)
| Call | Purpose |
|---|---|
| `POST /web/v1/api-token` `{pin, name?, scopes?}` | Create. Token is shown **once**. |
| `POST /web/v1/api-token/regenerate` `{pin, scopes?}` | New token. **Regenerating your API token will invalidate the previous token.** |
| `POST /web/v1/api-token/revoke` | Revoke now (no PIN needed). |
| `GET  /web/v1/api-token` / `/usage` | Metadata (prefix only, last used) / request stats and recent calls. |

Scopes: `read` (default), `payments`, `transfer`, `withdraw`. Only `read` endpoints exist so far; the others are
reserved for Phases 4-6 and enforced per route.

## Endpoints available now
```bash
curl https://yourdomain.com/api/v1/balance -H "Authorization: Bearer YOUR_API_TOKEN"
curl "https://yourdomain.com/api/v1/transactions?filter=deposits&limit=20" -H "Authorization: Bearer YOUR_API_TOKEN"
curl https://yourdomain.com/api/v1/transactions/TXN-ABCDEFGHJKLM -H "Authorization: Bearer YOUR_API_TOKEN"
curl https://yourdomain.com/api/v1/user -H "Authorization: Bearer YOUR_API_TOKEN"
```
Filters: all, deposits, transfers, received, withdrawals, refunds, payments. `q=` searches txn id / reference / provider reference. Paginate with `cursor` = `nextCursor`.

## Responses
Success `{"success":true,"data":{...}}` — Error `{"success":false,"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient balance."}}`
Money is `{ "paise": "2940", "rupees": "29.40" }` (strings; never floats).
Status codes: 401 invalid/revoked token (always the same message), 403 missing scope / suspended, 404 not yours or not found,
409 duplicate/conflict, 422 validation, 429 rate limited (60 requests/min/token), 5xx server.

## Idempotency
On `POST /api/v1/transfer` and `/withdraw` the `Idempotency-Key` header is optional. Without it, every request sends money (repeat the call, pay again). If you send `Idempotency-Key: <8-128 chars>`, the same key + same body returns the original result and
does nothing twice; same key + different body returns 422 `IDEMPOTENCY_KEY_REUSED`.

## Webhooks the platform receives
- `POST /webhooks/bank` — your bank/aggregator credit feed. Header `X-Signature: hex(HMAC_SHA256(raw_body, BANK_WEBHOOK_SECRET))`,
  body `{"utr":"412345678901","amount":"500.00","payeeUpi":"you@bank","note":"DEP-ABCD2345","receivedAt":"2026-10-06T10:00:00Z"}` (`utr` is the bank transaction ID, `note` is the payment note; `amount` in rupees).
  This feed is what credits "Pay With UPI" deposits automatically (matched by the `DEP-XXXXXXXX` note, else exact amount) and makes Transaction-ID deposits verifiable; without it everything goes to manual review.

## Website endpoints for Add Money (cookie session, used by the web app)
| Method & path | Purpose |
|---|---|
| `GET /web/v1/deposits/config` | Limits and whether Pay With UPI is on |
| `GET /web/v1/deposits/quote?amount=` | Tax and wallet credit for an amount |
| `POST /web/v1/deposits/upi/order` `{amount}` | Create (or reuse) the Pay With UPI order; returns `order.uri` (`upi://pay?...`) |
| `GET /web/v1/deposits/upi/order/:id` | Poll status: `CREATED`, `PAID`, `EXPIRED`, `CANCELLED` |
| `POST /web/v1/deposits/upi/order/:id/cancel` | Cancel an unpaid order |
| `POST /web/v1/deposits/utr` `{amount, transactionId}` | Fallback: claim a payment by bank transaction ID |
| `GET /web/v1/site` | Public: name, banner, maintenance and feature switches |

When a feature is switched off in Admin > Site, money endpoints return 503 `FEATURE_DISABLED` or `MAINTENANCE`.

---
## Gateway endpoints (all `Authorization: Bearer pg_live_…`)
| Method & path | Scope | Notes |
|---|---|---|
| `GET /api/v1/user`, `/balance`, `/transactions`, `/transactions/:id`, `/withdrawals` | read | |
| `POST /api/v1/payment/create` (alias `/merchant/payment/create`, `/receive/request`) | payments | body `{amount, orderId?, description?, expiresInMinutes?, payerInfo?}`. `orderId` makes creation idempotent per merchant. Returns `payment_id` (REQ-…), `payment_url`, `qr_payload`, `expires_at` |
| `GET /api/v1/payment/:id` (alias `/merchant/payment/:id`, `/receive/:id`) | payments | `status`: pending / paid / expired / cancelled |
| `POST /api/v1/transfer` | transfer | body `{to, amount, pin, description?}` (`Idempotency-Key` header optional) (`to` = Payment ID, email or mobile) |
| `POST /api/v1/withdraw` | withdraw | body `{amount, upiId, pin}` (`Idempotency-Key` header optional) → `202`; poll `/withdrawals` |

```bash
curl -X POST https://yourdomain.com/api/v1/payment/create \
  -H "Authorization: Bearer YOUR_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":"500","orderId":"order-1001","description":"Product payment","expiresInMinutes":30}'
# => {"success":true,"data":{"payment_id":"REQ-8H29XKQ4","amount":"500.00","status":"pending","payment_url":"https://yourdomain.com/pay/REQ-8H29XKQ4",...}}

curl -X POST https://yourdomain.com/api/v1/transfer \
  -H "Authorization: Bearer YOUR_API_TOKEN" -H "Idempotency-Key: 6f1c2b9e-unique-per-request" -H "Content-Type: application/json" \
  -d '{"to":"PAY-ABCD2345","amount":"100","pin":"1234"}'
```
The payer completes a payment by opening `payment_url` (or scanning `qr_payload`) in the app and confirming with their PIN.

## Error codes (selection)
`INVALID_API_TOKEN` 401 · `INSUFFICIENT_SCOPE` 403 · `INSUFFICIENT_BALANCE` 400 · `INVALID_PIN` 400 (`attemptsRemaining`) · `PIN_LOCKED` 429 · `IDEMPOTENCY_KEY_REQUIRED` 400 · `IDEMPOTENCY_KEY_REUSED` 422 · `REQUEST_IN_PROGRESS` 409 · `DUPLICATE_TRANSACTION` 409 · `ALREADY_PAID` 409 · `REQUEST_EXPIRED` 410 · `WALLET_FROZEN` 403 · `RATE_LIMITED` 429 · `VALIDATION_ERROR` 422.
Rate limit: 60 requests/minute/token.


---
## Simple URL API (token in the web address)
For bots and no-code tools. Prefer the header API above for servers.

| URL | Token scope | What it does |
|---|---|---|
| `GET /api/transfer?token=TOKEN&number={wallet}&amount={amount}&comment={comment}` | `transfer` (wallet) or `withdraw` (UPI ID) | Send money. `number` = wallet number (registered mobile), Payment ID, email, or UPI ID. Aliases: `wallet`, `upi`, `to` |
| `GET /api/transfer-status?token=TOKEN&ref=REF` | transfer / withdraw | Status of a payout sent with `ref` |
| `GET /api/payment?token=TOKEN&amount={amount}&order_id={order_id}&comment={comment}` | `payments` | Create a payment, returns `payment_url` |
| `GET /api/payment-status?token=TOKEN&payment_id=REQ-XXXXXXXX` | `payments` | pending / paid / expired / cancelled |
| `GET /api/balance?token=TOKEN` | `read` | Wallet balance |

The older `/api/v1/url/...` paths keep working.

**Repeated requests:** every request sends money again; calling the same URL twice pays twice. Optional: add `&ref=UNIQUE` (8-64 chars) if you want retry protection, then the same ref never pays twice (a different amount or destination with the same ref returns `REF_REUSED`).
**Limits:** URL sends share a daily cap (default ₹10,000); wallet transfers from ₹0.50; UPI payouts follow the admin's minimum (default ₹15). 60 requests/minute/token.
**Never** place the full URL in a web page, app or message: it contains your token. Servers redact `token=` from logs.

```bash
curl "https://yourdomain.com/api/transfer?token=YOUR_TOKEN&number=9876543210&amount=10&comment=Payout"
# {"success":true,"data":{"type":"wallet","status":"success","message":"Transfer successful.", ...}}
```


---
## Two tokens: Payout and Merchant
Create them on the API documentation page (each needs your PIN):
- **Payout token** (`read`, `withdraw`, `transfer`): send money. It cannot create payments.
- **Merchant token** (`read`, `payments`): accept payments. It cannot send money out.
Using the wrong token for an endpoint returns `INSUFFICIENT_SCOPE`. Resetting one token never affects the other. Recipient names in API replies are display names (`recipient.displayName`), never email addresses.
