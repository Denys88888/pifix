/**
 * End-to-end exercise of the money paths against a running local API.
 *
 * Pi payments cannot be simulated, so the payment-gated transitions are seeded
 * straight into the database (exactly the state a verified payment would have
 * produced) and everything downstream is driven through the real HTTP API.
 * Run with: npm run test:money  (needs the API on :3000 and a seeded database)
 */
import { PrismaClient, EscrowStatus, OrderStatus, ResponseStatus } from '@prisma/client';
import { expireStaleOrders } from '../src/services/escrow';
import { invalidateSettings } from '../src/services/settings';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const prisma = new PrismaClient();
const API = 'http://localhost:3000/api';
const SECRET = process.env.JWT_SECRET!;
const CRON = process.env.CRON_SECRET!;

// Admin credentials come from the environment — never hardcode them here, this
// file is committed. Requires a plain ADMIN_PASSWORD, so it only works against
// a local dev server, which is the only place this suite should ever run.
const ADMIN_BASIC = `${process.env.ADMIN_USERNAME ?? 'admin'}:${process.env.ADMIN_PASSWORD ?? ''}`;

if (!SECRET || !CRON || !process.env.ADMIN_PASSWORD) {
  console.error(
    'Missing env. Run from backend/ with:\n  set -a && . ./.env && set +a && npm run test:money',
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this suite writes test data and must never touch production.');
  process.exit(1);
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const pid = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

function token(user: { id: string; piUid: string; username: string }) {
  return jwt.sign({ sub: user.id, uid: user.piUid, username: user.username }, SECRET, {
    expiresIn: '1h',
    issuer: 'pifix',
    audience: 'pifix-user',
  });
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; basic?: string } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.basic) headers.Authorization = `Basic ${Buffer.from(opts.basic).toString('base64')}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

async function main() {
  const category = await prisma.category.findFirstOrThrow({ where: { slug: 'plumbing' } });

  // Fresh actors so repeat runs stay independent.
  const stamp = Date.now().toString(36);
  const client = await prisma.user.create({
    data: { piUid: `e2e-client-${stamp}`, username: `e2e_client_${stamp}`, kycVerified: true },
  });
  const master = await prisma.user.create({
    data: { piUid: `e2e-master-${stamp}`, username: `e2e_master_${stamp}`, kycVerified: true, isMaster: true },
  });
  const clientT = token(client);
  const masterT = token(master);

  console.log('\n═══ 1. Order creation, validation and limits ═══');

  const base = {
    categorySlug: 'plumbing',
    title: 'E2E test job for the escrow path',
    description: 'A description long enough to satisfy the ten character minimum.',
    address: 'Warsaw, test street 1',
    lat: 52.23,
    lng: 21.01,
    isUrgent: false,
    photos: [] as string[],
  };

  const tooCheap = await call('POST', '/orders', { token: clientT, body: { ...base, budgetPi: '0.5' } });
  check('budget below min rejected', tooCheap.status === 400 && tooCheap.body?.error?.code === 'budget_too_low',
    `got ${tooCheap.status} ${tooCheap.body?.error?.code}`);

  const badBody = await call('POST', '/orders', { token: clientT, body: { ...base, budgetPi: '10', description: 'short' } });
  check('short description rejected by Zod', badBody.status === 400 && badBody.body?.error?.code === 'validation_error',
    `got ${badBody.status} ${badBody.body?.error?.code}`);

  const noAuth = await call('POST', '/orders', { body: { ...base, budgetPi: '10' } });
  check('unauthenticated create rejected', noAuth.status === 401, `got ${noAuth.status}`);

  const created = await call('POST', '/orders', { token: clientT, body: { ...base, budgetPi: '20' } });
  check('valid order created', created.status === 201 && !!created.body?.order?.id, `got ${created.status}`);
  const orderId = created.body?.order?.id as string;

  console.log('\n═══ 2. Escrow release on client confirmation ═══');

  const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });

  // Seed exactly what a verified ESCROW payment produces.
  const response = await prisma.response.create({
    data: {
      orderId,
      masterId: master.id,
      pricePi: '20',
      message: 'I can do this today.',
      status: ResponseStatus.SELECTED,
      connectPricePi: settings.connectPricePi,
    },
  });
  const funded = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.IN_PROGRESS,
      masterId: master.id,
      selectedResponseId: response.id,
      escrowStatus: EscrowStatus.FUNDED,
      escrowAmountPi: '20',
      clientFeePi: '2',
      expressFeePi: '0',
      totalPaidPi: '22',
      masterFeePi: '0',
      masterPayoutPi: '20',
      autoReleaseAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  check('escrow seeded as FUNDED', funded.escrowStatus === 'FUNDED');

  const wrongMaster = await call('POST', `/orders/${orderId}/complete`, { token: clientT });
  check('client cannot mark the job done', wrongMaster.status === 403, `got ${wrongMaster.status}`);

  const done = await call('POST', `/orders/${orderId}/complete`, { token: masterT });
  check('master marks job done', done.status === 200 && done.body?.order?.status === 'AWAITING_CONFIRMATION',
    `got ${done.status} ${done.body?.order?.status}`);

  const balBefore = (await prisma.user.findUniqueOrThrow({ where: { id: master.id } })).balancePi;
  const confirm = await call('POST', `/orders/${orderId}/confirm`, { token: clientT });
  check('client confirms', confirm.status === 200 && confirm.body?.released === true,
    `got ${confirm.status} released=${confirm.body?.released}`);

  const masterAfter = await prisma.user.findUniqueOrThrow({ where: { id: master.id } });
  check('master balance credited by masterPayoutPi',
    masterAfter.balancePi.minus(balBefore).equals(20),
    `delta ${masterAfter.balancePi.minus(balBefore).toString()}`);
  check('lifetime earnings updated', masterAfter.totalEarnedPi.equals(20),
    masterAfter.totalEarnedPi.toString());

  const confirmAgain = await call('POST', `/orders/${orderId}/confirm`, { token: clientT });
  check('double confirm is refused, not a double payout', confirmAgain.status === 409,
    `got ${confirmAgain.status}`);
  const masterAfter2 = await prisma.user.findUniqueOrThrow({ where: { id: master.id } });
  check('balance unchanged after the second confirm', masterAfter2.balancePi.equals(masterAfter.balancePi),
    masterAfter2.balancePi.toString());

  const profile = await prisma.masterProfile.findUnique({ where: { userId: master.id } });
  check('completedJobs incremented (no profile => skipped)', profile === null || profile.completedJobs === 1,
    String(profile?.completedJobs));

  console.log('\n═══ 3. Reviews and rating recomputation ═══');

  const r1 = await call('POST', '/reviews', { token: clientT, body: { orderId, rating: 5, text: 'Great work' } });
  check('client reviews master', r1.status === 201, `got ${r1.status}`);
  const r2 = await call('POST', '/reviews', { token: masterT, body: { orderId, rating: 4, text: 'Clear brief' } });
  check('master reviews client', r2.status === 201, `got ${r2.status}`);
  const r3 = await call('POST', '/reviews', { token: clientT, body: { orderId, rating: 1, text: 'again' } });
  check('second review by same author refused', r3.status === 409 && r3.body?.error?.code === 'already_reviewed',
    `got ${r3.status} ${r3.body?.error?.code}`);

  const masterRated = await prisma.user.findUniqueOrThrow({ where: { id: master.id } });
  check('master rating = 5.00 from one review', Number(masterRated.ratingAvg) === 5 && masterRated.ratingCount === 1,
    `${masterRated.ratingAvg} (${masterRated.ratingCount})`);
  const clientRated = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
  check('client rating = 4.00 from one review', Number(clientRated.ratingAvg) === 4 && clientRated.ratingCount === 1,
    `${clientRated.ratingAvg} (${clientRated.ratingCount})`);

  console.log('\n═══ 4. Escrow auto-release after the timeout ═══');

  const order2 = await prisma.order.create({
    data: {
      publicId: pid(), clientId: client.id, categoryId: category.id,
      title: 'Auto-release test job', description: 'Seeded straight into the funded state.',
      budgetPi: '15', address: 'Warsaw', lat: 52.24, lng: 21.02,
      status: OrderStatus.AWAITING_CONFIRMATION, masterId: master.id,
      escrowStatus: EscrowStatus.FUNDED, escrowAmountPi: '15', clientFeePi: '1.5',
      totalPaidPi: '16.5', masterPayoutPi: '15',
      autoReleaseAt: new Date(Date.now() - 3600_000), // already overdue
    },
  });

  const badCron = await fetch(`${API}/cron/auto-release`, { method: 'POST', headers: { 'X-Cron-Secret': 'wrong' } });
  check('cron rejects a wrong secret', badCron.status === 401, `got ${badCron.status}`);

  const cronRes = await fetch(`${API}/cron/auto-release`, { method: 'POST', headers: { 'X-Cron-Secret': CRON } });
  const cronBody: any = await cronRes.json();
  check('cron released the overdue escrow', cronRes.status === 200 && cronBody.released >= 1,
    `released=${cronBody.released}`);

  const order2After = await prisma.order.findUniqueOrThrow({ where: { id: order2.id } });
  check('order2 is COMPLETED / RELEASED',
    order2After.status === 'COMPLETED' && order2After.escrowStatus === 'RELEASED',
    `${order2After.status}/${order2After.escrowStatus}`);
  const masterAfter3 = await prisma.user.findUniqueOrThrow({ where: { id: master.id } });
  check('master credited another 15 Pi', masterAfter3.balancePi.equals(35), masterAfter3.balancePi.toString());

  console.log('\n═══ 5. Dispute freezes the timer, admin refunds ═══');

  const order3 = await prisma.order.create({
    data: {
      publicId: pid(), clientId: client.id, categoryId: category.id,
      title: 'Dispute test job', description: 'Seeded straight into the funded state.',
      budgetPi: '30', address: 'Warsaw', lat: 52.25, lng: 21.03,
      status: OrderStatus.IN_PROGRESS, masterId: master.id,
      escrowStatus: EscrowStatus.FUNDED, escrowAmountPi: '30', clientFeePi: '3',
      totalPaidPi: '33', masterPayoutPi: '30',
      autoReleaseAt: new Date(Date.now() - 3600_000),
    },
  });

  const dispute = await call('POST', `/orders/${order3.id}/dispute`, {
    token: clientT, body: { reason: 'The work was never actually started on site.' },
  });
  check('dispute opened', dispute.status === 200 && dispute.body?.order?.status === 'DISPUTED',
    `got ${dispute.status}`);
  const order3Disputed = await prisma.order.findUniqueOrThrow({ where: { id: order3.id } });
  check('autoReleaseAt cleared so the timer cannot fire', order3Disputed.autoReleaseAt === null);

  const cron2 = await fetch(`${API}/cron/auto-release`, { method: 'POST', headers: { 'X-Cron-Secret': CRON } });
  const cron2Body: any = await cron2.json();
  const order3StillHeld = await prisma.order.findUniqueOrThrow({ where: { id: order3.id } });
  check('cron did NOT touch the disputed escrow', order3StillHeld.escrowStatus === 'FUNDED',
    `${order3StillHeld.escrowStatus}, cron released ${cron2Body.released}`);

  const clientBalBefore = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balancePi;
  const resolve = await call('POST', `/admin/orders/${order3.id}/resolve`, {
    basic: ADMIN_BASIC, body: { action: 'refund_with_fees', note: 'e2e' },
  });
  check('admin refunds with fees', resolve.status === 200, `got ${resolve.status} ${JSON.stringify(resolve.body).slice(0,120)}`);
  const clientAfter = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
  check('client refunded the full 33 Pi', clientAfter.balancePi.minus(clientBalBefore).equals(33),
    clientAfter.balancePi.minus(clientBalBefore).toString());

  console.log('\n═══ 6. Withdrawals ═══');

  // The controller checks the wallet before the amount, so the no-wallet case
  // has to be asserted first — otherwise it masks the minimum-amount check.
  const noWallet = await call('POST', '/withdrawals', { token: masterT, body: { amountPi: '10' } });
  check('withdrawal without a wallet refused', noWallet.status === 400 && noWallet.body?.error?.code === 'no_wallet',
    `got ${noWallet.status} ${noWallet.body?.error?.code}`);

  await prisma.user.update({ where: { id: master.id }, data: { walletAddress: 'GTESTWALLETADDRESSFORE2ETESTINGXXXXXXXXXXXXXXXXXX' } });

  const tooSmall = await call('POST', '/withdrawals', { token: masterT, body: { amountPi: '1' } });
  check('withdrawal below minimum refused', tooSmall.status === 400 && tooSmall.body?.error?.code === 'amount_too_low',
    `got ${tooSmall.status} ${tooSmall.body?.error?.code}`);

  const overBalance = await call('POST', '/withdrawals', { token: masterT, body: { amountPi: '9999' } });
  check('withdrawal above balance refused', overBalance.status === 400 && overBalance.body?.error?.code === 'insufficient_balance',
    `got ${overBalance.status} ${overBalance.body?.error?.code}`);

  const wd = await call('POST', '/withdrawals', { token: masterT, body: { amountPi: '10' } });
  check('valid withdrawal requested', wd.status === 201, `got ${wd.status}`);
  const wd2 = await call('POST', '/withdrawals', { token: masterT, body: { amountPi: '5' } });
  check('second concurrent withdrawal refused', wd2.status === 409 && wd2.body?.error?.code === 'withdrawal_pending',
    `got ${wd2.status} ${wd2.body?.error?.code}`);

  console.log('\n═══ 7. GDPR account deletion ═══');

  const order4 = await prisma.order.create({
    data: {
      publicId: pid(), clientId: client.id, categoryId: category.id,
      title: 'Blocking active job', description: 'Active job that must block deletion.',
      budgetPi: '10', address: 'Warsaw', lat: 52.26, lng: 21.04,
      status: OrderStatus.IN_PROGRESS, masterId: master.id,
      escrowStatus: EscrowStatus.FUNDED, escrowAmountPi: '10', masterPayoutPi: '10', totalPaidPi: '11',
    },
  });
  const delBlocked = await call('DELETE', '/auth/account', { token: clientT });
  check('deletion blocked while a job is in progress',
    delBlocked.status === 400 && delBlocked.body?.error?.code === 'active_orders_exist',
    `got ${delBlocked.status} ${delBlocked.body?.error?.code}`);

  await prisma.order.update({ where: { id: order4.id }, data: { status: OrderStatus.CANCELLED, escrowStatus: EscrowStatus.REFUNDED } });
  const delOk = await call('DELETE', '/auth/account', { token: clientT });
  check('deletion allowed once nothing is active', delOk.status === 200, `got ${delOk.status} ${JSON.stringify(delOk.body).slice(0,120)}`);

  const deleted = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
  check('username anonymised', deleted.username.startsWith('deleted_user_'), deleted.username);
  check('wallet erased', deleted.walletAddress === null);
  check('isDeleted set', deleted.isDeleted === true);

  const survivingReview = await prisma.review.count({ where: { targetId: master.id, isHidden: false } });
  check('master rating survives the client deletion', survivingReview === 1, String(survivingReview));
  const survivingOrders = await prisma.order.count({ where: { clientId: client.id, status: 'COMPLETED' } });
  check('completed jobs stay in the statistics', survivingOrders >= 1, String(survivingOrders));

  console.log('\n═══ 8. Unanswered orders expire, funded ones never do ═══');

  const expirySettings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const past = daysAgo(expirySettings.orderExpiryDays + 5);

  // Three orders old enough to expire, differing only in what they hold.
  const staleOpen = await prisma.order.findFirst({ where: { status: 'OPEN', escrowStatus: 'NONE', masterId: null } });
  const fundedOne = await prisma.order.findFirst({ where: { escrowStatus: 'FUNDED' } });

  if (staleOpen) await prisma.order.update({ where: { id: staleOpen.id }, data: { createdAt: past } });
  if (fundedOne) await prisma.order.update({ where: { id: fundedOne.id }, data: { createdAt: past } });

  const closed = await expireStaleOrders(200);
  check('the sweep closed at least the stale open order', closed >= (staleOpen ? 1 : 0), `closed ${closed}`);

  if (staleOpen) {
    const after = await prisma.order.findUniqueOrThrow({ where: { id: staleOpen.id } });
    check('an unanswered order older than the window is closed',
      after.status === 'CANCELLED', after.status);
  }

  if (fundedOne) {
    const after = await prisma.order.findUniqueOrThrow({ where: { id: fundedOne.id } });
    check('AN ORDER HOLDING ESCROW IS NEVER TOUCHED — that is someone\'s money',
      after.escrowStatus === 'FUNDED' && after.status !== 'CANCELLED',
      `${after.status}/${after.escrowStatus}`);
  }

  // Zero must switch the whole thing off, not mean "expire everything today".
  await prisma.platformSettings.update({ where: { id: 1 }, data: { orderExpiryDays: 0 } });
  // Written straight to the table, so the 5-second cache the service keeps has
  // to be dropped by hand. The admin path does this through updateSettings().
  invalidateSettings();
  const freshOpen = await prisma.order.create({
    data: {
      publicId: `EXP${Date.now().toString(36).slice(-5).toUpperCase()}`,
      clientId: client.id, categoryId: (await prisma.category.findFirstOrThrow()).id,
      title: 'Should survive with expiry disabled', description: 'Zero days means never.',
      budgetPi: '10', address: 'Warsaw', lat: 52.23, lng: 21.01, createdAt: past,
    },
  });
  const closedWithZero = await expireStaleOrders(200);
  const survivor = await prisma.order.findUniqueOrThrow({ where: { id: freshOpen.id } });
  check('0 days disables expiry instead of expiring everything',
    closedWithZero === 0 && survivor.status === 'OPEN', `closed ${closedWithZero}, ${survivor.status}`);
  await prisma.platformSettings.update({
    where: { id: 1 }, data: { orderExpiryDays: expirySettings.orderExpiryDays },
  });
  invalidateSettings();

  console.log('\n═══ 8. Ledger integrity ═══');

  // Only balance-moving rows belong in this sum: wallet payments (connect,
  // escrow funding, boost, subscription) are history with affectsBalance=false.
  const drift: Array<{ username: string; balance: string; ledger: string }> = await prisma.$queryRaw`
    SELECT u.username, u."balancePi"::text AS balance, COALESCE(SUM(t."amountPi"), 0)::text AS ledger
    FROM users u LEFT JOIN transactions t ON t."userId" = u.id AND t."affectsBalance"
    GROUP BY u.id, u.username, u."balancePi"
    HAVING u."balancePi" <> COALESCE(SUM(t."amountPi"), 0)
  `;
  check('every balance equals the sum of its balance-moving transactions',
    drift.length === 0, JSON.stringify(drift).slice(0, 300));

  const walletRows: Array<{ n: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM transactions
    WHERE "affectsBalance" = false AND "type" NOT IN ('CONNECT_SPENT','ESCROW_FUNDED','BOOST','SUBSCRIPTION')
  `;
  check('only wallet-paid kinds are excluded from the audit sum',
    Number(walletRows[0]?.n ?? 0) === 0, String(walletRows[0]?.n));

  const stuck: Array<{ publicId: string }> = await prisma.$queryRaw`
    SELECT "publicId" FROM orders
    WHERE "escrowStatus" = 'FUNDED' AND "autoReleaseAt" IS NOT NULL AND "autoReleaseAt" < now()
  `;
  check('no overdue escrow left unsettled', stuck.length === 0, JSON.stringify(stuck).slice(0, 200));

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((error) => {
    console.error('RUN ERROR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
