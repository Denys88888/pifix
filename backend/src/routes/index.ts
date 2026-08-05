import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { authRouter } from './auth';
import { ordersRouter } from './orders';
import { mastersRouter, responsesRouter } from './masters';
import { paymentsRouter } from './payments';
import { adminRouter } from './admin';
import { cronRouter } from './cron';
import {
  categoriesRouter,
  reviewsRouter,
  settingsRouter,
  uploadsRouter,
  withdrawalsRouter,
} from './misc';

export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  const started = Date.now();
  let database = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    sandbox: env.PI_SANDBOX,
    latencyMs: Date.now() - started,
    time: new Date().toISOString(),
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/responses', responsesRouter);
apiRouter.use('/masters', mastersRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/withdrawals', withdrawalsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/cron', cronRouter);
