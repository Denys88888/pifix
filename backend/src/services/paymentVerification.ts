import {
  OrderStatus,
  PaymentDirection,
  PaymentStatus,
  PaymentType,
  Prisma,
  ResponseStatus,
  TransactionType,
  VerificationStatus,
  type User,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { money, toPi } from '../lib/money';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { approvePayment, cancelPayment, completePayment, getPayment, type PiPaymentDTO } from './piApi';
import { getSettings } from './settings';
import { computeOrderCharges, fundEscrow } from './escrow';
import { postTransaction } from './ledger';

/**
 * Payment metadata is written by the client, so it is treated as UNTRUSTED
 * input: every field is re-validated against the database, and the amount is
 * always taken from the Pi payment record (what the user actually signed),
 * never from the request body.
 */
const metadataSchema = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('CONNECT'),
    orderId: z.string().uuid(),
    pricePi: z.union([z.string(), z.number()]),
    message: z.string().max(500).default(''),
  }),
  z.object({
    purpose: z.literal('ESCROW'),
    orderId: z.string().uuid(),
    responseId: z.string().uuid(),
  }),
  z.object({ purpose: z.literal('BOOST') }),
  z.object({ purpose: z.literal('SUBSCRIPTION') }),
]);

export type PaymentIntent = z.infer<typeof metadataSchema>;

const PURPOSE_TO_TYPE: Record<PaymentIntent['purpose'], PaymentType> = {
  CONNECT: PaymentType.CONNECT,
  ESCROW: PaymentType.ESCROW,
  BOOST: PaymentType.BOOST,
  SUBSCRIPTION: PaymentType.SUBSCRIPTION,
};

function parseIntent(payment: PiPaymentDTO): PaymentIntent {
  const parsed = metadataSchema.safeParse(payment.metadata);
  if (!parsed.success) {
    throw badRequest('invalid_payment_metadata', 'Payment metadata is malformed', parsed.error.flatten());
  }
  return parsed.data;
}

/** Guards against a user approving a payment that belongs to somebody else. */
function assertOwnership(payment: PiPaymentDTO, user: User): void {
  if (payment.user_uid !== user.piUid) {
    throw forbidden('payment_owner_mismatch', 'This payment belongs to another user');
  }
  if (payment.direction !== 'user_to_app') {
    throw badRequest('wrong_direction', 'Only user-to-app payments can be approved here');
  }
}

/** The exact amount this intent is allowed to charge, recomputed from the database. */
async function expectedAmount(intent: PaymentIntent, user: User): Promise<Prisma.Decimal> {
  const settings = await getSettings();

  switch (intent.purpose) {
    case 'CONNECT':
      return toPi(settings.connectPricePi);
    case 'BOOST':
      return toPi(settings.profileBoostPricePi);
    case 'SUBSCRIPTION':
      return toPi(settings.proSubscriptionPricePi);
    case 'ESCROW': {
      const order = await prisma.order.findUnique({
        where: { id: intent.orderId },
        include: { responses: { where: { id: intent.responseId } } },
      });
      if (!order) throw notFound('order_not_found', 'Order not found');
      if (order.clientId !== user.id) throw forbidden('not_your_order', 'This is not your order');
      const response = order.responses[0];
      if (!response) throw notFound('response_not_found', 'Response not found');
      return computeOrderCharges(settings, response.pricePi, order.isUrgent).totalPi;
    }
  }
}

