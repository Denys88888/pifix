import type { Request, Response } from 'express';
import { WithdrawalStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, conflict } from '../lib/errors';
import { money, toPi } from '../lib/money';
import { paginate, withdrawalDTO } from '../lib/serializers';
import { getSettings } from '../services/settings';

export const requestWithdrawalSchema = z.object({
  amountPi: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d{1,7})?$/.test(value), 'Amount must be a number with up to 7 decimals'),
});

/**
 * Opens a withdrawal request. The balance is NOT debited here — it is debited
 * when the admin marks the payout as paid, so a rejected request costs nothing.
 * A single open request per user keeps the two paths from double-spending.
 */
export async function requestWithdrawal(req: Request, res: Response): Promise<void> {
  const input = requestWithdrawalSchema.parse(req.body);
  const settings = await getSettings();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  if (!user.walletAddress) {
    throw badRequest('no_wallet', 'Sign in with the payments scope so PiFix knows your wallet address');
  }

  const amount = toPi(input.amountPi);
  if (amount.lessThan(settings.minWithdrawalPi)) {
    throw badRequest('amount_too_low', `Minimum withdrawal is ${money(settings.minWithdrawalPi)} Pi`);
  }
  if (amount.greaterThan(user.balancePi)) {
    throw badRequest('insufficient_balance', `Your balance is ${money(user.balancePi)} Pi`);
  }

  const open = await prisma.withdrawalRequest.count({
    where: { userId: user.id, status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } },
  });
  if (open > 0) throw conflict('withdrawal_pending', 'You already have a withdrawal in progress');

  const withdrawal = await prisma.withdrawalRequest.create({
    data: { userId: user.id, amountPi: amount, walletAddress: user.walletAddress },
  });

  logger.info('Withdrawal requested', { userId: user.id, amount: money(amount) });
  res.status(201).json({ withdrawal: withdrawalDTO(withdrawal) });
}

export async function myWithdrawals(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);

  const where = { userId: req.user!.id };
  const [rows, total] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.withdrawalRequest.count({ where }),
  ]);

  const settings = await getSettings();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  res.json({
    ...paginate(rows.map((row) => withdrawalDTO(row)), q.page, q.limit, total),
    balancePi: money(user.balancePi),
    minWithdrawalPi: money(settings.minWithdrawalPi),
  });
}

export async function cancelWithdrawal(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!withdrawal || withdrawal.userId !== req.user!.id) {
    throw badRequest('withdrawal_not_found', 'Withdrawal request not found');
  }
  if (withdrawal.status !== WithdrawalStatus.REQUESTED) {
    throw conflict('withdrawal_not_cancellable', 'This request is already being processed');
  }

  await prisma.withdrawalRequest.update({
    where: { id },
    data: { status: WithdrawalStatus.REJECTED, adminNote: 'Cancelled by the user', processedAt: new Date() },
  });

  res.json({ ok: true });
}
