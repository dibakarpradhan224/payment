# Webhooks

## Merchant webhooks (platform → your server)
Configure in the app: API > Webhooks (HTTPS URL + events). You get a signing secret **once**; rotate it any time.
Events: `payment.created`, `payment.pending`, `payment.success`, `payment.failed` (expired or cancelled), `payment.refunded`, `withdrawal.success`, `withdrawal.failed`.

Request: `POST` JSON `{ "id":"evt_…", "event":"payment.success", "created_at":"…", "data":{ "payment_id":"REQ-…", "amount":"500.00", "order_id":"order-1001", "transaction_id":"TXN-…" } }`
Headers: `X-Gateway-Event`, `X-Gateway-Delivery`, `X-Gateway-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`.
Reply 2xx within 10 s. Otherwise we retry 8 times (30 s, 1 m, 5 m, 15 m, 1 h, 3 h, 6 h, 12 h). Deliveries can repeat: **dedupe on `id`**. Verify before trusting, and reject timestamps older than 5 minutes.

```js
// Node
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(rawBody, header, secret) {
  const p = Object.fromEntries(header.split(',').map((x) => x.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;
  const mine = createHmac('sha256', secret).update(`${p.t}.${rawBody}`).digest();
  const theirs = Buffer.from(p.v1, 'hex');
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}
```
```python
# Python
import hmac, hashlib, time
def verify(raw: bytes, header: str, secret: str) -> bool:
    p = dict(x.split("=", 1) for x in header.split(","))
    if abs(time.time() - int(p["t"])) > 300: return False
    mine = hmac.new(secret.encode(), p["t"].encode() + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mine, p["v1"])
```

## Bank / aggregator credit feed (your bank → platform)
`POST https://YOUR_DOMAIN/webhooks/bank`, header `X-Signature: hex(HMAC_SHA256(raw body, BANK_WEBHOOK_SECRET))`.
Body: `{ "utr":"412345678901", "amount":"500.00", "payeeUpi":"you@bank", "payerName":"…", "note":"PAY-ABCD2345", "receivedAt":"2026-10-06T10:00:00Z" }`.
Idempotent per transaction ID. A Pay With UPI order is credited when the note contains its `DEP-XXXXXXXX` reference and the amount is exact (or, with no reference, when exactly one open order has that exact amount). Transaction-ID submissions waiting on that ID are credited when ID, amount, destination UPI and (if present) the payer's `PAY-…` note all match.


## Telegram → platform
`POST /webhooks/telegram`, authenticated by `X-Telegram-Bot-Api-Secret-Token`.
