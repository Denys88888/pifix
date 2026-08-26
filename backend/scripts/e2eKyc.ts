/**
 * The KYC gate on payouts.
 *
 * Two gates guard the same rule: the withdrawal form refuses early so the
 * answer arrives before the balance moves, and sendPayout refuses again
 * because every path that moves Pi out of the app goes through it. This suite
 * checks both, and specifically that the second one still holds when the first
 * is bypassed — that is the one that actually protects the money.
 *
 * Needs the fake Pi API and a backend started with REQUIRE_KYC=true.
 * Run with: npm run test:kyc
 */
import { PrismaClient, TransactionType, WithdrawalStatus } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL ?? 'http://localhost:3010/api';
const FAKE = process.env.FAKE_PI_URL ?? 'http://localhost:4010';
const ADMIN_BASIC = `${process.env.ADMIN_USERNAME ?? 'admin'}:${process.env.ADMIN_PASSWORD ?? ''}`;

if (!process.env.ADMIN_PASSWORD) {
  console.error('Missing env. Run: set -a && . ./.env && set +a && npm run test:kyc');
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
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function register(tag: string, stamp: string) {
  const accessToken = `tok_${tag}_${stamp}`;
  const uid = `uid_${tag}_${stamp}`;
  const username = `k${tag}_${stamp}`;
  await fetch(`${FAKE}/_control/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, uid, username, kyc_status: 'verified' }),
  });
  const res = await api('POST', '/auth/pi', { body: { accessToken } });
  if (res.status !== 200) throw new Error(`register ${tag}: ${res.status} ${JSON.stringify(res.body)}`);
  return { uid, username, jwt: res.body.token as string, id: res.body.user.id as string };
}

/** Credits a balance the same way the ledger does, so the audit sum stays true. */
async function credit(userId: string, amount: string) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { balancePi: { increment: amount } },
    });
    await tx.transaction.create({
      data: {
        userId,
        type: TransactionType.JOB_EARNING,
        amountPi: amount,
        balanceAfter: user.balancePi,
        description: 'kyc suite fixture',
        affectsBalance: true,
      },
    });
  });
}

const setKyc = (id: string, kycVerified: boolean) =>
  prisma.user.update({ where: { id }, data: { kycVerified } });

async function main() {
  const stamp = Date.now().toString(36);

  // Asserted rather than assumed: with the gate off every check below would
  // pass for the wrong reason.
  const dash = await api('GET', '/admin/dashboard', { basic: ADMIN_BASIC });
  const requireKyc = dash.body?.system?.requireKyc === true;
  check('the KYC gate is switched on, so it is actually being tested', requireKyc,
    'start the backend with REQUIRE_KYC=true');
  if (!requireKyc) {
    console.log('\n  ⚠️  Skipping — the assertions would pass vacuously.');
    console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
    process.exitCode = 1;
    return;
  }

  const master = await register('master', stamp);
  await credit(master.id, '20');
  await prisma.user.update({
    where: { id: master.id },
    data: { walletAddress: 'GBOGUSWALLETADDRESSTHATWILLNEVERRESOLVEXXXXXXXXXX' },
  });

  console.log('\n═══ 1. The form refuses before the balance moves ═══');

  await setKyc(master.id, false);
  const balBefore = (await prisma.user.findUniqueOrThrow({ where: { id: master.id } })).balancePi;

  const refused = await api('POST', '/withdrawals', { token: master.jwt, body: { amountPi: '5' } });
  check('withdrawal refused without KYC', refused.status === 400,
    `got ${refused.status} ${JSON.stringify(refused.body).slice(0, 120)}`);
  check('refusal names the reason, so the app can explain it',
    refused.body?.error?.code === 'kyc_required', JSON.stringify(refused.body?.error).slice(0, 120));

  const balStill = (await prisma.user.findUniqueOrThrow({ where: { id: master.id } })).balancePi;
  check('balance untouched by the refusal', balStill.equals(balBefore),
    `${balBefore.toString()} → ${balStill.toString()}`);

  const noRequest = await prisma.withdrawalRequest.count({ where: { userId: master.id } });
  check('no withdrawal row was created', noRequest === 0, `${noRequest} rows`);

  console.log('\n═══ 2. A verified master gets through ═══');

  await setKyc(master.id, true);
  const accepted = await api('POST', '/withdrawals', { token: master.jwt, body: { amountPi: '5' } });
  check('withdrawal accepted once KYC is on record', accepted.status === 201,
    `got ${accepted.status} ${JSON.stringify(accepted.body).slice(0, 120)}`);
  const withdrawalId = accepted.body?.withdrawal?.id as string;

  console.log('\n═══ 3. The payout refuses too, not only the form ═══');

  // Status revoked after the request was already accepted: the form gate is
  // behind us, so only the gate inside sendPayout can still stop this.
  await setKyc(master.id, false);
  const debited = (await prisma.user.findUniqueOrThrow({ where: { id: master.id } })).balancePi;

  const payAttempt = await api('POST', `/admin/withdrawals/${withdrawalId}/pay`, { basic: ADMIN_BASIC });
  check('payout refused at the money gate', payAttempt.status === 400,
    `got ${payAttempt.status} ${JSON.stringify(payAttempt.body).slice(0, 140)}`);

  const balAfter = (await prisma.user.findUniqueOrThrow({ where: { id: master.id } })).balancePi;
  check('balance restored after the refused payout', balAfter.equals(debited),
    `${debited.toString()} → ${balAfter.toString()}`);

  const row = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
  check('request reopened rather than lost', row?.status === WithdrawalStatus.REQUESTED, String(row?.status));
  check('reason recorded for the admin', !!row?.adminNote, String(row?.adminNote).slice(0, 80));

  const drift: Array<{ username: string }> = await prisma.$queryRaw`
    SELECT u.username FROM users u
    LEFT JOIN transactions t ON t."userId" = u.id AND t."affectsBalance"
    GROUP BY u.id, u.username, u."balancePi"
    HAVING u."balancePi" <> COALESCE(SUM(t."amountPi"), 0)
  `;
  check('ledger still balances', drift.length === 0, JSON.stringify(drift).slice(0, 200));

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('RUN ERROR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
