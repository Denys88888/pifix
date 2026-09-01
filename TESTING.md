# PiFix — release checklist

## Automated first

Six suites, 197 assertions. All refuse to run with `NODE_ENV=production`.
`test:unit` needs nothing running; the rest need a database, and three of them
need the fake Pi API as well.

### The money paths — 46 assertions

```bash
cd backend && set -a && . ./.env && set +a && npm run test:money
```

Escrow release, double-confirm protection, auto-release, dispute freezing the
timer, admin refunds, reviews and rating recomputation, withdrawal guards, GDPR
erasure, unanswered orders expiring while funded ones are left alone, ledger
integrity. Payment-gated transitions are seeded into exactly the
state a verified payment produces; everything downstream runs through the real
HTTP API.

### Payment verification, adversarially — 51 assertions

```bash
# terminal 1
cd backend && set -a && . ./.env && set +a && npm run fake-pi
# terminal 2
cd backend && set -a && . ./.env && set +a \
  && PORT=3010 PI_API_BASE_URL=http://localhost:4010 ENABLE_INTERNAL_CRON=false npm run dev
# terminal 3
cd backend && set -a && . ./.env && set +a && npm run test:payments
```

`scripts/fakePiApi.ts` speaks the Pi Platform protocol, so the backend runs its
genuine approve → chain → complete → grant pipeline while the test crafts
payments the real SDK would never produce. What it proves:

- an underpaid connect is refused **and never approved on the Pi API**
- you cannot approve a payment belonging to another user
- malformed or hostile metadata is refused
- a cancelled payment grants nothing
- **approval alone grants nothing** — the response only appears after completion
- replaying a completed payment is idempotent: no second response, no second grant
- an escrow that skips the commission is refused and the order stays `OPEN`
- a payment left incomplete **after the chain confirmed it** is finished, not
  cancelled — the money had already gone, so the purchase must still be granted
- completion is refused while the chain has not verified the transaction
- the honest escrow books 38.5 / 3.85 / 42.35 Pi exactly

### Security controls — 17 assertions

```bash
cd backend && set -a && . ./.env && set +a && npm run test:security
```

Everything the checklist below asserts about defences, actually exercised: a PDF
renamed to `.jpg` is caught by the magic-byte check before Cloudinary is
touched, oversized and wrong-type files are refused, the 5-orders-per-hour cap
fires and is **per user, not per IP** (carrier NAT would otherwise punish a whole
city), reads keep working while writes are limited, admin login is brute-force
braked, and hostile input is rejected rather than truncated.

### Referrals, boost, and the failed-payout path — 24 assertions

```bash
# same three terminals, but the backend needs a wallet that cannot sign:
PORT=3010 PI_API_BASE_URL=http://localhost:4010 ENABLE_INTERNAL_CRON=false \
PAYOUTS_ENABLED=true PI_WALLET_PRIVATE_SEED=SBOGUS... PI_HORIZON_URL=http://localhost:4999 \
npm run dev
# then
npm run test:extras
```

Two-level referral bonuses (including the once-only guard, self-referral and
unknown referrers), boost and subscription purchases with the renewal extending
rather than resetting, and the one that matters most: **an on-chain payout that
fails must restore the balance**. The withdrawal debits first and transfers
second, so a failure that did not roll back would silently destroy earnings.
The suite forces that failure with an unsignable wallet seed and asserts the
balance comes back and the request reopens for a retry.

It first asserts that payouts are actually enabled. Without that guard the whole
section passes vacuously: with payouts disabled the controller refuses before it
debits, so there is nothing to roll back and every assertion goes green for the
wrong reason.

### `npm run test:unit`

```bash
npm run test:unit          # no database, no server, no fake Pi
```

The money layer on its own: rounding direction, the display formatter, and
`computeOrderCharges` — the single source of truth that the quote endpoint,
payment approval and the escrow bookkeeping all read. If those three ever
disagree, someone is charged one number and paid another.

The last section is the one worth keeping: for a spread of budgets, fee
percentages that never divide evenly, and amounts below the 7-decimal floor, it
asserts that **what the client pays equals what the master receives plus what
the platform keeps**. Anything else means arithmetic created or destroyed Pi.

### `npm run test:kyc`

```bash
# same as test:extras, plus the gate switched on:
PORT=3010 PI_API_BASE_URL=http://localhost:4010 ENABLE_INTERNAL_CRON=false \
PAYOUTS_ENABLED=true PI_WALLET_PRIVATE_SEED=SBOGUS... REQUIRE_KYC=true \
npm run dev
# then
npm run test:kyc
```

