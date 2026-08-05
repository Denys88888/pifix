-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "affectsBalance" BOOLEAN NOT NULL DEFAULT true;

-- Rows that existed before this column were all defaulted to true, but the
-- four "paid from the Pi wallet" kinds never moved users.balancePi. Without
-- this backfill the audit query below would report drift for every one of them.
UPDATE "transactions"
SET "affectsBalance" = false
WHERE "type" IN ('CONNECT_SPENT', 'ESCROW_FUNDED', 'BOOST', 'SUBSCRIPTION');