/** Business rules that must hold both at approval time and at execution time. */
async function assertIntentAllowed(intent: PaymentIntent, user: User): Promise<void> {
  const settings = await getSettings();

  if (user.isBlocked) throw forbidden('user_blocked', 'This account is blocked');

  switch (intent.purpose) {
    case 'CONNECT': {
      const profile = await prisma.masterProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw badRequest('no_master_profile', 'Create a master profile first');
      if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
        throw forbidden('master_not_verified', 'Your master profile is not verified yet');
      }

      const order = await prisma.order.findUnique({ where: { id: intent.orderId } });
      if (!order) throw notFound('order_not_found', 'Order not found');
      if (order.status !== OrderStatus.OPEN) throw conflict('order_not_open', 'This order is no longer open');
      if (order.clientId === user.id) {
        throw badRequest('own_order', 'You cannot respond to your own order');
      }

      const existing = await prisma.response.findUnique({
        where: { orderId_masterId: { orderId: order.id, masterId: user.id } },
      });
      if (existing) throw conflict('already_responded', 'You have already responded to this order');

      const activeResponses = await prisma.response.count({
        where: { masterId: user.id, status: ResponseStatus.ACTIVE },
      });
      if (activeResponses >= settings.maxActiveResponsesPerMaster) {
        throw conflict(
          'response_limit_reached',
          `You already have ${settings.maxActiveResponsesPerMaster} active responses`,
        );
      }

      const price = toPi(intent.pricePi);
      if (!price.greaterThanOrEqualTo(settings.minBudgetPi)) {
        throw badRequest('price_too_low', `The offered price must be at least ${money(settings.minBudgetPi)} Pi`);
      }
      break;
    }

    case 'ESCROW': {
      const order = await prisma.order.findUnique({ where: { id: intent.orderId } });
      if (!order) throw notFound('order_not_found', 'Order not found');
      if (order.clientId !== user.id) throw forbidden('not_your_order', 'This is not your order');
      if (order.status !== OrderStatus.OPEN) throw conflict('order_not_open', 'This order is no longer open');

      const response = await prisma.response.findUnique({ where: { id: intent.responseId } });
      if (!response || response.orderId !== order.id) {
        throw notFound('response_not_found', 'Response not found');
      }
      if (response.status !== ResponseStatus.ACTIVE) {
        throw conflict('response_not_active', 'This response is no longer active');
      }
      break;
    }

    case 'BOOST':
    case 'SUBSCRIPTION': {
      const profile = await prisma.masterProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw badRequest('no_master_profile', 'Create a master profile first');
      break;
    }
  }
}

/**
 * Server-side approval (onReadyForServerApproval).
 * Nothing is granted here — the payment is only allowed to proceed on-chain.
 */
export async function approveIncomingPayment(piPaymentId: string, user: User) {
  const piPayment = await getPayment(piPaymentId);
  assertOwnership(piPayment, user);

  if (piPayment.status.cancelled || piPayment.status.user_cancelled) {
    await markCancelled(piPaymentId);
    throw conflict('payment_cancelled', 'This payment was cancelled');
  }

  const intent = parseIntent(piPayment);
  await assertIntentAllowed(intent, user);

  const expected = await expectedAmount(intent, user);
  const paid = toPi(piPayment.amount);
  if (!paid.equals(expected)) {
    logger.warn('Payment amount mismatch — refusing approval', {
      piPaymentId,
      paid: money(paid),
      expected: money(expected),
    });
    throw badRequest('amount_mismatch', `Expected ${money(expected)} Pi but the payment is ${money(paid)} Pi`);
  }

  const record = await prisma.payment.upsert({
    where: { piPaymentId },
    update: { status: PaymentStatus.PENDING, amountPi: paid, metadata: intent as object },
    create: {
      piPaymentId,
      userId: user.id,
      type: PURPOSE_TO_TYPE[intent.purpose],
      direction: PaymentDirection.U2A,
      status: PaymentStatus.PENDING,
      amountPi: paid,
      memo: piPayment.memo?.slice(0, 200) ?? '',
      orderId: 'orderId' in intent ? intent.orderId : null,
      metadata: intent as object,
    },
  });

  if (!piPayment.status.developer_approved) {
    await approvePayment(piPaymentId);
  }

  await prisma.payment.update({
    where: { id: record.id },
    data: { status: PaymentStatus.APPROVED, approvedAt: new Date() },
  });

  logger.info('Payment approved', { piPaymentId, purpose: intent.purpose, amount: money(paid) });
  return { piPaymentId, status: PaymentStatus.APPROVED, amountPi: money(paid), purpose: intent.purpose };
}

/**
 * Server-side completion (onReadyForServerCompletion).
 * Completes on the Pi API, re-reads the payment to confirm the transaction was
 * verified, and only then grants the purchased thing.
 */
