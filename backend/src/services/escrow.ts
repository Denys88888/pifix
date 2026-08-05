import {
  EscrowStatus,
  OrderStatus,
  Prisma,
  ResponseStatus,
  TransactionType,
  WithdrawalStatus,
  type Order,
  type PlatformSettings,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { D, money, percentOf, sum, toPi } from '../lib/money';
import { badRequest, conflict, notFound } from '../lib/errors';
import { getSettings } from './settings';
import { postTransaction } from './ledger';
import { payReferralBonuses } from './referral';

export interface OrderCharges {
  /** Held for the master. */
  escrowAmountPi: Prisma.Decimal;
  /** Platform commission paid on top of the budget by the client. */
  clientFeePi: Prisma.Decimal;
  expressFeePi: Prisma.Decimal;
  /** What the client actually pays: budget + commission + express. */
  totalPi: Prisma.Decimal;
  /** Optional cut deducted from the master's payout (0 by default). */
  masterFeePi: Prisma.Decimal;
  /** What lands on the master's balance on release. */
  masterPayoutPi: Prisma.Decimal;
}

/**
 * Single source of truth for "how much does this order cost".
 * Used by the quote endpoint, by payment approval (to reject tampered amounts)
 * and by the escrow bookkeeping — they must never disagree.
 */
export function computeOrderCharges(
  settings: PlatformSettings,
  budgetPi: Prisma.Decimal.Value,
  isUrgent: boolean,
): OrderCharges {
  const escrowAmountPi = toPi(budgetPi);
  const clientFeePi = percentOf(escrowAmountPi, settings.clientFeePercent);
  const expressFeePi = isUrgent ? toPi(settings.expressFeePi) : D(0);
  const totalPi = sum(escrowAmountPi, clientFeePi, expressFeePi);
  const masterFeePi = percentOf(escrowAmountPi, settings.masterFeePercent);
  const masterPayoutPi = toPi(escrowAmountPi.sub(masterFeePi));

  return { escrowAmountPi, clientFeePi, expressFeePi, totalPi, masterFeePi, masterPayoutPi };
}

/**
 * Funds the escrow after a client's ESCROW payment was verified on the Pi API.
 * Runs in one database transaction: selecting a master and freezing the money
 * must either both happen or neither.
 */
export async function fundEscrow(params: {
  orderId: string;
  responseId: string;
  clientId: string;
  piPaymentId: string;
  paidAmountPi: Prisma.Decimal;
}): Promise<Order> {
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: { responses: { where: { id: params.responseId } } },
    });

    if (!order) throw notFound('order_not_found', 'Order not found');
    if (order.clientId !== params.clientId) {
      throw badRequest('not_your_order', 'Only the client who published the order can pay for it');
    }
    if (order.status !== OrderStatus.OPEN) {
      throw conflict('order_not_open', 'This order is no longer open');
    }
    if (order.escrowStatus !== EscrowStatus.NONE) {
      throw conflict('escrow_already_funded', 'The escrow for this order is already funded');
    }

    const response = order.responses[0];
    if (!response) throw notFound('response_not_found', 'Response not found');
    if (response.status !== ResponseStatus.ACTIVE) {
      throw conflict('response_not_active', 'This response is no longer active');
    }

    const charges = computeOrderCharges(settings, response.pricePi, order.isUrgent);

    // The Pi payment amount is authoritative — it is what the user actually signed.
    if (!toPi(params.paidAmountPi).equals(charges.totalPi)) {
      throw badRequest(
        'amount_mismatch',
        `Paid ${money(params.paidAmountPi)} Pi but the order costs ${money(charges.totalPi)} Pi`,
      );
    }

    const autoReleaseAt = new Date(Date.now() + settings.escrowTimeoutDays * 24 * 60 * 60 * 1000);

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.IN_PROGRESS,
        masterId: response.masterId,
        selectedResponseId: response.id,
        escrowStatus: EscrowStatus.FUNDED,
        escrowAmountPi: charges.escrowAmountPi,
        clientFeePi: charges.clientFeePi,
        expressFeePi: charges.expressFeePi,
        totalPaidPi: charges.totalPi,
        masterFeePi: charges.masterFeePi,
        masterPayoutPi: charges.masterPayoutPi,
        escrowPaymentId: params.piPaymentId,
        autoReleaseAt,
      },
    });

    await tx.response.update({ where: { id: response.id }, data: { status: ResponseStatus.SELECTED } });
    await tx.response.updateMany({
      where: { orderId: order.id, id: { not: response.id }, status: ResponseStatus.ACTIVE },
      data: { status: ResponseStatus.REJECTED },
    });

    // History only: the client paid from their Pi wallet, so the internal
    // balance is untouched and this row must stay out of the audit sum.
    await tx.transaction.create({
      data: {
        userId: params.clientId,
        type: TransactionType.ESCROW_FUNDED,
        amountPi: toPi(charges.totalPi).negated(),
        balanceAfter: (await tx.user.findUniqueOrThrow({
          where: { id: params.clientId },
          select: { balancePi: true },
        })).balancePi,
        description: `Escrow funded for job #${order.publicId}`,
        orderId: order.id,
        affectsBalance: false,
      },
    });

    logger.info('Escrow funded', {
      orderId: order.id,
      publicId: order.publicId,
      total: money(charges.totalPi),
      masterPayout: money(charges.masterPayoutPi),
    });

    return updated;
  });
}

