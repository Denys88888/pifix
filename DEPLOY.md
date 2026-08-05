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

> **The slug is not the address, and the address does not exist yet.** The PiNet
> subdomain is created at checklist step 9, and PiNet appends 4 random digits to
> whatever name you choose — so it is neither `pifix-c5u9.pinet.com` nor
> anything else you can predict. (For the sibling Taxi Pro app the slug and the
> subdomain differ completely.) Nor can you probe for it: every `*.pinet.com`
> host, including a nonsense one, answers HTTP 200 with the same generic PiNet
> page. Read the real value from **PiNet Settings → "Current PiNet subdomain"**
> once step 9 is done, then put it into `VITE_APP_URL`.

### Already done — the app sits at 3 of 10

Walked in an emulator on 2026-08-05. **Configuration saves fine before the site
is live**: both "Your App's URL" and "Your App's development URL" are required
fields, but they only have to be *filled*, not reachable — ownership is verified
much later, at checklist step 8. Currently stored:

| Field | Value |
|---|---|
| App URL | `https://pifix-web.onrender.com` |
| Development URL | `http://localhost:5180` |
| Subtitle | Hire a master, pay in Pi |
| Description | Hire verified handymen and pay in Pi. … |
| Network / Visibility / Hosting | Pi Testnet / Public / Self Hosted |

> If your Render static site ends up with a different name, change the App URL
> to match before doing step 8 — the validation fetches `validation-key.txt`
> from exactly this host.

Field limits, so nothing is truncated on paste: **App Name 80**,
**Subtitle 30**, **Description 140**.

One practical gotcha: the portal's WebView drops fast input. Typing a 30-character
URL in one go landed only `htt`. Paste, or type in short bursts.

### The remaining 7 steps, in the portal's own order

| # | Step | State | Needs |
|---|---|---|---|
| 1 | Create App | ✅ done | — |
| 2 | Configure Hosting | next | a real host — Render |
| 3 | Connect App Wallet | 🔒 locked | step 2 first; generates the seed for `PI_WALLET_PRIVATE_SEED` |
| 4 | Code Your App | 🔒 locked | step 2 first |
| 5 | Configure Development URL | done as part of Configuration | — |
| 6 | Run Development App in the Sandbox | 🔒 locked | `sandbox: true` in the frontend + a code from the Pi app's Utilities page |
| 7 | Deploy App to Production Environment | 🔒 locked | the live Render URL |
| 8 | Validate Domain Ownership | 🔒 locked | `validation-key.txt` served from the App URL |
| 9 | Add a PiNet subdomain | 🔒 locked | step 8 first. **PiNet appends 4 random digits**, so the address is not the slug and cannot be guessed |
| 10 | Process transactions | 🔒 locked | everything above |

Steps 3 and 4 sit behind a padlock until hosting is configured, so **Render is
genuinely the gate** — just not for the reason first assumed.

### What to do after Render is live

1. **Connect App Wallet** — unlocks once hosting is set. Its private seed becomes
   `PI_WALLET_PRIVATE_SEED`. Without it escrow release and withdrawals cannot
   run and the admin dashboard keeps showing "Payouts not configured".
2. **API Key** — copy into the Render API service as `PI_API_KEY`.
3. **Pi Sign-In** — request the scopes `username`, `payments`, `wallet_address`.
   `payments` is what exposes the wallet address used for payouts.
4. **Validate Domain Ownership** — the portal hands you a key; put it in
   `frontend/public/validation-key.txt`, commit, redeploy. It then answers at
   `https://<your-static-site>/validation-key.txt`.
5. **Add a PiNet subdomain** — only now does the public address exist. Read it
   back, then set `VITE_APP_URL` on the static site and add it to `CORS_ORIGINS`
   on the API.

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