export async function completeIncomingPayment(piPaymentId: string, txid: string, user: User) {
  const existing = await prisma.payment.findUnique({ where: { piPaymentId } });

  if (existing?.status === PaymentStatus.COMPLETED) {
    // Pi may re-fire the callback; the grant already happened.
    return { piPaymentId, status: PaymentStatus.COMPLETED, alreadyProcessed: true };
  }

  let piPayment = await getPayment(piPaymentId);
  assertOwnership(piPayment, user);

  if (piPayment.status.cancelled || piPayment.status.user_cancelled) {
    await markCancelled(piPaymentId);
    throw conflict('payment_cancelled', 'This payment was cancelled');
  }

  if (!piPayment.status.developer_completed) {
    piPayment = await completePayment(piPaymentId, txid);
  }

  // Re-read the authoritative record instead of trusting the completion response.
  const verified = await getPayment(piPaymentId);
  if (!verified.status.transaction_verified || !verified.transaction?.txid) {
    throw badRequest('payment_not_verified', 'The Pi Platform has not verified this transaction yet');
  }

  const intent = parseIntent(verified);
  const amount = toPi(verified.amount);

  // Claim the payment before granting anything. The COMPLETED check at the top
  // of this function only rules out a *sequential* re-fire: between that read
  // and this write sit three Pi API round-trips, and two callbacks that arrive
  // inside that window both pass it. A plain `update` cannot separate them —
  // both would write COMPLETED and both would go on to executeIntent, which for
  // SUBSCRIPTION reads proUntil and extends it, handing out 60 days for one
  // payment, and for CONNECT creates a second response row.
  //
  // `updateMany` with the status in the WHERE clause makes the transition a
  // compare-and-swap: exactly one caller matches a row, the loser matches none.
  const claimed = await prisma.payment.updateMany({
    where: { piPaymentId, status: { not: PaymentStatus.COMPLETED } },
    data: {
      status: PaymentStatus.COMPLETED,
      txid: verified.transaction.txid,
      completedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    // Either a concurrent callback won the claim, or there is no payment row at
    // all — handleIncompletePayment() reaches here for payments this server
    // never approved, and that case has to keep answering 404 as it did when
    // this was an `update`.
    const current = await prisma.payment.findUnique({ where: { piPaymentId } });
    if (!current) throw notFound('payment_not_found', 'Payment not found');
    return { piPaymentId, status: PaymentStatus.COMPLETED, alreadyProcessed: true };
  }

  const result = await executeIntent(intent, user, piPaymentId, amount);

  logger.info('Payment completed', {
    piPaymentId,
    purpose: intent.purpose,
    amount: money(amount),
    txid: verified.transaction.txid,
  });

  return { piPaymentId, status: PaymentStatus.COMPLETED, purpose: intent.purpose, ...result };
}

/** Grants what the payment bought. Runs only after on-chain verification. */
async function executeIntent(
  intent: PaymentIntent,
  user: User,
  piPaymentId: string,
  amount: Prisma.Decimal,
): Promise<Record<string, unknown>> {
  const settings = await getSettings();

  switch (intent.purpose) {
    case 'CONNECT': {
      await assertIntentAllowed(intent, user);
      const response = await prisma.$transaction(async (tx) => {
        const created = await tx.response.create({
          data: {
            orderId: intent.orderId,
            masterId: user.id,
            pricePi: toPi(intent.pricePi),
            message: String(intent.message ?? '').slice(0, 500),
            status: ResponseStatus.ACTIVE,
            connectPaymentId: piPaymentId,
            connectPricePi: amount,
          },
        });
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: TransactionType.CONNECT_SPENT,
            amountPi: amount.negated(),
            balanceAfter: user.balancePi,
            description: 'Connect fee',
            orderId: intent.orderId,
            // Paid from the Pi wallet — history only, not a balance movement.
            affectsBalance: false,
          },
        });
        await tx.payment.update({ where: { piPaymentId }, data: { responseId: created.id } });
        return created;
      });
      return { responseId: response.id };
    }

    case 'ESCROW': {
      const order = await fundEscrow({
        orderId: intent.orderId,
        responseId: intent.responseId,
        clientId: user.id,
        piPaymentId,
        paidAmountPi: amount,
      });
      return { orderId: order.id, orderStatus: order.status };
    }

    case 'BOOST': {
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await prisma.masterProfile.update({ where: { userId: user.id }, data: { boostedUntil: until } });
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.BOOST,
          amountPi: amount.negated(),
          balanceAfter: user.balancePi,
          description: 'Profile boost (7 days)',
          affectsBalance: false,
        },
      });
      return { boostedUntil: until.toISOString() };
    }

    case 'SUBSCRIPTION': {
      const profile = await prisma.masterProfile.findUniqueOrThrow({ where: { userId: user.id } });
      const base = profile.proUntil && profile.proUntil > new Date() ? profile.proUntil : new Date();
      const until = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
      await prisma.masterProfile.update({ where: { userId: user.id }, data: { proUntil: until } });
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.SUBSCRIPTION,
          amountPi: amount.negated(),
          balanceAfter: user.balancePi,
          description: `PRO subscription (30 days, ${money(settings.proSubscriptionPricePi)} Pi)`,
          affectsBalance: false,
        },
      });
      return { proUntil: until.toISOString() };
    }
  }
}

