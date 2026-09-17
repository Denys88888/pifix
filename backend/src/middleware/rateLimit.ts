import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Pi Browser users very often share an IP (carrier NAT in the app's biggest
 * markets), so any limit that must be per-person keys on the authenticated
 * user id and only falls back to the IP for anonymous traffic.
 */
const userKey = (req: Request): string => req.user?.id ?? req.ip ?? 'unknown';

const base: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests, please slow down' } },
};

/**
 * Global: 300 requests / 15 min / IP. It runs before authentication, so it can
 * only key on the IP — and behind carrier NAT one IP is many pioneers, while
 * the order page alone polls 60 times in this window. The per-user limiters
 * below remain the real brakes on the expensive routes.
 */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/api/health',
});

/** Payments: 20 requests / 15 min. */
export const paymentLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: userKey,
});

/** Order creation: 5 / hour / user. */
export const createOrderLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: userKey,
  message: {
    error: { code: 'order_rate_limited', message: 'You can publish up to 5 orders per hour' },
  },
});

/** Authentication attempts: 30 / 15 min / IP. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

/** Admin login: 10 / 15 min / IP — brute-force brake. */
export const adminLoginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: { code: 'rate_limited', message: 'Too many login attempts' } },
});

/**
 * The Pi developer entrance: 60 / 15 min / user. Generous on purpose — it is
 * keyed on an already-authenticated user id, so it guards against a render loop
 * rather than against guessing.
 */
export const piAdminLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: userKey,
});

/** Uploads: 40 / hour / user. */
export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 40,
  keyGenerator: userKey,
});

/** Writes that create content (responses, reviews): 30 / hour / user. */
export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: userKey,
});
