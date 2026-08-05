import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { lazySweep } from '../services/escrow';
import { logger } from '../lib/logger';

/**
 * Pi Browser has no background sync and Render's free tier sleeps, so the
 * escrow timeout is driven by ordinary user traffic: every request may kick off
 * a throttled sweep. It never blocks the response.
 */
export function lazyEscrowSweep(req: Request, _res: Response, next: NextFunction): void {
  next();

  if (req.method === 'OPTIONS' || req.path === '/api/health') return;

  void lazySweep(env.LAZY_SWEEP_INTERVAL_SECONDS).catch((error) =>
    logger.error('Lazy escrow sweep failed', { error: (error as Error).message }),
  );
}
