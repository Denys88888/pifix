/**
 * The remaining money paths that no other suite reaches: two-level referral
 * bonuses, the BOOST and SUBSCRIPTION purchases, and — most importantly — what
 * happens to a user's balance when an on-chain payout fails.
 *
 * That last one is the scariest path in the app: the balance is debited before
 * the transfer is attempted, so a failure that did not restore it would
 * silently destroy someone's earnings.
 *
 * Needs the fake Pi API and a backend pointed at it. See TESTING.md.
 * Run with: npm run test:extras
 */
import { PrismaClient, EscrowStatus, OrderStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL ?? 'http://localhost:3010/api';
const FAKE = process.env.FAKE_PI_URL ?? 'http://localhost:4010';

/**
 * Payment.txid is unique in the database, so a literal reused across runs would
 * collide on the second one. Within a run the value is stable, which keeps the
 * "same payment completed twice" check honest.
 */
const RUN = Date.now().toString(36);

const ADMIN_BASIC = `${process.env.ADMIN_USERNAME ?? 'admin'}:${process.env.ADMIN_PASSWORD ?? ''}`;

if (!process.env.ADMIN_PASSWORD) {
  console.error('Missing env. Run: set -a && . ./.env && set +a && npm run test:extras');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against production.');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} — ${detail}`);
    console.log(`  ❌ ${name} — ${detail}`);
  }
}

