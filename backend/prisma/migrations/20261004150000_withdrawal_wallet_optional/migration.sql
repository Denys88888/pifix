-- A2U payouts are addressed by Pi uid; the wallet is known for sure only after the payout.
-- AlterTable
ALTER TABLE "withdrawal_requests" ALTER COLUMN "walletAddress" DROP NOT NULL;