The KYC gate on payouts. Two gates enforce one rule — the withdrawal form
refuses early so the answer arrives before the balance moves, and `sendPayout`
refuses again because every path that moves Pi out of the app goes through it.

The section that matters is the third: KYC is revoked *after* a withdrawal has
already been accepted, so the form gate is behind us and only the gate inside
`sendPayout` can still stop the transfer. It must refuse, restore the balance
and reopen the request.

Like the payout suite, it first asserts the gate is switched on: with
`REQUIRE_KYC` unset on Testnet every assertion would pass vacuously.

Last full run: **48 + 46 + 51 + 24 + 17 + 11 = 197 passed, 0 failed** (2026-09-01, local).

No suite replaces items 8, 9, 12 and 17 below: only a real device proves the Pi
SDK callbacks behave in Pi Browser.

---


Run the whole list before every deploy that touches money. Items marked **Pi
Browser** cannot be verified in desktop Chrome — the SDK simply is not there.

---

### Environment & boot

- [ ] **1. Health check.** `GET /api/health` returns `{"status":"ok","database":"up"}`.
      A `503` means the API booted but cannot reach Postgres.
- [ ] **2. Seed data.** `GET /api/settings` returns all prices, and
      `GET /api/categories` returns 12 categories. Empty = `npm run seed` was never run.
- [ ] **3. Outside Pi Browser.** Open the site in desktop Chrome: the
      "Open in Pi Browser" screen appears, the language switcher works, and the
      copy-link button copies the URL. Nothing crashes, no blank screen.
- [ ] **4. Pi Browser boot.** Open the `*.pinet.com` address in Pi Browser:
      `Pi.authenticate` prompts, and after approval the header shows `@username`
      and a balance.

### Client flow

- [ ] **5. Publish a job.** Category, title, description, budget, address, map
      point, urgent toggle and up to 3 photos. Below `min_budget_pi` the publish
      button stays disabled; the server also rejects it with `budget_too_low`.
- [ ] **6. Order limit.** Publish until you hit `max_open_orders_per_client`;
      the next attempt returns `order_limit_reached`, not a 500.
- [ ] **7. Rate limit.** Publish 6 jobs within an hour → the 6th returns
      `order_rate_limited` (429).
- [ ] **8. Escrow payment (Pi Browser).** Pick a master, check the breakdown
      (budget + fee % + express), pay. The order becomes `IN_PROGRESS`, other
      responses flip to `REJECTED`, and `payments` has one `COMPLETED` row with a
      `txid`.
- [ ] **9. Tampered amount.** In the Pi wallet sheet, try to pay a different
      amount (or replay an old `paymentId`): the server refuses approval with
      `amount_mismatch` and the order stays `OPEN`.
- [ ] **10. Confirm & release.** Master marks the job done → client confirms →
      the master's `balancePi` grows by `masterPayoutPi` and a `JOB_EARNING`
      transaction appears. Pressing confirm twice is a no-op, not a double payout.

### Master flow

- [ ] **11. Verification gate.** An unverified master cannot respond: the
      response button surfaces `master_not_verified`, and the connect payment is
      never created. Approve the profile in `/admin/verifications`, then retry.
- [ ] **12. Connect payment + refund policy (Pi Browser).** The warning text
      shows the real `connect_price_pi` and the refund window before the pay
      button. Cancel a job inside the window → the connect is refunded to the
      master's balance; cancel outside it → no refund.
- [ ] **13. Response limit.** Responses beyond `max_active_responses_per_master`
      return `response_limit_reached` **before** any payment is taken.
- [ ] **14. Withdrawal.** Request below `min_withdrawal_pi` → `amount_too_low`.
      A valid request appears in `/admin/withdrawals`; "Pay out" debits the
      balance, sends the A2U payment and stores a `txid`. If the payout fails,
      the balance is restored and the request returns to `REQUESTED`.

### Escrow edge cases

- [ ] **15. Auto-release.** Set `escrow_timeout_days` to `1` in the admin panel,
      backdate `autoReleaseAt` in the database, then hit any API endpoint: the
      lazy sweep releases the escrow. Also verify
      `POST /api/cron/auto-release` with the correct `X-Cron-Secret` (and that a
      wrong secret returns 401).
- [ ] **16. Dispute.** Either side opens a dispute → status `DISPUTED`,
      `autoReleaseAt` cleared, and the timer no longer fires. Admin resolves with
      release / refund / refund+fees and the balances move accordingly.
