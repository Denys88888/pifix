# Deploying PiFix on Render

Two services + one database. Total time from zero: about 40 minutes, most of it
waiting for Render and for Pi Developer Portal fields.

---

## 0. Before you start

You need:

| Thing | Where |
|---|---|
| Pi **Server API Key** (Testnet) | Pi Developer Portal → your app → *API Key* |
| Pi **App wallet seed** (starts with `S…`) | Pi Developer Portal → your app → *App Wallet* |
| Cloudinary cloud name + key + secret | cloudinary.com (free tier is enough) |
| A GitHub repo with this code | `git push` |

> The wallet seed controls real funds. Put it only into Render's environment
> variables — never into the repo, never into the frontend.

---

## 1. Create the database

Render → **New → PostgreSQL**

- Name: `pifix-db`
- Region: pick the one closest to your users (`frankfurt` covers EU/Africa/Asia well)
- Plan: Free to start. **Paid tier gives daily backups** — switch before you take
  real money.

Copy the **Internal Database URL** — that is `DATABASE_URL`.

---

## 2. Deploy the API

Render → **New → Web Service** → connect the repo.

| Field | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

`npm start` runs `prisma migrate deploy` first, so every deploy applies pending
migrations automatically.

### Environment variables

```
NODE_ENV=production
PORT=3000
DATABASE_URL=<Internal Database URL from step 1>

PI_API_KEY=<Server API Key>
PI_API_BASE_URL=https://api.minepi.com
PI_SANDBOX=true
REQUIRE_KYC=false

PI_WALLET_PRIVATE_SEED=<S… seed>
PI_HORIZON_URL=https://api.testnet.minepi.com
PI_NETWORK_PASSPHRASE=Pi Testnet
PAYOUTS_ENABLED=true

CLOUDINARY_CLOUD_NAME=…
CLOUDINARY_API_KEY=…
CLOUDINARY_API_SECRET=…
CLOUDINARY_FOLDER=pifix

ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<see below>

JWT_SECRET=<64 random chars>
JWT_EXPIRES_IN=30d
ADMIN_JWT_EXPIRES_IN=12h

CORS_ORIGINS=https://pifix-web.onrender.com,https://REPLACE-ME.pinet.com
CRON_SECRET=<32 random chars>
ENABLE_INTERNAL_CRON=true
LAZY_SWEEP_INTERVAL_SECONDS=300
LOG_LEVEL=info
```

Generate the admin password hash locally — never store the plain password:

