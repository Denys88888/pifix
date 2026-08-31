/**
 * Adversarial tests for server-side payment verification.
 *
 * Runs the real backend against scripts/fakePiApi.ts, so every request goes
 * through the genuine approve → chain → complete → grant pipeline. The point is
 * not the happy path: it is that a client which lies about the amount, the
 * metadata or the owner of a payment gets nothing.
 *
 * Requires the backend running with PI_API_BASE_URL pointed at the fake.
 * Run with: npm run test:payments
 */
import { PrismaClient } from '@prisma/client';

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
  console.error('Missing env. Run: set -a && . ./.env && set +a && npm run test:payments');
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

interface FakeStatus {
  developer_approved: boolean;
  transaction_verified: boolean;
  developer_completed: boolean;
  cancelled: boolean;
  user_cancelled: boolean;
}

const fakeState = (id: string): Promise<{ status: FakeStatus }> =>
  fetch(`${FAKE}/_control/payment/${id}`).then((r) => r.json() as Promise<{ status: FakeStatus }>);

const control = (path: string, body: unknown) =>
  fetch(`${FAKE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

let counter = 0;
const nextId = () => `pay_${Date.now().toString(36)}_${counter++}`;

/** Puts a payment into the fake Pi API exactly as the SDK would have. */
async function craftPayment(input: {
  uid: string;
  amount: number;
  metadata: Record<string, unknown>;
  cancelled?: boolean;
  transaction_verified?: boolean;
  direction?: 'user_to_app' | 'app_to_user';
  /** Set to model a payment whose Pi already reached the chain. */
  txid?: string;
}) {
  const identifier = nextId();
  await control('/_control/payment', {
    identifier,
    user_uid: input.uid,
    amount: input.amount,
    memo: 'test',
    metadata: input.metadata,
    cancelled: input.cancelled ?? false,
    transaction_verified: input.transaction_verified ?? true,
    direction: input.direction ?? 'user_to_app',
    txid: input.txid,
  });
  return identifier;
}

async function main() {
  await fetch(`${FAKE}/_control/reset`, { method: 'POST' });

  const stamp = Date.now().toString(36);
  const clientTok = `tok_client_${stamp}`;
  const masterTok = `tok_master_${stamp}`;
  const strangerTok = `tok_stranger_${stamp}`;
  const clientUid = `uid_client_${stamp}`;
  const masterUid = `uid_master_${stamp}`;
  const strangerUid = `uid_stranger_${stamp}`;

  await control('/_control/user', { accessToken: clientTok, uid: clientUid, username: `pc_${stamp}`, kyc_status: 'verified' });
  await control('/_control/user', { accessToken: masterTok, uid: masterUid, username: `pm_${stamp}`, kyc_status: 'verified' });
  await control('/_control/user', { accessToken: strangerTok, uid: strangerUid, username: `ps_${stamp}`, kyc_status: 'verified' });

  console.log('\n═══ 1. Real authentication through the Pi API ═══');

  const badLogin = await api('POST', '/auth/pi', { body: { accessToken: 'not-a-real-token' } });
  check('login with an unknown access token refused', badLogin.status === 401, `got ${badLogin.status}`);

  const cl = await api('POST', '/auth/pi', { body: { accessToken: clientTok } });
  check('client authenticates', cl.status === 200 && !!cl.body?.token, `got ${cl.status}`);
  const ml = await api('POST', '/auth/pi', { body: { accessToken: masterTok } });
  check('master authenticates', ml.status === 200, `got ${ml.status}`);
  const sl = await api('POST', '/auth/pi', { body: { accessToken: strangerTok } });
  check('third party authenticates', sl.status === 200, `got ${sl.status}`);

  const clientJwt = cl.body.token as string;
  const masterJwt = ml.body.token as string;
  check('kyc_status from Pi is stored', cl.body?.user?.kycVerified === true, String(cl.body?.user?.kycVerified));

  // Master needs a verified profile before responding.
  const prof = await api('PUT', '/masters/me/profile', {
    token: masterJwt,
    body: {
      displayName: 'Payment Test Master',
      bio: 'A master profile created for the payment verification suite.',
      radiusKm: 30,
      categories: ['plumbing'],
      portfolio: [],
      certificates: [],
    },
  });
  check('master profile created', prof.status === 201 || prof.status === 200, `got ${prof.status}`);
  const profileId = prof.body?.profile?.id as string;
  const verified = await api('POST', `/admin/masters/${profileId}/verify`, {
    basic: ADMIN_BASIC,
    body: { decision: 'approve' },
  });
  check('admin verifies the master', verified.status === 200, `got ${verified.status}`);

  const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
  const connectPrice = Number(settings.connectPricePi);

  const order = await api('POST', '/orders', {
    token: clientJwt,
    body: {
      categorySlug: 'plumbing', title: 'Payment verification test job',
      description: 'Used by the adversarial payment suite.',
      budgetPi: '40', address: 'Warsaw', lat: 52.23, lng: 21.01, isUrgent: false, photos: [],
    },
  });
  check('order published', order.status === 201, `got ${order.status}`);
  const orderId = order.body?.order?.id as string;

  console.log('\n═══ 2. CONNECT — the adversarial cases ═══');

  // Underpaying the connect fee.
  const cheap = await craftPayment({
    uid: masterUid, amount: 0.01,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '40', message: 'hi' },
  });
  const cheapRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: cheap } });
  check('underpaid connect refused at approval',
    cheapRes.status === 400 && cheapRes.body?.error?.code === 'amount_mismatch',
    `got ${cheapRes.status} ${cheapRes.body?.error?.code}`);
  const cheapState = await fakeState(cheap);
  check('underpaid connect was never approved on the Pi API',
    cheapState.status.developer_approved === false, JSON.stringify(cheapState.status));

  // Paying for someone else's payment.
  const foreign = await craftPayment({
    uid: strangerUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '40', message: 'hi' },
  });
  const foreignRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: foreign } });
  check("cannot approve another user's payment",
    foreignRes.status === 403 && foreignRes.body?.error?.code === 'payment_owner_mismatch',
    `got ${foreignRes.status} ${foreignRes.body?.error?.code}`);

  // A client with no master profile is stopped before the own-order rule is
  // even reached — the refusal is correct, just for a different reason.
  const noProfile = await craftPayment({
    uid: clientUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '40', message: 'hi' },
  });
  const noProfileRes = await api('POST', '/payments/approve', { token: clientJwt, body: { paymentId: noProfile } });
  check('connect without a master profile refused',
    noProfileRes.status === 400 && noProfileRes.body?.error?.code === 'no_master_profile',
    `got ${noProfileRes.status} ${noProfileRes.body?.error?.code}`);

  // To isolate the own-order rule the actor must be a verified master who owns
  // the order, so the earlier profile and verification checks all pass.
  const ownJob = await api('POST', '/orders', {
    token: masterJwt,
    body: {
      categorySlug: 'plumbing', title: 'Job published by the master themselves',
      description: 'Used to isolate the own-order rule from the profile checks.',
      budgetPi: '25', address: 'Warsaw', lat: 52.23, lng: 21.01, isUrgent: false, photos: [],
    },
  });
  check('master can publish an order as a client', ownJob.status === 201, `got ${ownJob.status}`);
  const ownJobId = ownJob.body?.order?.id as string;

  const ownOrder = await craftPayment({
    uid: masterUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId: ownJobId, pricePi: '25', message: 'hi' },
  });
  const ownRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: ownOrder } });
  check('a verified master cannot respond to their own order',
    ownRes.status === 400 && ownRes.body?.error?.code === 'own_order',
    `got ${ownRes.status} ${ownRes.body?.error?.code}`);

  // Garbage metadata.
  const junk = await craftPayment({ uid: masterUid, amount: connectPrice, metadata: { purpose: 'NONSENSE' } });
  const junkRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: junk } });
  check('malformed metadata refused',
    junkRes.status === 400 && junkRes.body?.error?.code === 'invalid_payment_metadata',
    `got ${junkRes.status} ${junkRes.body?.error?.code}`);

  // A payment the user already cancelled.
  const cancelled = await craftPayment({
    uid: masterUid, amount: connectPrice, cancelled: true,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '40', message: 'hi' },
  });
  const cancelledRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: cancelled } });
  check('cancelled payment refused',
    cancelledRes.status === 409 && cancelledRes.body?.error?.code === 'payment_cancelled',
    `got ${cancelledRes.status} ${cancelledRes.body?.error?.code}`);

  const responsesSoFar = await prisma.response.count({ where: { orderId } });
  check('no response was created by any rejected payment', responsesSoFar === 0, String(responsesSoFar));

  console.log('\n═══ 3. CONNECT — the honest path ═══');

  const good = await craftPayment({
    uid: masterUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '38.5', message: 'I can start tomorrow.' },
  });
  const goodApprove = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: good } });
  check('honest connect approved', goodApprove.status === 200, `got ${goodApprove.status} ${JSON.stringify(goodApprove.body).slice(0,120)}`);

  const stillNoResponse = await prisma.response.count({ where: { orderId } });
  check('approval alone grants nothing', stillNoResponse === 0, String(stillNoResponse));

  const goodComplete = await api('POST', '/payments/complete', {
    token: masterJwt, body: { paymentId: good, txid: `tx_connect_ok_${RUN}` },
  });
  check('completion grants the response', goodComplete.status === 200, `got ${goodComplete.status}`);
  const responseRow = await prisma.response.findFirst({ where: { orderId, masterId: { not: undefined } } });
  check('response row exists with the offered price',
    !!responseRow && responseRow.pricePi.equals(38.5), responseRow?.pricePi?.toString());
  check('connect fee recorded on the response',
    !!responseRow && responseRow.connectPricePi.equals(connectPrice), responseRow?.connectPricePi?.toString());

  // Replay the same completion.
  const replay = await api('POST', '/payments/complete', {
    token: masterJwt, body: { paymentId: good, txid: `tx_connect_ok_${RUN}` },
  });
  check('replaying a completed payment is idempotent',
    replay.status === 200 && replay.body?.alreadyProcessed === true, JSON.stringify(replay.body).slice(0, 120));
  const responseCount = await prisma.response.count({ where: { orderId } });
  check('replay did not create a second response', responseCount === 1, String(responseCount));

  // Same master responding twice.
  const dupe = await craftPayment({
    uid: masterUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '38.5', message: 'again' },
  });
  const dupeRes = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: dupe } });
  check('second response from the same master refused',
    dupeRes.status === 409 && dupeRes.body?.error?.code === 'already_responded',
    `got ${dupeRes.status} ${dupeRes.body?.error?.code}`);

  console.log('\n═══ 4. ESCROW — amount is recomputed server-side ═══');

  const quote = await api('GET', `/orders/${orderId}/quote?responseId=${responseRow!.id}`, { token: clientJwt });
  check('quote returned', quote.status === 200, `got ${quote.status}`);
  const total = Number(quote.body?.totalPi);
  check('quote = price + fee (38.5 + 10%)', Math.abs(total - 42.35) < 1e-9, String(total));

  // Pay the budget but skip the commission.
  const shortPay = await craftPayment({
    uid: clientUid, amount: 38.5,
    metadata: { purpose: 'ESCROW', orderId, responseId: responseRow!.id },
  });
  const shortRes = await api('POST', '/payments/approve', { token: clientJwt, body: { paymentId: shortPay } });
  check('escrow without the commission refused',
    shortRes.status === 400 && shortRes.body?.error?.code === 'amount_mismatch',
    `got ${shortRes.status} ${shortRes.body?.error?.code}`);
  const orderStillOpen = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  check('order stays OPEN after the refused escrow',
    orderStillOpen.status === 'OPEN' && orderStillOpen.escrowStatus === 'NONE',
    `${orderStillOpen.status}/${orderStillOpen.escrowStatus}`);

  // Correct amount, but completed while the chain never verified it.
  const unverified = await craftPayment({
    uid: clientUid, amount: total, transaction_verified: false,
    metadata: { purpose: 'ESCROW', orderId, responseId: responseRow!.id },
  });
  await api('POST', '/payments/approve', { token: clientJwt, body: { paymentId: unverified } });
  const unverifiedRes = await api('POST', '/payments/complete', {
    token: clientJwt, body: { paymentId: unverified, txid: `tx_not_verified_${RUN}` },
  });
  check('completion refused while the transaction is unverified',
    unverifiedRes.status === 400 && unverifiedRes.body?.error?.code === 'payment_not_verified',
    `got ${unverifiedRes.status} ${unverifiedRes.body?.error?.code}`);
  const stillOpen2 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  check('order still OPEN after the unverified completion', stillOpen2.escrowStatus === 'NONE', stillOpen2.escrowStatus);

  // The honest escrow.
  const escrow = await craftPayment({
    uid: clientUid, amount: total,
    metadata: { purpose: 'ESCROW', orderId, responseId: responseRow!.id },
  });
  const escApprove = await api('POST', '/payments/approve', { token: clientJwt, body: { paymentId: escrow } });
  check('honest escrow approved', escApprove.status === 200, `got ${escApprove.status}`);
  const escComplete = await api('POST', '/payments/complete', {
    token: clientJwt, body: { paymentId: escrow, txid: `tx_escrow_ok_${RUN}` },
  });
  check('escrow completion funds the order', escComplete.status === 200, `got ${escComplete.status} ${JSON.stringify(escComplete.body).slice(0,140)}`);

  const funded = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  check('order IN_PROGRESS / FUNDED',
    funded.status === 'IN_PROGRESS' && funded.escrowStatus === 'FUNDED',
    `${funded.status}/${funded.escrowStatus}`);
  check('escrow holds the master price exactly', funded.escrowAmountPi.equals(38.5), funded.escrowAmountPi.toString());
  check('commission booked exactly (3.85)', funded.clientFeePi.equals(3.85), funded.clientFeePi.toString());
  check('total paid recorded exactly (42.35)', funded.totalPaidPi.equals(42.35), funded.totalPaidPi.toString());
  check('master payout equals the budget (masterFeePercent = 0)',
    funded.masterPayoutPi.equals(38.5), funded.masterPayoutPi.toString());
  check('auto-release deadline set', funded.autoReleaseAt !== null);

  const rejected = await prisma.response.count({ where: { orderId, status: 'REJECTED' } });
  const selected = await prisma.response.count({ where: { orderId, status: 'SELECTED' } });
  check('chosen response marked SELECTED', selected === 1, String(selected));
  check('losing responses marked REJECTED', rejected === 0, String(rejected));

  // Escrow on an order that is no longer open.
  const late = await craftPayment({
    uid: clientUid, amount: total,
    metadata: { purpose: 'ESCROW', orderId, responseId: responseRow!.id },
  });
  const lateRes = await api('POST', '/payments/approve', { token: clientJwt, body: { paymentId: late } });
  check('second escrow on the same order refused',
    lateRes.status === 409 && lateRes.body?.error?.code === 'order_not_open',
    `got ${lateRes.status} ${lateRes.body?.error?.code}`);

  console.log('\n═══ 5. Incomplete payment recovery ═══');

  const dangling = await craftPayment({
    uid: masterUid, amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId, pricePi: '10', message: 'dangling' },
  });
  const incomplete = await api('POST', '/payments/cancel-incomplete', {
    token: masterJwt, body: { payment: { identifier: dangling } },
  });
  check('incomplete payment handled', incomplete.status === 200, `got ${incomplete.status}`);
  const danglingState = await fakeState(dangling);
  check('dangling payment cancelled on the Pi API', danglingState.status.cancelled === true,
    JSON.stringify(danglingState.status));

  const payRow = await prisma.payment.findUnique({ where: { piPaymentId: dangling } });
  check('cancellation recorded locally', payRow?.status === 'CANCELLED', payRow?.status);

  /*
   * The branch that protects the user's money, and the one the suite was
   * missing: the Pi already left their wallet and reached the chain, but the
   * app never completed the payment. Cancelling here would take the money and
   * deliver nothing — it must be finished instead, and the purchase granted.
   */
  const recoverJob = await api('POST', '/orders', {
    token: clientJwt,
    body: {
      categorySlug: 'plumbing', title: 'Job for the incomplete-payment recovery',
      description: 'The master paid to respond but the app never completed it.',
      budgetPi: '30', address: 'Warsaw', lat: 52.23, lng: 21.01, isUrgent: false, photos: [],
    },
  });
  const recoverJobId = recoverJob.body?.order?.id as string;
  check('order for the recovery case published', recoverJob.status === 201, `got ${recoverJob.status}`);

  /*
   * The sequence that actually produces one of these: the app approved the
   * payment (which is what writes the local row), the user signed, the chain
   * confirmed it — and only then did the app fail to call complete. A crafted
   * payment with a txid but no local row is not reachable in production,
   * because Pi will not let the user sign before the developer has approved,
   * and approving is what creates the row.
   */
  const paidTxid = `tx_recovered_${RUN}`;
  const onChain = await craftPayment({
    uid: masterUid,
    amount: connectPrice,
    metadata: { purpose: 'CONNECT', orderId: recoverJobId, pricePi: '10', message: 'paid but never completed' },
  });

  const approvedIt = await api('POST', '/payments/approve', { token: masterJwt, body: { paymentId: onChain } });
  check('the app approved it, which is what records it locally',
    approvedIt.status === 200, `got ${approvedIt.status} ${JSON.stringify(approvedIt.body).slice(0, 120)}`);

  // The chain confirms while the app is not looking; complete is never called.
  await control('/_control/payment', {
    identifier: onChain,
    user_uid: masterUid,
    amount: connectPrice,
    memo: 'test',
    metadata: { purpose: 'CONNECT', orderId: recoverJobId, pricePi: '10', message: 'paid but never completed' },
    developer_approved: true,
    transaction_verified: true,
    developer_completed: false,
    txid: paidTxid,
  });

  const recovered = await api('POST', '/payments/cancel-incomplete', {
    token: masterJwt, body: { payment: { identifier: onChain } },
  });
  check('a payment that already reached the chain is handled',
    recovered.status === 200, `got ${recovered.status} ${JSON.stringify(recovered.body).slice(0, 140)}`);
  check('it is COMPLETED, not cancelled — the money was already taken',
    recovered.body?.action === 'completed',
    `action was ${recovered.body?.action}`);

  const recoveredRow = await prisma.payment.findUnique({ where: { piPaymentId: onChain } });
  check('recorded locally as completed with the chain txid',
    recoveredRow?.status === 'COMPLETED' && recoveredRow?.txid === paidTxid,
    `${recoveredRow?.status} / ${recoveredRow?.txid}`);

  // The whole point: the master paid to respond, so the response must exist.
  const grantedResponse = await prisma.response.findFirst({
    where: { orderId: recoverJobId, master: { piUid: masterUid } },
  });
  check('THE PURCHASE WAS DELIVERED — the response the master paid for exists',
    grantedResponse !== null,
    'the master was charged and got nothing');

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
