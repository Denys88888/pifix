# PiFix

Marketplace for hiring handymen — plumbers, electricians, mechanics, builders,
demolition crews, couriers, movers, cleaners, furniture assemblers, appliance
repair and on-site IT — inside the Pi Network ecosystem. Payments, escrow and
payouts all run on Pi.

Built for **Pi Browser** (Android WebView / iOS WKWebView), mobile-first, dark
theme, 10 languages.

```
pifix/
├── backend/                    Node + Express + TypeScript + Prisma + PostgreSQL
│   ├── prisma/
│   │   ├── schema.prisma       all models, enums, indexes, relations
│   │   └── seed.ts             categories + platform_settings defaults
│   ├── scripts/hashPassword.ts bcrypt hash generator for the admin password
│   └── src/
│       ├── config/env.ts       Zod-validated environment
│       ├── lib/                prisma, logger, errors, money, ids, cloudinary, serializers
│       ├── middleware/         auth, adminAuth, rateLimit, validate, errorHandler, upload, lazySweep
│       ├── services/           piApi, piPayouts, paymentVerification, escrow, ledger,
│       │                       settings, referral, geolocation
│       ├── controllers/        auth, orders, responses, masters, payments, reviews,
│       │                       uploads, withdrawals, admin
│       ├── routes/             auth, orders, masters, payments, misc, admin, cron
│       ├── app.ts              express app: helmet, cors, rate limits, routers
│       └── server.ts           bootstrap, node-cron fallback, graceful shutdown
├── frontend/                   React 18 + TypeScript + Vite + CSS Modules
│   ├── public/
│   │   ├── locales/{10 langs}/translation.json
│   │   ├── sw.js               static-asset cache only
│   │   └── manifest.webmanifest
│   └── src/
│       ├── api/                axios clients, typed endpoints, DTO types
│       ├── lib/                piSdk, paymentPolling, format
│       ├── contexts/           AuthContext, SettingsContext
│       ├── hooks/              useAuth, useGeolocation, usePlatformSettings, usePolling, usePayment
│       ├── components/         Header, BottomNav, OrderCard, MasterCard, ReviewStars,
│       │                       LeafletMap, ImageUploader, LanguageSwitcher, SkeletonCard,
│       │                       OfflineBanner, PullToRefresh, Modal, PaymentProgress, …
│       ├── pages/              Home, OrdersList, OrderDetail, CreateOrder, MastersList,
│       │                       MasterProfile, MasterDashboard, MasterProfileEdit, Profile,
│       │                       PrivacyPolicy, admin/*
│       └── styles/             one CSS Module per component + global theme
├── render.yaml                 Render blueprint (API + static site + Postgres)
├── DEPLOY.md                   step-by-step deployment
└── TESTING.md                  30-point release checklist
```

---

## How the money works

**Nothing is charged when a job is published.** The client pays once, when they
pick a master.

```
client publishes a job                       free
master responds            → pays connect_price_pi              (user → app)
client picks a master      → pays budget + fee% + express       (user → app)
                              budget is held in escrow (database state)
master marks the job done
client confirms            → escrow released to the master's balance
   …or nothing happens for escrow_timeout_days → auto-released
master requests a withdrawal → admin approves → Pi sent on-chain (app → user)
```

Three properties this design leans on:

- **The server is the only authority on price.** `Pi.createPayment` metadata is
  written by the client, so it is treated as untrusted: at approval time the
  backend recomputes the expected amount from `platform_settings` and the
  database, and refuses to approve anything that does not match
  (`amount_mismatch`). A tampered amount never reaches the chain.
- **Approval grants nothing.** The order/response/subscription is only created
  after `POST /v2/payments/{id}/complete` **and** a re-read of the payment
  confirming `transaction_verified`.
- **Escrow release is idempotent.** The lazy sweep, the internal cron and the
  external cron can all fire on the same order; the second and third are no-ops.

### Why payouts are server-side

