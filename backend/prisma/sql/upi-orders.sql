-- Upgrade for the "Pay With UPI" deposit flow. Run in the Supabase SQL editor (or use `prisma migrate dev` / `prisma db push`).
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS "UpiOrder" (
  "id"        TEXT PRIMARY KEY,
  "orderRef"  TEXT NOT NULL UNIQUE,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"    BIGINT NOT NULL CHECK ("amount" > 0),
  "status"    TEXT NOT NULL DEFAULT 'CREATED',
  "txnId"     TEXT,
  "bankUtr"   TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "paidAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UpiOrder_userId_createdAt_idx" ON "UpiOrder"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UpiOrder_status_expiresAt_idx" ON "UpiOrder"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "UpiOrder_status_amount_idx" ON "UpiOrder"("status", "amount");
ALTER TABLE "UpiOrder" ENABLE ROW LEVEL SECURITY;

-- Razorpay is removed. Old rows are only history; drop the table once you no longer need them:
-- DROP TABLE IF EXISTS "RazorpayPayment";
