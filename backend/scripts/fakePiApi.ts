/**
 * A stand-in for the Pi Platform API, for local testing only.
 *
 * `services/paymentVerification.ts` is the one file where a mistake costs real
 * money, and none of it can run against the real Pi API from a test: payments
 * need a human in Pi Browser. So this server speaks the same protocol and lets
 * a test craft payments — including malicious ones the real SDK would never
 * produce — and assert that the backend refuses them.
 *
 * It implements only what the backend actually calls:
 *   GET  /v2/me
 *   GET  /v2/payments/:id
 *   POST /v2/payments/:id/approve | /complete | /cancel
 *   POST /v2/payments
 *   GET  /v2/payments/incomplete_server_payments
 *
 * Plus a /_control surface the test drives it with.
 *
 * Never point a deployed backend at this. Run with: npm run fake-pi
 */
import express from 'express';

interface FakePayment {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  from_address: string;
  to_address: string;
  direction: 'user_to_app' | 'app_to_user';
  created_at: string;
  network: string;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: null | { txid: string; verified: boolean; _link: string };
}

const users = new Map<string, { uid: string; username: string; kyc_status?: string }>();
const payments = new Map<string, FakePayment>();

const app = express();
app.use(express.json());

// ── control surface (test-only) ─────────────────────────────────────────────

app.post('/_control/user', (req, res) => {
  const { accessToken, uid, username, kyc_status } = req.body;
  users.set(accessToken, { uid, username, kyc_status });
  res.json({ ok: true });
});

app.post('/_control/payment', (req, res) => {
  const b = req.body;
  const payment: FakePayment = {
    identifier: b.identifier,
    user_uid: b.user_uid,
    amount: b.amount,
    memo: b.memo ?? '',
    metadata: b.metadata ?? {},
    from_address: 'GFAKEUSERWALLET',
    to_address: 'GFAKEAPPWALLET',
    direction: b.direction ?? 'user_to_app',
    created_at: new Date().toISOString(),
    network: 'Pi Testnet',
    status: {
      developer_approved: b.developer_approved ?? false,
      transaction_verified: b.transaction_verified ?? true,
      developer_completed: b.developer_completed ?? false,
      cancelled: b.cancelled ?? false,
      user_cancelled: b.user_cancelled ?? false,
    },
    transaction: b.txid ? { txid: b.txid, verified: true, _link: '' } : null,
  };
  payments.set(payment.identifier, payment);
  res.json({ ok: true, payment });
});

app.get('/_control/payment/:id', (req, res) => {
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'not found' });
  res.json(payment);
});

app.post('/_control/reset', (_req, res) => {
  users.clear();
  payments.clear();
  res.json({ ok: true });
});

// ── the Pi Platform protocol ────────────────────────────────────────────────

app.get('/v2/me', (req, res) => {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  const user = users.get(header.slice(7).trim());
  if (!user) return res.status(401).json({ error: 'invalid_access_token' });
  res.json({ uid: user.uid, username: user.username, kyc_status: user.kyc_status });
});

function requireServerKey(req: express.Request, res: express.Response): boolean {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Key ')) {
    res.status(401).json({ error: 'server key required' });
    return false;
  }
  return true;
}

app.get('/v2/payments/incomplete_server_payments', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const incomplete = [...payments.values()].filter(
    (p) => p.direction === 'app_to_user' && !p.status.developer_completed && !p.status.cancelled,
  );
  res.json({ incomplete_server_payments: incomplete });
});

app.get('/v2/payments/:id', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  res.json(payment);
});

app.post('/v2/payments/:id/approve', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  payment.status.developer_approved = true;
  res.json(payment);
});

app.post('/v2/payments/:id/complete', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  const txid = req.body?.txid;
  if (!txid) return res.status(400).json({ error: 'txid required' });
  payment.status.developer_completed = true;
  payment.transaction = { txid, verified: payment.status.transaction_verified, _link: '' };
  res.json(payment);
});

app.post('/v2/payments/:id/cancel', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  payment.status.cancelled = true;
  res.json(payment);
});

app.post('/v2/payments', (req, res) => {
  if (!requireServerKey(req, res)) return;
  const p = req.body?.payment ?? {};
  const identifier = `a2u_${Math.random().toString(36).slice(2, 12)}`;
  const payment: FakePayment = {
    identifier,
    user_uid: p.uid,
    amount: p.amount,
    memo: p.memo ?? '',
    metadata: p.metadata ?? {},
    from_address: 'GFAKEAPPWALLET',
    to_address: 'GFAKEUSERWALLET',
    direction: 'app_to_user',
    created_at: new Date().toISOString(),
    network: 'Pi Testnet',
    status: {
      developer_approved: true,
      transaction_verified: false,
      developer_completed: false,
      cancelled: false,
      user_cancelled: false,
    },
    transaction: null,
  };
  payments.set(identifier, payment);
  res.json(payment);
});

const PORT = Number(process.env.FAKE_PI_PORT ?? 4010);
app.listen(PORT, () => {
  console.log(`fake Pi Platform API listening on :${PORT} — TEST USE ONLY`);
});
