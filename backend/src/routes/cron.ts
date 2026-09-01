import crypto from 'crypto';
import { Router } from 'express';
import { env } from '../config/env';
import { unauthorized } from '../lib/errors';
import { asyncHandler } from '../middleware/validate';
import { autoReleaseExpiredEscrows, expireStaleOrders } from '../services/escrow';
import { clearIncompleteServerPayments } from '../services/piPayouts';

export const cronRouter = Router();

/** Constant-time secret comparison so the endpoint cannot be probed by timing. */
function assertCronSecret(provided: string | undefined): void {
  if (!provided) throw unauthorized('cron_secret_missing', 'Cron secret required');
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw unauthorized('cron_secret_invalid', 'Invalid cron secret');
  }
}

/**
 * Called hourly by cron-job.org (or Render Cron):
 *   POST /api/cron/auto-release?secret=...   — or the X-Cron-Secret header.
 * Idempotent, so a double fire is harmless.
 */
cronRouter.post(
  '/auto-release',
  asyncHandler(async (req, res) => {
    const provided =
      (req.headers['x-cron-secret'] as string | undefined) ??
      (typeof req.query.secret === 'string' ? req.query.secret : undefined);
    assertCronSecret(provided);

    const released = await autoReleaseExpiredEscrows(200);
    const expired = await expireStaleOrders(200);
    await clearIncompleteServerPayments().catch(() => undefined);

    res.json({ ok: true, released, at: new Date().toISOString() });
  }),
);
