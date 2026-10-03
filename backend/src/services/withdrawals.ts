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
      description: `Withdrawal to ${withdrawal.walletAddress.slice(0, 8)}…`,
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
    data: { status: WithdrawalStatus.PAID, txid: payout.txid, piPaymentId: payout.piPaymentId, processedAt: new Date() },
  });
  await audit(actor, 'withdrawal:paid', id, { txid: payout.txid });
  await notify(withdrawal.userId, 'payout_sent', null, { amount: money(withdrawal.amountPi) });
  return { outcome: 'paid', withdrawal: paid };
}

/**
 * After a job is confirmed (or auto-released): send the master's balance to
 * their Pi wallet straight away instead of waiting for them to ask.
 *
 * Quietly does nothing when it cannot pay — payouts switched off, no wallet on
 * file, KYC still missing where it is required, a payout already in progress.
 * The money is on the balance in every one of those cases, exactly as before,
 * and can still be withdrawn by hand.
 */
export async function autoPayoutAfterRelease(masterId: string, orderId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoPayoutOnRelease || !env.payoutsConfigured) return;

  const user = await prisma.user.findUnique({
    where: { id: masterId },
    select: { balancePi: true, walletAddress: true, kycVerified: true },
  });
  if (!user?.walletAddress) return;
  if (payoutsRequireKyc() && !user.kycVerified) return;
  if (!toPi(user.balancePi).greaterThan(0)) return;

  const open = await prisma.withdrawalRequest.count({
    where: { userId: masterId, status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } },
  });
  if (open > 0) return;

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
    logger.info('Automatic payout after confirmation', { orderId, masterId, outcome: result.outcome });
  } catch (error) {
    // The request stays REQUESTED with the balance intact; the admin can pay it.
    logger.error('Automatic payout could not start', { orderId, masterId, error: (error as Error).message });
  }
}
