import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './config/env';
import { logger } from './lib/logger';
import { forbidden } from './lib/errors';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';
import { lazyEscrowSweep } from './middleware/lazySweep';

export function createApp(): Express {
  const app = express();

  // Render terminates TLS at its proxy; without this req.ip is always the proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; the SPA is a separate static site.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/curl requests have no Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        // Pi hosts every app on a *.pinet.com subdomain.
        if (/^https:\/\/[a-z0-9-]+\.pinet\.com$/i.test(origin)) return callback(null, true);
        logger.warn('Blocked CORS origin', { origin });
        // An AppError keeps this a clean 403 instead of a generic 500.
        return callback(forbidden('cors_blocked', 'Origin not allowed'));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use((req, _res, next) => {
    if (!req.path.startsWith('/api/health')) {
      logger.http?.(`${req.method} ${req.path}`);
    }
    next();
  });

  app.use(globalLimiter);
  app.use(lazyEscrowSweep);

  app.use('/api', apiRouter);

  app.get('/', (_req, res) => {
    res.json({ name: 'PiFix API', version: '1.0.0', docs: '/api/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