- [ ] **17. Incomplete payment (Pi Browser).** Kill the app mid-payment, reopen
      it: `onIncompletePaymentFound` fires, `POST /api/payments/cancel-incomplete`
      runs, and a new payment can be created (no permanent block).

### Platform behaviour

- [ ] **18. Settings take effect without a deploy.** Change `connect_price_pi` in
      `/admin/settings`, reload the app: the new price shows in the UI and the
      server enforces it on the very next payment.
- [ ] **19. Geolocation fallback.** Deny the location permission → the error hint
      appears, the address field plus map-tap still work, and the job can be
      published. Repeat over plain HTTP (`insecure` path) — never a silent fail.
- [ ] **20. Pagination / infinite scroll.** With 40+ open jobs the list loads 20,
      then loads the rest on scroll with no duplicates and no repeated last page.
- [ ] **21. Offline banner.** Turn on airplane mode: the red banner appears,
      requests fail with a translated message, and the app recovers when the
      connection returns.
- [ ] **22. Pull to refresh.** From the top of the jobs list, pull down: the
      spinner appears and the list reloads.
- [ ] **23. Language switch.** Cycle all 10 languages: no raw keys such as
      `orders.title` anywhere, and Arabic flips the layout to RTL (bottom nav,
      the back chevron and the select arrow all mirror).
- [ ] **24. Uploads.** A >5 MB file and a `.gif`/`.pdf` are both rejected on the
      client; renaming a `.pdf` to `.jpg` is rejected by the server's magic-byte
      check.
- [ ] **25. Admin auth.** `/admin` without a token redirects to the login;
      a wrong password is refused and rate-limited after 10 attempts;
      `curl -u admin:pass` (Basic Auth) also works against `/api/admin/*`.
- [ ] **26. CORS.** A request from an unlisted origin is blocked; the
      `*.pinet.com` origin is allowed.
- [ ] **27. Reviews.** Both sides can review once per job; a second attempt
      returns `already_reviewed`. Hiding a review in the admin panel lowers the
      target's `ratingAvg` immediately.
- [ ] **28. Account deletion (GDPR).** With no active jobs, deleting the account
      anonymises the username, clears the wallet, and leaves completed jobs and
      ratings in the statistics. With an active job it refuses with
      `active_orders_exist`.

### Performance & resilience

- [ ] **29. 3G load.** Chrome DevTools → Slow 3G: first paint under 3 s. Leaflet
      must not be in the initial chunk (it loads only when a map is shown).
- [ ] **30. Service worker.** After a deploy, a reload picks up the new build
      (`sw.js` is served with `no-cache`), and no `/api/` response is ever served
      from the cache.

---

## Quick API smoke test

```bash
API=https://pifix-api.onrender.com

curl -s $API/api/health | jq
curl -s $API/api/settings | jq .settings
curl -s "$API/api/orders?limit=5" | jq '.total, .items[0].title'
curl -s -u admin:YOUR_PASSWORD $API/api/admin/dashboard | jq .users
curl -s -X POST -H "X-Cron-Secret: YOUR_CRON_SECRET" $API/api/cron/auto-release | jq
```

## Useful database checks

```sql
-- money that must eventually leave the platform
SELECT sum("escrowAmountPi") FROM orders WHERE "escrowStatus" = 'FUNDED';
SELECT sum("balancePi")      FROM users;

-- Ledger integrity: the balance must equal the sum of that user's
-- balance-moving transactions. The `affectsBalance` filter is not optional —
-- connect fees, escrow funding, boost and subscription are paid from the Pi
-- wallet, are stored for history with affectsBalance = false, and never touch
-- balancePi. Omit the filter and this query reports drift for every user who
-- has ever paid for anything.
SELECT u.username, u."balancePi", COALESCE(sum(t."amountPi"), 0) AS ledger
FROM users u
LEFT JOIN transactions t ON t."userId" = u.id AND t."affectsBalance"
GROUP BY u.id HAVING u."balancePi" <> COALESCE(sum(t."amountPi"), 0);

-- escrows past their deadline that the sweep has not settled
SELECT "publicId", "autoReleaseAt" FROM orders
WHERE "escrowStatus" = 'FUNDED' AND "autoReleaseAt" < now();
```

The second query must return **zero rows**. Any row means the ledger and the
balance drifted apart, and payouts should be paused until it is explained.

One caveat learned the hard way: the query also flags rows that were inserted by
hand. Seeding a user with a `balancePi` but no matching `transactions` row
produces a false alarm that looks exactly like real drift. Every balance written
by the application goes through `postTransaction`, which writes both in one
database transaction — so if this query fires, first confirm the affected rows
were not hand-seeded.
