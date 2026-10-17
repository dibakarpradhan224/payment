-- Run in the Supabase SQL editor after `prisma migrate deploy`. Safe to re-run after every migration.

-- 1) Database refuses negative balances / amounts (defence in depth).
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS wallet_available_nonneg;
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_available_nonneg CHECK ("available" >= 0);
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS wallet_locked_nonneg;
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_locked_nonneg CHECK ("locked" >= 0);
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS tx_amounts_nonneg;
ALTER TABLE "Transaction" ADD CONSTRAINT tx_amounts_nonneg
  CHECK ("amount" > 0 AND "grossAmount" > 0 AND "tax" >= 0 AND "fee" >= 0 AND "netAmount" >= 0);

ALTER TABLE "UpiOrder" DROP CONSTRAINT IF EXISTS upi_order_amount_pos;
ALTER TABLE "UpiOrder" ADD CONSTRAINT upi_order_amount_pos CHECK ("amount" > 0);
ALTER TABLE "UtrSubmission" DROP CONSTRAINT IF EXISTS utr_amount_pos;
ALTER TABLE "UtrSubmission" ADD CONSTRAINT utr_amount_pos CHECK ("amount" > 0);
-- Only ONE active API token per user per kind (payout / merchant), enforced by the database.
DROP INDEX IF EXISTS apitoken_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS apitoken_one_active_per_kind ON "ApiToken" ("userId", "kind") WHERE "status" = 'ACTIVE';

-- 2) Ledger immutability: financial fields can never change, rows can never be deleted.
CREATE OR REPLACE FUNCTION tx_guard_update() RETURNS trigger AS $$
BEGIN
  IF NEW."txnId" <> OLD."txnId" OR NEW."userId" <> OLD."userId" OR NEW."type" <> OLD."type"
     OR NEW."direction" <> OLD."direction" OR NEW."amount" <> OLD."amount"
     OR NEW."grossAmount" <> OLD."grossAmount" OR NEW."tax" <> OLD."tax" OR NEW."taxRateBps" <> OLD."taxRateBps"
     OR NEW."fee" <> OLD."fee" OR NEW."netAmount" <> OLD."netAmount" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey" THEN
    RAISE EXCEPTION 'transaction financial fields are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tx_immutable ON "Transaction";
CREATE TRIGGER tx_immutable BEFORE UPDATE ON "Transaction" FOR EACH ROW EXECUTE FUNCTION tx_guard_update();

CREATE OR REPLACE FUNCTION tx_guard_delete() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'transactions cannot be deleted'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tx_no_delete ON "Transaction";
CREATE TRIGGER tx_no_delete BEFORE DELETE ON "Transaction" FOR EACH ROW EXECUTE FUNCTION tx_guard_delete();

-- 3) Supabase exposes public tables via its REST API with the anon key.
--    RLS on with NO policies = anon/authenticated roles read nothing. The backend's postgres role bypasses RLS.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
