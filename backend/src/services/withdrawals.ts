import { TransactionType, WithdrawalStatus, type WithdrawalRequest } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, conflict, notFound } from '../lib/errors';
import { money, toPi } from '../lib/money';
import { adminNote } from '../lib/adminNotes';
import { audit } from '../lib/audit';
import { env } from '../config/env';
import { postTransaction } from './ledger';
import { payoutsRequireKyc, sendPayout } from './piPayouts';
import { getSettings } from './settings';
import { notify } from './notifications';

export type WithdrawalOutcome =
  | { outcome: 'paid'; withdrawal: WithdrawalRequest }
  | { outcome: 'failed'; error: string }
  | { outcome: 'uncertain'; piPaymentId?: string };

/**
 * Pays one withdrawal request out on-chain. Shared by the admin's "Pay" button
 * and the automatic payout after a confirmed job, so both obey the same rules:
 *
 * the balance is debited first, under a compare-and-swap on the request, and
 * given back if the transfer fails; a transfer whose outcome is unknown keeps
 * the debit and leaves the request APPROVED for the admin to reconcile, because
 * refunding it or sending again are both ways to pay twice.
 *
 * Refusals that need no transfer at all (already paid, payouts switched off)
 * throw, as they did from the controller.
 */
export async function executeWithdrawal(id: string, actor: string): Promise<WithdrawalOutcome> {
  const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id }, include: { user: true } });
  if (!withdrawal) throw notFound('withdrawal_not_found', 'Withdrawal request not found');
  if (withdrawal.status === WithdrawalStatus.PAID) throw conflict('already_paid', 'This withdrawal was already paid');
  if (withdrawal.status === WithdrawalStatus.REJECTED) {
    throw conflict('already_rejected', 'This withdrawal was rejected');
  }
  if (!env.payoutsConfigured) {
    throw badRequest('payouts_disabled', 'Set PI_WALLET_PRIVATE_SEED and PAYOUTS_ENABLED to pay out');
  }
  if (withdrawal.txid) throw conflict('already_paid', 'This withdrawal already has a chain transaction');
  // Debited and claimed by an attempt that never reported back — a crash between
  // the debit and the payout leaves this state. Sending again could pay twice.
  if (withdrawal.status === WithdrawalStatus.APPROVED) {
    throw conflict(
      'needs_reconciliation',
      'An earlier attempt already claimed this withdrawal — verify it on the Pi API before retrying',
    );
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-swap: only the caller that flips REQUESTED → APPROVED debits and sends.
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.APPROVED },
    });
    if (claimed.count === 0) throw conflict('already_processing', 'This withdrawal is already being paid');

    await postTransaction(tx, {
      userId: withdrawal.userId,
      type: TransactionType.WITHDRAWAL,
      amountPi: toPi(withdrawal.amountPi).negated(),
      description: withdrawal.walletAddress
        ? `Withdrawal to ${withdrawal.walletAddress.slice(0, 8)}…`
        : 'Withdrawal to the Pi wallet',
      requireFunds: true,
    });
  });

  const payout = await sendPayout({
    userId: withdrawal.userId,
    piUid: withdrawal.user.piUid,
    amount: money(withdrawal.amountPi),
    memo: 'PiFix withdrawal',
    type: 'WITHDRAWAL',
    metadata: { withdrawalId: withdrawal.id },
  });

  if (!payout.ok && payout.uncertain) {
    await prisma.withdrawalRequest.update({
      where: { id },
      data: { piPaymentId: payout.piPaymentId ?? null, adminNote: adminNote('payout_unconfirmed', payout.piPaymentId) },
    });
    await audit(actor, 'withdrawal:unconfirmed', id, { piPaymentId: payout.piPaymentId });
    return { outcome: 'uncertain', piPaymentId: payout.piPaymentId };
  }

  if (!payout.ok) {
    const error = payout.error ?? 'unknown error';
    await prisma.$transaction(async (tx) => {
      await postTransaction(tx, {
        userId: withdrawal.userId,
        type: TransactionType.ADMIN_ADJUSTMENT,
        amountPi: toPi(withdrawal.amountPi),
        description: 'Withdrawal payout failed — balance restored',
      });
      await tx.withdrawalRequest.update({
        where: { id },
        data: { status: WithdrawalStatus.REQUESTED, adminNote: adminNote('payout_failed', error) },
      });
    });
    await audit(actor, 'withdrawal:failed', id, { error });
    return { outcome: 'failed', error };
  }

  const paid = await prisma.withdrawalRequest.update({
    where: { id },
    data: {
      status: WithdrawalStatus.PAID,
      txid: payout.txid,
      piPaymentId: payout.piPaymentId,
      // Record where the Pi actually went — Pi chose the wallet, not us.
      walletAddress: payout.toAddress ?? withdrawal.walletAddress,
      processedAt: new Date(),
    },
  });
  await audit(actor, 'withdrawal:paid', id, { txid: payout.txid });
  await notify(withdrawal.userId, 'payout_sent', null, { amount: money(withdrawal.amountPi) });
  return { outcome: 'paid', withdrawal: paid };
}

