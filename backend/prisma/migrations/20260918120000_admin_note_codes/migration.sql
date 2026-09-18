-- Server-written withdrawal notes become codes the admin panel translates
-- (see src/lib/adminNotes.ts). Only the exact phrases the server used to write
-- are touched; anything an admin typed by hand is left as it is.

UPDATE "withdrawal_requests" SET "adminNote" = '@cancelled_by_user'
 WHERE "adminNote" = 'Cancelled by the user';

UPDATE "withdrawal_requests" SET "adminNote" = '@rejected_by_admin'
 WHERE "adminNote" = 'Rejected by admin';

UPDATE "withdrawal_requests" SET "adminNote" = '@auto_created'
 WHERE "adminNote" = 'Created automatically (auto_withdrawal_pi threshold reached)';

UPDATE "withdrawal_requests" SET "adminNote" = '@reconciled_paid'
 WHERE "adminNote" = 'Confirmed on the ledger after an unconfirmed transfer';

UPDATE "withdrawal_requests" SET "adminNote" = '@reconciled_restored'
 WHERE "adminNote" = 'Transfer never reached the ledger — balance restored, request reopened';

UPDATE "withdrawal_requests" SET "adminNote" = '@payout_failed: ' || substr("adminNote", length('Payout failed: ') + 1)
 WHERE "adminNote" LIKE 'Payout failed: %';

UPDATE "withdrawal_requests"
   SET "adminNote" = '@payout_unconfirmed: ' || regexp_replace("adminNote", '^Payout outcome unknown — check Pi payment (.*) before retrying$', '\1')
 WHERE "adminNote" ~ '^Payout outcome unknown — check Pi payment .* before retrying$';