async function api(method: string, path: string, opts: { token?: string; body?: unknown; basic?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.basic) headers.Authorization = `Basic ${Buffer.from(opts.basic).toString('base64')}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const control = (path: string, body: unknown) =>
  fetch(`${FAKE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

let counter = 0;
const nextId = () => `bon_${Date.now().toString(36)}_${counter++}`;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const publicId = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

async function craftPayment(input: { uid: string; amount: number; metadata: Record<string, unknown> }) {
  const identifier = nextId();
  await control('/_control/payment', {
    identifier,
    user_uid: input.uid,
    amount: input.amount,
    memo: 'test',
    metadata: input.metadata,
    transaction_verified: true,
  });
  return identifier;
}

/** Registers a pioneer through the real login endpoint. */
async function register(tag: string, stamp: string, referrer?: string) {
  const accessToken = `tok_${tag}_${stamp}`;
  const uid = `uid_${tag}_${stamp}`;
  const username = `b${tag}_${stamp}`;
  await control('/_control/user', { accessToken, uid, username, kyc_status: 'verified' });
  const res = await api('POST', '/auth/pi', { body: { accessToken, referrer } });
  if (res.status !== 200) throw new Error(`register ${tag} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { uid, username, jwt: res.body.token as string, id: res.body.user.id as string };
}

async function main() {
  const stamp = Date.now().toString(36);
  const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
  const direct = settings.referralBonusDirectPi;
  const indirect = settings.referralBonusIndirectPi;

  console.log('\n═══ 1. Two-level referral bonuses ═══');

  const alice = await register('alice', stamp);                       // level 2
  const bob = await register('bob', stamp, alice.username);           // level 1, invited by alice
  const carol = await register('carol', stamp, bob.username);         // invited by bob
  const client = await register('client', stamp);

  const carolRow = await prisma.user.findUniqueOrThrow({ where: { id: carol.id } });
  check('referrer recorded on registration', carolRow.referrerId === bob.id,
    `${carolRow.referrerId} vs ${bob.id}`);

  const selfRef = await register('selfref', stamp, `bselfref_${stamp}`);
  const selfRow = await prisma.user.findUniqueOrThrow({ where: { id: selfRef.id } });
  check('self-referral ignored', selfRow.referrerId === null, String(selfRow.referrerId));

  const unknownRef = await register('unknown', stamp, 'definitely_not_a_real_user_xyz');
  const unknownRow = await prisma.user.findUniqueOrThrow({ where: { id: unknownRef.id } });
  check('unknown referrer ignored', unknownRow.referrerId === null, String(unknownRow.referrerId));

  const bobBefore = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).balancePi;
  const aliceBefore = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balancePi;

  // Carol completes her first job as the master.
  const category = await prisma.category.findFirstOrThrow({ where: { slug: 'plumbing' } });
  const order1 = await prisma.order.create({
    data: {
      publicId: publicId(), clientId: client.id, categoryId: category.id,
      title: 'Carol first job', description: 'Triggers the referral bonus chain.',
      budgetPi: '20', address: 'Warsaw', lat: 52.23, lng: 21.01,
      status: OrderStatus.AWAITING_CONFIRMATION, masterId: carol.id,
      escrowStatus: EscrowStatus.FUNDED, escrowAmountPi: '20',
      masterPayoutPi: '20', totalPaidPi: '22', clientFeePi: '2',
      autoReleaseAt: new Date(Date.now() + 86400_000),
    },
  });
  const confirm1 = await api('POST', `/orders/${order1.id}/confirm`, { token: client.jwt });
  check('first deal settled', confirm1.status === 200, `got ${confirm1.status}`);

  // Bonuses are paid outside the settlement transaction; give them a moment.
  await new Promise((r) => setTimeout(r, 1500));

  const bobAfter = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).balancePi;
  const aliceAfter = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balancePi;

  check(`level-1 referrer credited ${direct} Pi`, bobAfter.minus(bobBefore).equals(direct),
    bobAfter.minus(bobBefore).toString());
  check(`level-2 referrer credited ${indirect} Pi`, aliceAfter.minus(aliceBefore).equals(indirect),
    aliceAfter.minus(aliceBefore).toString());

  const carolFlag = await prisma.user.findUniqueOrThrow({ where: { id: carol.id } });
  check('referralBonusPaid flag set', carolFlag.referralBonusPaid === true);

  const bonusRows = await prisma.transaction.count({
    where: { userId: bob.id, type: 'REFERRAL_BONUS' },
  });
  check('bonus written to the ledger', bonusRows === 1, String(bonusRows));

  // Second completed deal must NOT pay again.
  const order2 = await prisma.order.create({
    data: {
      publicId: publicId(), clientId: client.id, categoryId: category.id,
      title: 'Carol second job', description: 'Must not pay the referral bonus twice.',
      budgetPi: '10', address: 'Warsaw', lat: 52.23, lng: 21.01,
      status: OrderStatus.AWAITING_CONFIRMATION, masterId: carol.id,
      escrowStatus: EscrowStatus.FUNDED, escrowAmountPi: '10',
      masterPayoutPi: '10', totalPaidPi: '11', clientFeePi: '1',
      autoReleaseAt: new Date(Date.now() + 86400_000),
    },
  });
  await api('POST', `/orders/${order2.id}/confirm`, { token: client.jwt });
  await new Promise((r) => setTimeout(r, 1500));

  const bobFinal = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).balancePi;
  check('bonus paid only once, not on every deal', bobFinal.equals(bobAfter),
    `${bobFinal.toString()} vs ${bobAfter.toString()}`);

  console.log('\n═══ 2. Profile boost and PRO subscription ═══');

  // Carol needs a master profile to buy either.
  await api('PUT', '/masters/me/profile', {
    token: carol.jwt,
    body: {
      displayName: 'Carol', bio: 'Master profile for the boost and subscription tests.',
      radiusKm: 20, categories: ['plumbing'], portfolio: [], certificates: [],
    },
  });

  const boostPrice = Number(settings.profileBoostPricePi);
  const wrongBoost = await craftPayment({ uid: carol.uid, amount: boostPrice / 2, metadata: { purpose: 'BOOST' } });
  const wrongBoostRes = await api('POST', '/payments/approve', { token: carol.jwt, body: { paymentId: wrongBoost } });
  check('underpaid boost refused',
    wrongBoostRes.status === 400 && wrongBoostRes.body?.error?.code === 'amount_mismatch',
    `got ${wrongBoostRes.status} ${wrongBoostRes.body?.error?.code}`);

  const boost = await craftPayment({ uid: carol.uid, amount: boostPrice, metadata: { purpose: 'BOOST' } });
  await api('POST', '/payments/approve', { token: carol.jwt, body: { paymentId: boost } });
  const boostDone = await api('POST', '/payments/complete', { token: carol.jwt, body: { paymentId: boost, txid: `tx_boost_${RUN}` } });
  check('boost purchase completes', boostDone.status === 200, `got ${boostDone.status}`);

  const boosted = await prisma.masterProfile.findUniqueOrThrow({ where: { userId: carol.id } });
  const boostDays = boosted.boostedUntil
    ? (boosted.boostedUntil.getTime() - Date.now()) / 86400_000
    : 0;
  check('boost lasts ~7 days', boostDays > 6.9 && boostDays < 7.1, boostDays.toFixed(2));

  const subPrice = Number(settings.proSubscriptionPricePi);
  const sub = await craftPayment({ uid: carol.uid, amount: subPrice, metadata: { purpose: 'SUBSCRIPTION' } });
  await api('POST', '/payments/approve', { token: carol.jwt, body: { paymentId: sub } });
  const subDone = await api('POST', '/payments/complete', { token: carol.jwt, body: { paymentId: sub, txid: `tx_sub_${RUN}` } });
  check('subscription completes', subDone.status === 200, `got ${subDone.status}`);

  const subbed = await prisma.masterProfile.findUniqueOrThrow({ where: { userId: carol.id } });
  const subDays = subbed.proUntil ? (subbed.proUntil.getTime() - Date.now()) / 86400_000 : 0;
  check('subscription lasts ~30 days', subDays > 29.9 && subDays < 30.1, subDays.toFixed(2));

  // Renewing before expiry must extend, not reset.
  const sub2 = await craftPayment({ uid: carol.uid, amount: subPrice, metadata: { purpose: 'SUBSCRIPTION' } });
  await api('POST', '/payments/approve', { token: carol.jwt, body: { paymentId: sub2 } });
  await api('POST', '/payments/complete', { token: carol.jwt, body: { paymentId: sub2, txid: `tx_sub2_${RUN}` } });
  const subbed2 = await prisma.masterProfile.findUniqueOrThrow({ where: { userId: carol.id } });
  const subDays2 = subbed2.proUntil ? (subbed2.proUntil.getTime() - Date.now()) / 86400_000 : 0;
  check('early renewal extends instead of resetting', subDays2 > 59.9 && subDays2 < 60.1, subDays2.toFixed(2));

  console.log('\n═══ 3. Failed payout must not eat the balance ═══');

  // Precondition, asserted rather than assumed: with payouts disabled the
  // controller refuses before it debits, so the rollback is never exercised and
  // every assertion below would pass for the wrong reason.
  const dash = await fetch(`${API}/admin/dashboard`, {
    headers: { Authorization: `Basic ${Buffer.from(ADMIN_BASIC).toString('base64')}` },
  }).then((r) => r.json() as Promise<{ system?: { payoutsConfigured?: boolean } }>);
  check('payouts are enabled, so the rollback path is actually reachable',
    dash.system?.payoutsConfigured === true,
    'start the backend with PAYOUTS_ENABLED=true and an unsignable PI_WALLET_PRIVATE_SEED');
  if (dash.system?.payoutsConfigured !== true) {
    console.log('\n  ⚠️  Skipping the rollback assertions — they would pass vacuously.');
    console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
    return;
  }

  const balBefore = (await prisma.user.findUniqueOrThrow({ where: { id: carol.id } })).balancePi;
  check('carol has a balance to withdraw', balBefore.greaterThan(5), balBefore.toString());

  await prisma.user.update({
    where: { id: carol.id },
    data: { walletAddress: 'GBOGUSWALLETADDRESSTHATWILLNEVERRESOLVEXXXXXXXXXX' },
  });

  const request = await api('POST', '/withdrawals', { token: carol.jwt, body: { amountPi: '5' } });
  check('withdrawal requested', request.status === 201, `got ${request.status} ${JSON.stringify(request.body).slice(0,120)}`);
  const withdrawalId = request.body?.withdrawal?.id as string;

  const payAttempt = await api('POST', `/admin/withdrawals/${withdrawalId}/pay`, { basic: ADMIN_BASIC });
  check('payout attempt fails loudly, not silently',
    payAttempt.status === 400,
    `got ${payAttempt.status} ${JSON.stringify(payAttempt.body).slice(0, 140)}`);

  const balAfter = (await prisma.user.findUniqueOrThrow({ where: { id: carol.id } })).balancePi;
  check('BALANCE FULLY RESTORED after the failed payout', balAfter.equals(balBefore),
    `before ${balBefore.toString()} after ${balAfter.toString()}`);

  const wdRow = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
  check('request reopened for a retry', wdRow?.status === 'REQUESTED', wdRow?.status);
  check('failure reason recorded for the admin', !!wdRow?.adminNote, String(wdRow?.adminNote).slice(0, 80));

  const drift: Array<{ username: string }> = await prisma.$queryRaw`
    SELECT u.username FROM users u
    LEFT JOIN transactions t ON t."userId" = u.id AND t."affectsBalance"
    GROUP BY u.id, u.username, u."balancePi"
    HAVING u."balancePi" <> COALESCE(SUM(t."amountPi"), 0)
  `;
  check('ledger still balances after the failed payout', drift.length === 0, JSON.stringify(drift).slice(0, 200));

  // The boost and subscription Carol bought must be recorded but excluded.
  const walletPaid = await prisma.transaction.count({
    where: { userId: carol.id, affectsBalance: false },
  });
  check('wallet-paid purchases recorded as history, outside the balance',
    walletPaid >= 3, `${walletPaid} rows`);

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