/**
 * After a job is confirmed (or auto-released): send the master's balance to
 * their Pi wallet straight away instead of waiting for them to ask.
 *
 * No wallet address is needed: an App-to-User payment is addressed by the
 * pioneer's Pi uid and Pi itself picks their wallet. Requiring the address —
 * which Pi only sometimes reports at sign-in — silently skipped every payout
 * for a master whose sign-in did not carry it.
 *
 * When it does not pay, it says why in the log. Skipping quietly is how three
 * confirmed jobs went unpaid without a single line anywhere. The money is on
 * the balance in every one of those cases and can still be withdrawn by hand.
 */
export async function autoPayoutAfterRelease(masterId: string, orderId: string | null): Promise<void> {
  const settings = await getSettings();
  const skip = (reason: string) => {
    logger.info('Automatic payout skipped', { masterId, orderId, reason });
  };
  if (!settings.autoPayoutOnRelease) return skip('switched off in the settings');
  if (!env.payoutsConfigured) return skip('payouts are not configured');

  const user = await prisma.user.findUnique({
    where: { id: masterId },
    select: { balancePi: true, walletAddress: true, kycVerified: true },
  });
  if (!user) return skip('no such user');
  if (payoutsRequireKyc() && !user.kycVerified) return skip('KYC required');
  if (!toPi(user.balancePi).greaterThan(0)) return skip('nothing on the balance');

  const open = await prisma.withdrawalRequest.count({
    where: { userId: masterId, status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } },
  });
  if (open > 0) return skip('a withdrawal is already open');

  const request = await prisma.withdrawalRequest.create({
    data: {
      userId: masterId,
      amountPi: toPi(user.balancePi),
      walletAddress: user.walletAddress,
      adminNote: adminNote('auto_paid'),
    },
  });

  try {
    const result = await executeWithdrawal(request.id, 'system:auto-payout');
    logger.info('Automatic payout', { orderId, masterId, outcome: result.outcome });
  } catch (error) {
    // The request stays REQUESTED with the balance intact; the admin can pay it.
    logger.error('Automatic payout could not start', { orderId, masterId, error: (error as Error).message });
  }
}

/**
 * Catches up balances earned while automatic payout could not run — payouts
 * not yet configured, or the wallet-address requirement that skipped them.
 * Runs from the sweep: masters with something earned on their balance and no
 * payout open get one, a few per round.
 */
export async function payOutstandingBalances(limit = 5): Promise<number> {
  const settings = await getSettings();
  if (!settings.autoPayoutOnRelease || !env.payoutsConfigured) return 0;

  const owed = await prisma.user.findMany({
    where: {
      balancePi: { gt: 0 },
      isBlocked: false,
      transactions: { some: { type: TransactionType.JOB_EARNING } },
      withdrawals: { none: { status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } } },
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  for (const user of owed) {
    await autoPayoutAfterRelease(user.id, null);
  }
  return owed.length;
}