```bash
cd backend && npm run hash-admin-password -- 'your-long-admin-password'
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Seed the reference data

Once the API is live, open Render → `pifix-api` → **Shell**:

```bash
npm run seed
```

This creates the 12 categories and the single `platform_settings` row with the
documented defaults. It is idempotent — safe to re-run.

---

## 4. Deploy the frontend

Render → **New → Static Site** → same repo.

| Field | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

### Environment variables

```
VITE_API_URL=https://pifix-api.onrender.com/api
VITE_PI_SANDBOX=true
# The pinet subdomain from step 5.7 — NOT the Render URL, or referral links
# hand users an address they cannot open in Pi Browser.
VITE_APP_URL=https://REPLACE-ME.pinet.com
```

### Redirects / Rewrites (required)

Render → the static site → **Redirects/Rewrites**:

| Source | Destination | Action |
|---|---|---|
| `/*` | `/index.html` | Rewrite |

Without this, a hard refresh on `/orders/123` returns 404.

Render serves real files before applying rewrites, so once
`frontend/public/validation-key.txt` exists it is returned as-is. If that URL
ever answers with HTML instead, the file is missing from the build — the rewrite
is swallowing it, and Pi's validation will fail.

Then go back to the API service and make sure the static site's URL is in
`CORS_ORIGINS`.

---

## 5. Finish the app in the Pi Developer Portal

The app is already registered on **Testnet** with slug `pifix-c5u9`.

> **The slug is not the address.** PiNet assigns its own subdomain and appends
> digits to it, so the public address is *not* `pifix-c5u9.pinet.com`. (For the
> sibling Taxi Pro app the slug and the subdomain differ completely.) Every
> `*.pinet.com` host answers HTTP 200 with the same generic PiNet page, so you
> cannot discover it by guessing and curling — the only source of truth is
> **Develop → My Apps → PiFix (Testnet) → PiNet Settings → "Current PiNet
> subdomain"**. Read it there and put it into `VITE_APP_URL`.

Do these in order. **Nothing in the portal can be saved before the site is
live** — verified by walking the screens in an emulator on 2026-08-05:

- **Configuration** refuses to submit without *both* "Your App's URL" and "Your
  App's development URL" (`Frontend URL is required` / `Development URL is
  required`). So even the description cannot be changed first — Render has to
  come before any portal edit.
- **PiNet Settings** shows *"You must validate your domain ownership first
  before creating PiNet subdomain"*, and the subdomain does not exist yet. It is
  created only after the App URL is verified, and **PiNet appends 4 random
  digits** to whatever you type — that is why the address is unpredictable.

Field limits, so nothing gets truncated on paste: **App Name 80**,
**Subtitle 30**, **Description 140** characters.

Existing values that are already correct: App Network `Pi Testnet`,
Testnet App Visibility `Public`, App Hosting `Self Hosted`.

| # | Portal screen | What to enter |
|---|---|---|
| 1 | **Configuration → App URL** | `https://pifix-web.onrender.com` (the Render static site, not the pinet address) |
| 2 | **Configuration → Description** | see the ready-made text below — `Ttt` is still a placeholder |
| 3 | **Wallet → Connected App Wallet** | create the app wallet. Its private seed becomes `PI_WALLET_PRIVATE_SEED`. **Without it escrow release and withdrawals cannot run** — the admin dashboard will keep showing "Payouts not configured" |
| 4 | **API Key** | copy it into the Render API service as `PI_API_KEY` |
| 5 | **Pi Sign-In** | request the scopes `username`, `payments`, `wallet_address`. `payments` is what exposes the wallet address used for payouts |
| 6 | **Checklist → validation key** | put the generated `validation-key.txt` into `frontend/public/`, commit, redeploy — it then answers at `https://pifix-web.onrender.com/validation-key.txt` |
| 7 | **PiNet Settings** | read "Current PiNet subdomain" — that is the real public address. Put it into `VITE_APP_URL` on the static site and add it to `CORS_ORIGINS` on the API |

> Never paste the wallet seed into a chat, an issue, or a commit. It goes
> straight from the portal into Render's environment variables and nowhere else.

### Ready-made text, already trimmed to the field limits

**Subtitle** (24/30):

> Hire a master, pay in Pi

**Description** (135/140):

> Hire verified handymen and pay in Pi. Plumbers, electricians, movers, cleaners
> and more. Your Pi stays in escrow until the job is done.

Russian variant of the description, if you prefer it (133/140):

> Нанимайте мастеров и платите в Pi. Сантехники, электрики, грузчики, уборка и
> другое. Ваши Pi в escrow, пока вы не подтвердите работу.

---

## 6. Escrow auto-release cron

Three independent layers already run; the external one is the safety net for a
free-tier instance that goes to sleep:

1. **Lazy sweep** — every API request may trigger a throttled sweep (built in).
2. **Internal cron** — hourly `node-cron` inside the API (`ENABLE_INTERNAL_CRON`).
3. **External cron** — set up at [cron-job.org](https://cron-job.org):

| Field | Value |
|---|---|
| URL | `https://pifix-api.onrender.com/api/cron/auto-release` |
| Method | POST |
| Schedule | every hour |
| Header | `X-Cron-Secret: <CRON_SECRET>` |

The endpoint is idempotent, so overlapping triggers are harmless.

---

## 7. Backups

Free Postgres has **no automatic backups**. Until you upgrade, run a daily dump:

```bash
pg_dump "$DATABASE_URL" | gzip > "pifix-$(date +%F).sql.gz"
```

Before you handle real money, move the database to a paid plan and turn on
Render's daily backups.

---

## 8. Going to Mainnet

When Pi opens Mainnet for your app:

1. Swap `PI_API_KEY` for the Mainnet key.
2. `PI_SANDBOX=false` (API) and `VITE_PI_SANDBOX=false` (web).
3. `PI_HORIZON_URL=https://api.mainnet.minepi.com`
4. `PI_NETWORK_PASSPHRASE=Pi Network`
5. Replace `PI_WALLET_PRIVATE_SEED` with the Mainnet app wallet seed and fund it —
   payouts fail with `payouts_disabled`/insufficient balance otherwise.
6. `REQUIRE_KYC=true` once you confirm `kyc_status` is returned for your app.
7. Re-run the full checklist in [TESTING.md](TESTING.md).

---

## 9. Local development

```bash
# backend
cd backend
cp .env.example .env          # fill DATABASE_URL, PI_API_KEY, JWT_SECRET, CRON_SECRET
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                   # http://localhost:3000

# frontend
cd ../frontend
cp .env.example .env          # VITE_API_URL=http://localhost:3000/api
npm install
npm run dev                   # http://localhost:5173
```

Outside Pi Browser the app shows the "Open in Pi Browser" screen — that is the
expected fallback, not a bug. `/admin` still works in a normal browser.

To work on the UI in a normal browser, add `VITE_PI_MOCK=true` to
`frontend/.env`. It loads `src/lib/piSdkMock.ts`, which fakes only the
*presence* of the SDK so the shell and every signed-out screen render. It never
fakes anything the server verifies — sign-in and payments still fail by design —
and it sits behind `import.meta.env.DEV`, so the production build drops it
entirely. Verify with `grep -r "Pi SDK mock" frontend/dist/` (must find nothing).
