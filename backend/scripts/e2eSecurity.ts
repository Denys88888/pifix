/**
 * Security controls that the checklist claims but nothing had ever exercised:
 * rate limits, upload validation, and input handling.
 *
 * A rate limit that silently does not fire is worse than none — it is a control
 * everyone believes in. Same for an upload filter: the magic-byte check is the
 * only thing standing between "renamed .pdf" and Cloudinary.
 *
 * Needs the fake Pi API and a backend pointed at it. See TESTING.md.
 * Run with: npm run test:security
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.TEST_API_URL ?? 'http://localhost:3010/api';
const FAKE = process.env.FAKE_PI_URL ?? 'http://localhost:4010';

if (!process.env.ADMIN_PASSWORD) {
  console.error('Missing env. Run: set -a && . ./.env && set +a && npm run test:security');
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

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
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

async function register(tag: string, stamp: string) {
  const accessToken = `tok_${tag}_${stamp}`;
  await control('/_control/user', {
    accessToken, uid: `uid_${tag}_${stamp}`, username: `s${tag}_${stamp}`, kyc_status: 'verified',
  });
  const res = await api('POST', '/auth/pi', { body: { accessToken } });
  if (res.status !== 200) throw new Error(`register ${tag}: ${res.status}`);
  return { jwt: res.body.token as string, id: res.body.user.id as string };
}

/** Uploads a raw buffer as multipart, so the server sees a real file. */
async function upload(token: string, folder: string, filename: string, mime: string, bytes: Buffer) {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  const res = await fetch(`${API}/uploads/${folder}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');

async function main() {
  const stamp = Date.now().toString(36);
  const user = await register('sec', stamp);

  console.log('\n═══ 1. Upload validation ═══');

  // A PDF renamed to .jpg with an image mimetype: only the magic-byte check
  // can catch this, and it runs before anything reaches Cloudinary.
  const disguised = await upload(user.jwt, 'orders', 'invoice.jpg', 'image/jpeg', PDF_MAGIC);
  check('PDF disguised as a JPEG rejected by the magic-byte check',
    disguised.status === 400 && disguised.body?.error?.code === 'invalid_file_content',
    `got ${disguised.status} ${disguised.body?.error?.code}`);

  const gif = await upload(user.jwt, 'orders', 'anim.gif', 'image/gif', Buffer.from('GIF89a'));
  check('non-JPEG/PNG mimetype rejected by the filter',
    gif.status === 400 && gif.body?.error?.code === 'invalid_file_type',
    `got ${gif.status} ${gif.body?.error?.code}`);

  const huge = Buffer.concat([JPEG_MAGIC, Buffer.alloc(6 * 1024 * 1024)]);
  const tooBig = await upload(user.jwt, 'orders', 'big.jpg', 'image/jpeg', huge);
  check('file over 5 MB rejected',
    tooBig.status === 400 && tooBig.body?.error?.code === 'file_too_large',
    `got ${tooBig.status} ${tooBig.body?.error?.code}`);

  const badFolder = await upload(user.jwt, 'etc-passwd', 'x.png', 'image/png', PNG_MAGIC);
  check('unknown upload folder rejected',
    badFolder.status === 400, `got ${badFolder.status} ${badFolder.body?.error?.code}`);

  const noAuth = await fetch(`${API}/uploads/orders`, { method: 'POST' });
  check('unauthenticated upload rejected', noAuth.status === 401, `got ${noAuth.status}`);

  // A genuine PNG gets past every check and only then hits Cloudinary, which is
  // not configured locally — proving the validation order is right.
  const realPng = await upload(user.jwt, 'orders', 'ok.png', 'image/png', PNG_MAGIC);
  check('a real PNG passes validation and reaches the storage step',
    realPng.status === 500 && realPng.body?.error?.code === 'uploads_unavailable',
    `got ${realPng.status} ${realPng.body?.error?.code}`);

  console.log('\n═══ 2. Rate limiting actually fires ═══');

  const orderBody = {
    categorySlug: 'plumbing', title: 'Rate limit probe job',
    description: 'Published repeatedly to prove the per-hour limit fires.',
    budgetPi: '5', address: 'Warsaw', lat: 52.23, lng: 21.01, isUrgent: false, photos: [],
  };

  const codes: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const res = await api('POST', '/orders', { token: user.jwt, body: orderBody });
    codes.push(res.status);
  }
  const limited = codes.filter((c) => c === 429).length;
  const created = codes.filter((c) => c === 201).length;
  check('order creation is capped per hour', limited > 0,
    `statuses ${codes.join(',')}`);
  check('the cap is 5 per hour as documented', created === 5,
    `${created} created, ${limited} rate-limited`);

  const stillReadable = await api('GET', '/orders?limit=1');
  check('the write limit does not block reads', stillReadable.status === 200,
    `got ${stillReadable.status}`);

  const other = await register('sec2', stamp);
  const otherOrder = await api('POST', '/orders', { token: other.jwt, body: orderBody });
  check('the limit is per user, not global (shared carrier NAT)',
    otherOrder.status === 201, `got ${otherOrder.status}`);

  console.log('\n═══ 3. Input handling ═══');

  const badUuid = await api('GET', '/orders/not-a-uuid');
  check('malformed uuid rejected by Zod', badUuid.status === 400,
    `got ${badUuid.status} ${badUuid.body?.error?.code}`);

  const negativePage = await api('GET', '/orders?page=-5&limit=9999');
  check('out-of-range pagination rejected', negativePage.status === 400,
    `got ${negativePage.status} ${negativePage.body?.error?.code}`);

  const sqlish = await api('GET', `/orders?category=${encodeURIComponent("' OR 1=1 --")}`);
  check('SQL-looking category is just a miss, not an error',
    sqlish.status === 200 && sqlish.body?.total === 0,
    `got ${sqlish.status} total=${sqlish.body?.total}`);

  const longTitle = await api('POST', '/orders', {
    token: other.jwt, body: { ...orderBody, title: 'x'.repeat(500) },
  });
  check('over-long title rejected instead of truncated',
    longTitle.status === 400 && longTitle.body?.error?.code === 'validation_error',
    `got ${longTitle.status} ${longTitle.body?.error?.code}`);

  const xss = await api('POST', '/orders', {
    token: other.jwt,
    body: { ...orderBody, title: '<img src=x onerror=alert(1)>' },
  });
  if (xss.status === 201) {
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: xss.body.order.id } });
    check('markup is stored verbatim, never interpreted server-side',
      stored.title === '<img src=x onerror=alert(1)>', stored.title);
  } else {
    check('markup title handled without a server error', xss.status === 429,
      `got ${xss.status} ${xss.body?.error?.code}`);
  }

  console.log('\n═══ 4. Admin brute-force brake ═══');

  const adminCodes: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await fetch(`${API}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: `wrong-${i}` }),
    });
    adminCodes.push(res.status);
  }
  check('admin login is rate-limited after repeated failures',
    adminCodes.includes(429), `statuses ${adminCodes.join(',')}`);
  check('no wrong password ever succeeded', !adminCodes.includes(200),
    `statuses ${adminCodes.join(',')}`);

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
