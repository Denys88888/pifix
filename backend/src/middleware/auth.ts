import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';

export interface UserTokenPayload {
  sub: string; // user id
  uid: string; // Pi uid
  username: string;
}

export function signUserToken(payload: UserTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'pifix',
    audience: 'pifix-user',
  } as jwt.SignOptions);
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function loadUser(token: string) {
  let payload: UserTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'pifix',
      audience: 'pifix-user',
    }) as UserTokenPayload;
  } catch {
    throw unauthorized('token_invalid', 'Session expired, please sign in with Pi again');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.isDeleted) {
    throw unauthorized('user_not_found', 'Account not found');
  }
  return user;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readBearer(req);
    if (!token) throw unauthorized('no_token', 'Authentication required');

    const user = await loadUser(token);
    if (user.isBlocked) throw forbidden('user_blocked', 'This account is blocked');

    req.user = user;

    // Cheap presence tracking; failure here must never break the request.
    void prisma.user
      .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches the user when a token is present, but never rejects the request. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readBearer(req);
    if (token) {
      req.user = await loadUser(token).catch(() => undefined);
    }
  } catch {
    // ignored on purpose — this middleware is best-effort
  }
  next();
}

/** Gate for actions that require a KYC-verified pioneer (order creation, responses). */
export function requireKyc(req: Request, _res: Response, next: NextFunction): void {
  if (!env.REQUIRE_KYC) {
    next();
    return;
  }
  if (!req.user?.kycVerified) {
    next(forbidden('kyc_required', 'Complete KYC in the Pi Network app to use this feature'));
    return;
  }
  next();
}
