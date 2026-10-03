/**
 * The order chat and the dispute flow around it.
 *
 * Who may read and write an order's chat, when it opens and closes, that the
 * admin can join a dispute and both sides see the same words, that the
 * dispute records who opened it, that the admin's decision reaches both sides,
 * and that none of it leaks to anyone outside the order.
 *
 * Orders are seeded straight into the database in the state a verified escrow
 * payment would have produced; everything after that goes through the API.
 * Run with: npm run test:chat  (needs the API on :3000 and a seeded database)
 */
import { PrismaClient, EscrowStatus, OrderStatus } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL ?? 'http://localhost:3000/api';
const SECRET = process.env.JWT_SECRET!;
const ADMIN_BASIC = `${process.env.ADMIN_USERNAME ?? 'admin'}:${process.env.ADMIN_PASSWORD ?? ''}`;

if (!SECRET || !process.env.ADMIN_PASSWORD) {
  console.error('Missing env. Run from backend/ with:\n  set -a && . ./.env && set +a && npm run test:chat');
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

async function call(method: string, path: string, opts: { token?: string; body?: unknown; basic?: string } = {}) {
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
  const stamp = Date.now().toString(36);
  const mk = (tag: string) =>
    prisma.user.create({ data: { piUid: `chat-${tag}-${stamp}`, username: `chat_${tag}_${stamp}`, kycVerified: true } });
  const client = await mk('client');
  const master = await mk('master');
  const stranger = await mk('stranger');
  const clientT = token(client);
  const masterT = token(master);
  const strangerT = token(stranger);

  const seedOrder = (data: Partial<Parameters<typeof prisma.order.create>[0]['data']>) =>
    prisma.order.create({
      data: {
        publicId: pid(),
        clientId: client.id,
        categoryId: category.id,
        title: 'Chat test job',
        description: 'Seeded for the order chat suite.',
        budgetPi: '10',
        address: 'Warsaw',
        lat: 52.23,
        lng: 21.01,
        ...data,
      } as never,
    });

  console.log('\n═══ 1. The chat opens only once a master is hired ═══');

  const open = await seedOrder({ status: OrderStatus.OPEN });
  const early = await call('POST', `/orders/${open.id}/messages`, { token: clientT, body: { text: 'hello?' } });
  check('no chat before a master is hired', early.status === 403 && early.body?.error?.code === 'chat_not_open',
    `got ${early.status} ${early.body?.error?.code}`);

  const hired = await seedOrder({
    status: OrderStatus.IN_PROGRESS,
    masterId: master.id,
    escrowStatus: EscrowStatus.FUNDED,
    escrowAmountPi: '10',
    totalPaidPi: '11',
    clientFeePi: '1',
    masterPayoutPi: '10',
  });

  console.log('\n═══ 2. Both sides talk, nobody else can listen ═══');

  const c1 = await call('POST', `/orders/${hired.id}/messages`, { token: clientT, body: { text: 'Can you come at 11?' } });
  check('client writes', c1.status === 201 && c1.body?.message?.role === 'CLIENT' && c1.body?.message?.mine === true,
    `got ${c1.status} ${JSON.stringify(c1.body).slice(0, 120)}`);
  const m1 = await call('POST', `/orders/${hired.id}/messages`, { token: masterT, body: { text: 'Yes, 11 is fine.' } });
  check('master writes', m1.status === 201 && m1.body?.message?.role === 'MASTER', `got ${m1.status}`);

  const asClient = await call('GET', `/orders/${hired.id}/messages`, { token: clientT });
  check('client reads both messages in order',
    asClient.status === 200 && asClient.body?.items?.length === 2 &&
      asClient.body.items[0].text === 'Can you come at 11?' && asClient.body.items[1].text === 'Yes, 11 is fine.',
    JSON.stringify(asClient.body).slice(0, 160));
  check('"mine" is from the reader\'s point of view',
    asClient.body?.items?.[0]?.mine === true && asClient.body?.items?.[1]?.mine === false);

  const after = await call('GET', `/orders/${hired.id}/messages?after=${encodeURIComponent(asClient.body.items[0].createdAt)}`, {
    token: masterT,
  });
  // Inclusive on purpose (see listMessagesFor): the boundary message comes back
  // and the client drops it by id; anything older must not.
  const afterTexts = (after.body?.items ?? []).map((m: any) => m.text);
  check('polling with ?after returns the newer message and nothing older',
    afterTexts.includes('Yes, 11 is fine.') && afterTexts.length <= 2, JSON.stringify(afterTexts));

  const spyRead = await call('GET', `/orders/${hired.id}/messages`, { token: strangerT });
  check('a stranger cannot read the chat', spyRead.status === 404, `got ${spyRead.status}`);
  const spyWrite = await call('POST', `/orders/${hired.id}/messages`, { token: strangerT, body: { text: 'hi' } });
  check('a stranger cannot write into it', spyWrite.status === 404, `got ${spyWrite.status}`);
  const anon = await call('GET', `/orders/${hired.id}/messages`);
  check('nobody signed out can read it', anon.status === 401, `got ${anon.status}`);

  const empty = await call('POST', `/orders/${hired.id}/messages`, { token: clientT, body: { text: '   ' } });
  check('an empty message is refused', empty.status === 400, `got ${empty.status}`);
  const long = await call('POST', `/orders/${hired.id}/messages`, { token: clientT, body: { text: 'x'.repeat(1001) } });
  check('a message over 1000 characters is refused', long.status === 400, `got ${long.status}`);

  const html = await call('POST', `/orders/${hired.id}/messages`, {
    token: masterT,
    body: { text: '<img src=x onerror=alert(1)>' },
  });
  check('markup is stored as plain text, not stripped or rejected',
    html.status === 201 && html.body?.message?.text === '<img src=x onerror=alert(1)>', `got ${html.status}`);

  console.log('\n═══ 3. A dispute: who opened it, the admin joins, the decision reaches both ═══');

  const dispute = await call('POST', `/orders/${hired.id}/dispute`, {
    token: masterT,
    body: { reason: 'The client does not let me in to do the job.' },
  });
  check('master opens a dispute', dispute.status === 200 && dispute.body?.order?.status === 'DISPUTED', `got ${dispute.status}`);
  check('the order says the master opened it', dispute.body?.order?.disputedBy === 'master',
    String(dispute.body?.order?.disputedBy));

  const clientView = await call('GET', `/orders/${hired.id}`, { token: clientT });
  check('the client sees the reason and who opened it',
    clientView.body?.order?.disputeReason?.startsWith('The client does not') && clientView.body?.order?.disputedBy === 'master',
    JSON.stringify(clientView.body?.order?.disputedBy));
  const strangerView = await call('GET', `/orders/${hired.id}`, { token: strangerT });
  check('a stranger sees neither the reason nor who opened it',
    strangerView.body?.order?.disputeReason === null && strangerView.body?.order?.disputedBy === null,
    JSON.stringify({ r: strangerView.body?.order?.disputeReason, b: strangerView.body?.order?.disputedBy }));
  const publicList = await call('GET', '/orders?status=DISPUTED&limit=50', { token: strangerT });
  const leaked = (publicList.body?.items ?? []).find((o: any) => o.id === hired.id);
  check('the dispute reason does not leak through the public order list', !leaked || leaked.disputeReason === null,
    JSON.stringify(leaked?.disputeReason));

  const adminRead = await call('GET', `/admin/orders/${hired.id}/messages`, { basic: ADMIN_BASIC });
  check('the admin reads the whole chat', adminRead.status === 200 && adminRead.body?.items?.length === 3,
    `got ${adminRead.status} ${adminRead.body?.items?.length}`);
  const adminSays = await call('POST', `/admin/orders/${hired.id}/messages`, {
    basic: ADMIN_BASIC,
    body: { text: 'Please both tell me when the visit was arranged.' },
  });
  check('the admin writes into the chat', adminSays.status === 201 && adminSays.body?.message?.role === 'ADMIN',
    `got ${adminSays.status}`);
  const masterSeesAdmin = await call('GET', `/orders/${hired.id}/messages`, { token: masterT });
  const clientSeesAdmin = await call('GET', `/orders/${hired.id}/messages`, { token: clientT });
  const adminLine = (page: any) => (page.body?.items ?? []).find((m: any) => m.role === 'ADMIN');
  check('both sides see the admin\'s message', Boolean(adminLine(masterSeesAdmin)) && Boolean(adminLine(clientSeesAdmin)));
  const mUserCannotPostAsAdmin = await call('POST', `/admin/orders/${hired.id}/messages`, {
    token: masterT,
    body: { text: 'I am the admin now' },
  });
  check('a pioneer cannot write as the administration', mUserCannotPostAsAdmin.status === 401,
    `got ${mUserCannotPostAsAdmin.status}`);

  const replyInDispute = await call('POST', `/orders/${hired.id}/messages`, {
    token: clientT,
    body: { text: 'We agreed on 11, I was home.' },
  });
  check('the sides can still answer during the dispute', replyInDispute.status === 201, `got ${replyInDispute.status}`);

  const resolved = await call('POST', `/admin/orders/${hired.id}/resolve`, {
    basic: ADMIN_BASIC,
    body: { action: 'refund', note: 'The master did not come at the agreed time.' },
  });
  check('admin resolves with a refund', resolved.status === 200, `got ${resolved.status} ${JSON.stringify(resolved.body).slice(0, 120)}`);

  const clientAfter = await call('GET', `/orders/${hired.id}`, { token: clientT });
  check('the client sees the decision and the note',
    clientAfter.body?.order?.resolution?.action === 'refund' &&
      clientAfter.body?.order?.resolution?.note === 'The master did not come at the agreed time.',
    JSON.stringify(clientAfter.body?.order?.resolution));
  const masterAfter = await call('GET', `/orders/${hired.id}`, { token: masterT });
  check('the master sees the same decision', masterAfter.body?.order?.resolution?.action === 'refund');
  const strangerAfter = await call('GET', `/orders/${hired.id}`, { token: strangerT });
  check('a stranger does not see the decision', strangerAfter.body?.order?.resolution === null,
    JSON.stringify(strangerAfter.body?.order?.resolution));

  const chatAfter = await call('GET', `/orders/${hired.id}/messages`, { token: masterT });
  const decisionLine = (chatAfter.body?.items ?? []).find((m: any) => m.role === 'ADMIN' && m.text.startsWith('@resolution:refund'));
  check('the decision is posted into the chat as well', Boolean(decisionLine), JSON.stringify(chatAfter.body?.items?.slice(-1)));

  console.log('\n═══ 4. A cancelled order closes the chat ═══');

  await prisma.order.update({ where: { id: hired.id }, data: { status: OrderStatus.CANCELLED } });
  const closed = await call('POST', `/orders/${hired.id}/messages`, { token: clientT, body: { text: 'still there?' } });
  check('no new messages on a cancelled order', closed.status === 409 && closed.body?.error?.code === 'chat_closed',
    `got ${closed.status} ${closed.body?.error?.code}`);
  const stillReadable = await call('GET', `/orders/${hired.id}/messages`, { token: clientT });
  check('but the history stays readable', stillReadable.status === 200 && stillReadable.body?.open === false,
    `got ${stillReadable.status} open=${stillReadable.body?.open}`);

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