`Pi.createPayment` is user → app only. Paying a master requires the App-to-User
flow, which must be signed with the app wallet:

1. `POST /v2/payments` → payment identifier + recipient address
2. build and sign a Stellar payment with `PI_WALLET_PRIVATE_SEED`,
   memo = the payment identifier, submit to the Pi Horizon node
3. `POST /v2/payments/{id}/complete` with the resulting `txid`

That lives in `services/piPayouts.ts`. Dangling A2U payments from a previous
crash are cleared before every new one, otherwise Pi refuses to create it.

---

## Escrow timeout without background jobs

Pi Browser has no background sync, no Web Push and no WebSockets, and Render's
free tier sleeps. So the timeout is driven by three independent layers:

1. **Lazy sweep** (`middleware/lazySweep.ts`) — any API request may kick off a
   sweep, throttled through a `system_state` row so concurrent instances do not
   each run one. Never blocks the response.
2. **Internal cron** — hourly `node-cron` inside the API process.
3. **External cron** — `POST /api/cron/auto-release` with `X-Cron-Secret`,
   for instances that are asleep. Constant-time secret comparison.

---

## Everything priceable is a database row

`platform_settings` (single row, `id = 1`) holds every price and limit:
connect price, client fee %, master fee %, express fee, boost, PRO subscription,
escrow timeout, both referral bonuses, minimum budget, order/response limits,
connect refund window, minimum withdrawal, auto-withdrawal threshold, the
display-only Pi→USD rate and a maintenance flag.

It is read on every request (with a 5-second in-process cache) and edited from
`/admin/settings`. **No redeploy is needed to change a price.**

---

## Security

- Pi access tokens are verified server-side against `GET /v2/me`; nothing the
  client claims about identity is trusted. Sessions are short JWTs.
- Zod validates every body, query and param, and **replaces** the request data
  with the parsed result, so controllers never see unvalidated input.
- Prisma everywhere — the only raw SQL is the parameterless `SELECT 1` health probe.
- `dangerouslySetInnerHTML` is not used anywhere.
- Uploads: type + size checked on the client, then type + size + **magic bytes**
  on the server; EXIF (including GPS) stripped by Cloudinary on ingest.
  ID documents go to a private `authenticated` folder and are deleted on rejection.
- Rate limits: 100/15 min global, 20/15 min payments, 5/hour order creation,
  10/15 min admin login, keyed by user id where the limit must be per-person
  (carrier NAT makes IP-only limits unusable in PiFix's biggest markets).
- Admin: bcrypt password hash in the environment, JWT or HTTP Basic, every
  mutation written to `admin_logs`.
- CORS: an explicit allow-list plus `*.pinet.com`.
- GDPR: account deletion anonymises the user and keeps the marketplace
  statistics; a public `/privacy` page in all 10 languages.

---

## Money never touches a float

Every Pi amount is `DECIMAL(15,7)` in Postgres, `Prisma.Decimal` in the backend,
and a **string** in JSON and in React state. `lib/money.ts` is the only place
that does arithmetic, always rounding down to Pi's 7 decimals. `services/ledger.ts`
is the only place that moves a balance, and it writes the `transactions` row in
the same database transaction — so the audit trail can never drift from the
balance. `TESTING.md` has the SQL that proves it.

---

## Quick start

```bash
cd backend  && npm install && cp .env.example .env   # fill in the values
npx prisma migrate dev --name init && npm run seed && npm run dev
cd ../frontend && npm install && cp .env.example .env && npm run dev
```

Full instructions: **[DEPLOY.md](DEPLOY.md)** · Release checklist: **[TESTING.md](TESTING.md)**

---

## Deliberate non-goals

No Firebase, no Tailwind/Bootstrap, no native app, no WebSockets, no Web Push,
no realtime chat, no video calls, no third-party auth, no raw SQL, no
`dangerouslySetInnerHTML`, no `localStorage` for anything that matters, and no
floats for Pi. Notifications are polling-based, because that is the only thing
that actually works in a Pi Browser WebView.
