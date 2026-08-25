import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Admin credentials: username from env, password compared against a bcrypt
 * hash. A plain ADMIN_PASSWORD is accepted only as a development convenience
 * and is hashed once at boot so the comparison path is identical.
 */
let passwordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? '';

if (!passwordHash && env.ADMIN_PASSWORD) {
  passwordHash = bcrypt.hashSync(env.ADMIN_PASSWORD, 12);
  if (env.isProduction) {
    logger.warn('ADMIN_PASSWORD is set in production — use ADMIN_PASSWORD_HASH instead');
  }
}

if (!passwordHash) {
  logger.error('No admin password configured — the admin panel is disabled');
}

const adminUids = new Set(
  env.ADMIN_UIDS.split(',')
    .map((uid) => uid.trim())
    .filter(Boolean),
);

export function adminConfigured(): boolean {
  return Boolean(passwordHash) || adminUids.size > 0;
}

/**
 * Whether a Pi-verified identity is allowed to open the admin panel without a
 * password. Read from the database record rather than from the token, so
 * revoking someone by editing ADMIN_UIDS takes effect on their next request
 * instead of whenever their month-long session happens to expire.
 */
export function isAdminPiUid(piUid: string | null | undefined): boolean {
  return Boolean(piUid) && adminUids.has(piUid as string);
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  if (!passwordHash) return false;
  const userMatches = username === env.ADMIN_USERNAME;
  // Always run bcrypt so a wrong username is not faster than a wrong password.
  const passwordMatches = await bcrypt.compare(password, passwordHash);
  return userMatches && passwordMatches;
}

export function signAdminToken(username: string): string {
  return jwt.sign({ sub: username, role: 'admin' }, env.JWT_SECRET, {
    expiresIn: env.ADMIN_JWT_EXPIRES_IN,
    issuer: 'pifix',
    audience: 'pifix-admin',
  } as jwt.SignOptions);
}

/**
 * Accepts either a Bearer admin JWT (used by the SPA) or HTTP Basic Auth
 * (handy for curl and for the documented `/admin` Basic Auth requirement).
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';

    if (header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      try {
        const payload = jwt.verify(token, env.JWT_SECRET, {
          issuer: 'pifix',
          audience: 'pifix-admin',
        }) as { sub: string; role: string };
        if (payload.role !== 'admin') throw new Error('not admin');
        req.admin = { username: payload.sub };
        next();
        return;
      } catch {
        throw unauthorized('admin_token_invalid', 'Admin session expired');
      }
    }

    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (await verifyAdminCredentials(username, password)) {
        req.admin = { username };
        next();
        return;
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="PiFix Admin", charset="UTF-8"');
    throw unauthorized('admin_auth_required', 'Admin authentication required');
  } catch (error) {
    next(error);
  }
}
