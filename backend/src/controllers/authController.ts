import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, forbidden } from '../lib/errors';
import { selfUser } from '../lib/serializers';
import { signUserToken } from '../middleware/auth';
import { isKycVerified, verifyAccessToken } from '../services/piApi';
import { resolveReferrer } from '../services/referral';
import { env } from '../config/env';

export const loginSchema = z.object({
  accessToken: z.string().min(10, 'Pi access token is required'),
  /** Optional: username taken from ?ref= on first visit. */
  referrer: z.string().max(64).optional(),
  /** Wallet address returned by Pi.authenticate with the `payments` scope. */
  walletAddress: z.string().max(120).optional(),
  language: z.string().max(8).optional(),
});

/**
 * The only way into PiFix: a Pi access token, verified server-side against
 * /v2/me. Nothing the client sends about identity is trusted.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);

  const me = await verifyAccessToken(input.accessToken);
  const kyc = isKycVerified(me);

  const existing = await prisma.user.findUnique({
    where: { piUid: me.uid },
    include: { masterProfile: true },
  });

  if (existing?.isBlocked) {
    throw forbidden('user_blocked', 'This account is blocked');
  }

  let user = existing;

  if (!user) {
    const referrerId = await resolveReferrer(input.referrer, me.username);
    user = await prisma.user.create({
      data: {
        piUid: me.uid,
        username: me.username,
        walletAddress: input.walletAddress ?? me.wallet_address ?? null,
        language: input.language ?? 'en',
        kycVerified: kyc ?? false,
        referrerId,
      },
      include: { masterProfile: true },
    });
    logger.info('New user registered', { username: me.username, hasReferrer: Boolean(referrerId) });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        // Pi usernames can change; keep ours in sync with the platform.
        username: me.username,
        walletAddress: input.walletAddress ?? me.wallet_address ?? user.walletAddress,
        language: input.language ?? user.language,
        ...(kyc === null ? {} : { kycVerified: kyc }),
        // Attach a referrer only if the account never had one and has no history.
        ...(!user.referrerId && input.referrer
          ? { referrerId: await resolveReferrer(input.referrer, me.username) }
          : {}),
        lastSeenAt: new Date(),
      },
      include: { masterProfile: true },
    });
  }

  if (user.isDeleted) {
    await prisma.user.update({ where: { id: user.id }, data: { isDeleted: false } });
  }

  const token = signUserToken({ sub: user.id, uid: user.piUid, username: user.username });

  res.json({
    token,
    user: selfUser(user),
    kycKnown: kyc !== null,
    kycRequired: env.REQUIRE_KYC,
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    include: { masterProfile: true },
  });
  res.json({ user: selfUser(user) });
}

export const walletSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .min(20, 'Wallet address looks too short')
    .max(120)
    .regex(/^[A-Z0-9]+$/, 'Wallet address must be an uppercase Pi/Stellar address'),
});

export async function updateWallet(req: Request, res: Response): Promise<void> {
  const input = walletSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { walletAddress: input.walletAddress },
    include: { masterProfile: true },
  });
  res.json({ user: selfUser(user) });
}

export const languageSchema = z.object({ language: z.string().min(2).max(8) });

export async function updateLanguage(req: Request, res: Response): Promise<void> {
  const input = languageSchema.parse(req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data: { language: input.language } });
  res.json({ ok: true });
}

/**
 * GDPR erasure. Soft delete + anonymisation: the person disappears, the
 * marketplace statistics (jobs, ratings) survive without a link to them.
 * Refused while money is still in flight.
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;

  const blocking = await prisma.order.count({
    where: {
      OR: [{ clientId: userId }, { masterId: userId }],
      status: { in: ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'] },
    },
  });
  if (blocking > 0) {
    throw badRequest('active_orders_exist', 'Finish or cancel your active orders before deleting the account');
  }

  const pendingWithdrawals = await prisma.withdrawalRequest.count({
    where: { userId, status: { in: ['REQUESTED', 'APPROVED'] } },
  });
  if (pendingWithdrawals > 0) {
    throw badRequest('pending_withdrawal', 'You have a withdrawal in progress');
  }

  await prisma.$transaction(async (tx) => {
    const anonymous = `deleted_user_${userId.slice(0, 8)}`;

    await tx.response.updateMany({
      where: { masterId: userId, status: 'ACTIVE' },
      data: { status: 'WITHDRAWN' },
    });
    await tx.order.updateMany({
      where: { clientId: userId, status: 'OPEN' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await tx.masterProfile.deleteMany({ where: { userId } });
    await tx.review.updateMany({ where: { authorId: userId }, data: { text: '' } });

    await tx.user.update({
      where: { id: userId },
      data: {
        username: anonymous,
        piUid: `deleted_${userId}`,
        walletAddress: null,
        isDeleted: true,
        isMaster: false,
        referrerId: null,
      },
    });
  });

  logger.info('Account deleted (anonymised)', { userId });
  res.json({ ok: true });
}
