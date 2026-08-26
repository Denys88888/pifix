-- One on-chain transaction can only ever settle one payment. The unique index
-- is a second line of defence behind piPaymentId against the same transaction
-- being credited twice.
--
-- Existing duplicates are e2e fixtures that reused literal txids ("tx_boost",
-- "tx_sub") across repeated runs. The rows are kept and only the redundant
-- txid is cleared, so nothing is deleted: the newest row per txid keeps it.

UPDATE "payments" p
SET "txid" = NULL
WHERE p."txid" IS NOT NULL
  AND p."id" <> (
    SELECT q."id"
    FROM "payments" q
    WHERE q."txid" = p."txid"
    ORDER BY q."createdAt" DESC, q."id" DESC
    LIMIT 1
  );

UPDATE "withdrawal_requests" w
SET "txid" = NULL
WHERE w."txid" IS NOT NULL
  AND w."id" <> (
    SELECT v."id"
    FROM "withdrawal_requests" v
    WHERE v."txid" = w."txid"
    ORDER BY v."createdAt" DESC, v."id" DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX "payments_txid_key" ON "payments"("txid");
CREATE UNIQUE INDEX "withdrawal_requests_txid_key" ON "withdrawal_requests"("txid");