export type ReleaseReason = 'client_confirmed' | 'auto_release' | 'admin_release';

/**
 * Releases the escrow to the master's withdrawable balance.
 * Idempotent: a second call on an already-released order is a no-op.
 */
export async function releaseEscrow(orderId: string, reason: ReleaseReason): Promise<Order | null> {
  const settings = await getSettings();

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('order_not_found', 'Order not found');
    if (order.escrowStatus !== EscrowStatus.FUNDED) return null; // already settled
    if (!order.masterId) throw conflict('no_master', 'The order has no assigned master');

    await postTransaction(tx, {
      userId: order.masterId,
      type: TransactionType.JOB_EARNING,
      amountPi: order.masterPayoutPi,
      description: `Payout for job #${order.publicId}`,
      orderId: order.id,
      countsAsEarning: true,
    });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.COMPLETED,
        escrowStatus: EscrowStatus.RELEASED,
        confirmedAt: new Date(),
      },
    });

    await tx.masterProfile.updateMany({
      where: { userId: order.masterId },
      data: { completedJobs: { increment: 1 } },
    });

    return updated;
  });

  if (!result) return null;

  logger.info('Escrow released', { orderId, reason, amount: money(result.masterPayoutPi) });

  // Post-settlement side effects run outside the transaction: a failure here
  // must not undo a completed job.
  await payReferralBonuses(result.masterId!).catch((error) =>
    logger.error('Referral bonus failed', { orderId, error: (error as Error).message }),
  );
  await payReferralBonuses(result.clientId).catch((error) =>
    logger.error('Referral bonus failed', { orderId, error: (error as Error).message }),
  );
  await maybeAutoWithdraw(result.masterId!, settings).catch((error) =>
    logger.error('Auto-withdrawal failed', { orderId, error: (error as Error).message }),
  );

  return result;
}

/** Refunds a funded escrow back to the client's balance (dispute resolution). */
export async function refundEscrow(orderId: string, refundFees: boolean): Promise<Order | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('order_not_found', 'Order not found');
    if (order.escrowStatus !== EscrowStatus.FUNDED) return null;

    const amount = refundFees ? toPi(order.totalPaidPi) : toPi(order.escrowAmountPi);

    await postTransaction(tx, {
      userId: order.clientId,
      type: TransactionType.ESCROW_REFUNDED,
      amountPi: amount,
      description: `Refund for job #${order.publicId}`,
      orderId: order.id,
    });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        escrowStatus: EscrowStatus.REFUNDED,
        cancelledAt: new Date(),
      },
    });

    logger.info('Escrow refunded', { orderId, amount: money(amount), refundFees });
    return updated;
  });
}

/**
 * Releases every escrow whose confirmation window has expired.
 * Driven by the lazy sweep (user traffic), the internal cron and
 * POST /api/cron/auto-release — all three are safe to run concurrently
 * because releaseEscrow() is idempotent.
 */
export async function autoReleaseExpiredEscrows(limit = 50): Promise<number> {
  const due = await prisma.order.findMany({
    where: {
      escrowStatus: EscrowStatus.FUNDED,
      autoReleaseAt: { lte: new Date() },
      status: { in: [OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_CONFIRMATION] },
    },
    select: { id: true, publicId: true },
    take: limit,
    orderBy: { autoReleaseAt: 'asc' },
  });

  let released = 0;
  for (const order of due) {
    try {
      const result = await releaseEscrow(order.id, 'auto_release');
      if (result) released += 1;
    } catch (error) {
      logger.error('Auto-release failed', { orderId: order.id, error: (error as Error).message });
    }
  }

  if (released > 0) logger.info(`Auto-released ${released} escrow(s)`);
  return released;
}

const SWEEP_KEY = 'escrow_sweep_at';

/**
 * Lazy sweep hooked into normal API traffic, so the platform keeps settling
 * even when the external cron is down. Throttled through a database row so
 * concurrent instances on Render do not each run their own sweep.
 */
export async function lazySweep(intervalSeconds: number): Promise<void> {
  const now = Date.now();
  const state = await prisma.systemState.findUnique({ where: { key: SWEEP_KEY } });
  const last = state ? Number(state.value) : 0;
  if (Number.isFinite(last) && now - last < intervalSeconds * 1000) return;

  await prisma.systemState.upsert({
    where: { key: SWEEP_KEY },
    update: { value: String(now) },
    create: { key: SWEEP_KEY, value: String(now) },
  });

  await autoReleaseExpiredEscrows().catch((error) =>
    logger.error('Lazy sweep failed', { error: (error as Error).message }),
  );
}

/** Opens a withdrawal request automatically once the balance crosses the threshold. */
async function maybeAutoWithdraw(userId: string, settings: PlatformSettings): Promise<void> {
  const threshold = toPi(settings.autoWithdrawalPi);
  if (!threshold.greaterThan(0)) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balancePi: true, walletAddress: true },
  });
  if (!user?.walletAddress) return;
  if (user.balancePi.lessThan(threshold)) return;

  const pending = await prisma.withdrawalRequest.count({
    where: { userId, status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } },
  });
  if (pending > 0) return;

  await prisma.withdrawalRequest.create({
    data: {
      userId,
      amountPi: toPi(user.balancePi),
      walletAddress: user.walletAddress,
      adminNote: 'Created automatically (auto_withdrawal_pi threshold reached)',
    },
  });
  logger.info('Auto-withdrawal request created', { userId, amount: money(user.balancePi) });
}
