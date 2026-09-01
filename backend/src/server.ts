import http from 'http';
import cron from 'node-cron';
import { env } from './config/env';
import { logger } from './lib/logger';
import { connectDatabase, disconnectDatabase } from './lib/prisma';
import { createApp } from './app';
import { autoReleaseExpiredEscrows, expireStaleOrders } from './services/escrow';
import { clearIncompleteServerPayments } from './services/piPayouts';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(`PiFix API listening on :${env.PORT}`, {
      env: env.NODE_ENV,
      sandbox: env.PI_SANDBOX,
      payouts: env.payoutsConfigured,
      cloudinary: env.cloudinaryConfigured,
    });
  });

  // Fallback timer for escrow auto-release. The primary mechanism is the lazy
  // sweep on user traffic; cron-job.org hitting /api/cron/auto-release is the
  // third layer for instances that go idle.
  if (env.ENABLE_INTERNAL_CRON) {
    cron.schedule('0 * * * *', () => {
      void autoReleaseExpiredEscrows(200).catch((error) =>
        logger.error('Cron auto-release failed', { error: (error as Error).message }),
      );
      void expireStaleOrders(200).catch((error) =>
        logger.error('Cron order expiry failed', { error: (error as Error).message }),
      );
      void clearIncompleteServerPayments().catch(() => undefined);
    });
    logger.info('Internal hourly cron enabled');
  }

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    // Do not let a hung connection keep the process alive forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to start the server', { message: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
});