/**
 * onIncompletePaymentFound → the SDK found a payment the app never finished.
 * If it already hit the chain we complete it (so the user is not charged for
 * nothing); otherwise we cancel it, which unblocks new payments for that user.
 */
export async function handleIncompletePayment(piPaymentId: string, user: User) {
  const piPayment = await getPayment(piPaymentId);
  assertOwnership(piPayment, user);

  if (piPayment.transaction?.txid && !piPayment.status.cancelled && !piPayment.status.user_cancelled) {
    try {
      const result = await completeIncomingPayment(piPaymentId, piPayment.transaction.txid, user);
      return { action: 'completed' as const, ...result };
    } catch (error) {
      logger.warn('Could not complete an incomplete payment, cancelling instead', {
        piPaymentId,
        error: (error as Error).message,
      });
    }
  }

  if (!piPayment.status.cancelled && !piPayment.status.user_cancelled) {
    await cancelPayment(piPaymentId).catch((error) =>
      logger.warn('Pi cancel failed', { piPaymentId, error: (error as Error).message }),
    );
  }
  await markCancelled(piPaymentId, user.id, piPayment);

  return { action: 'cancelled' as const, piPaymentId };
}

async function markCancelled(piPaymentId: string, userId?: string, piPayment?: PiPaymentDTO): Promise<void> {
  const existing = await prisma.payment.findUnique({ where: { piPaymentId } });
  if (existing) {
    await prisma.payment.update({
      where: { piPaymentId },
      data: { status: PaymentStatus.CANCELLED, cancelledAt: new Date() },
    });
    return;
  }
  if (userId && piPayment) {
    await prisma.payment.create({
      data: {
        piPaymentId,
        userId,
        type: PaymentType.CONNECT,
        direction: PaymentDirection.U2A,
        status: PaymentStatus.CANCELLED,
        amountPi: toPi(piPayment.amount),
        memo: piPayment.memo?.slice(0, 200) ?? '',
        cancelledAt: new Date(),
        metadata: (piPayment.metadata ?? {}) as object,
      },
    });
  }
}

/**
 * Refunds a connect fee to the master's balance.
 * Only used when the client deletes an order inside the refund window and
 * before any master was selected (policy 4.5).
 */
export async function refundConnect(responseId: string, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const response = await tx.response.findUnique({ where: { id: responseId } });
    if (!response) return;
    if (!toPi(response.connectPricePi).greaterThan(0)) return;

    // Claim the refund before crediting it. Reading connectRefunded here and
    // setting it at the end leaves a window where two callers — an order
    // cancellation racing an admin refund, say — both read false and both
    // credit the master. Moving the flag into the WHERE clause lets exactly one
    // of them match a row; the loser matches none and returns having done
    // nothing, which is what makes this function safe to call twice.
    const claimed = await tx.response.updateMany({
      where: { id: responseId, connectRefunded: false },
      data: { connectRefunded: true, status: ResponseStatus.WITHDRAWN },
    });
    if (claimed.count === 0) return;

    await postTransaction(tx, {
      userId: response.masterId,
      type: TransactionType.CONNECT_REFUNDED,
      amountPi: toPi(response.connectPricePi),
      description: reason.slice(0, 300),
      orderId: response.orderId,
    });
  });
}
