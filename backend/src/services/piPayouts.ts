import * as StellarSdk from 'stellar-sdk';
import { PaymentDirection, PaymentStatus, Prisma, type PaymentType } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { money, toPi } from '../lib/money';
import { serverError } from '../lib/errors';
import { completePayment, createA2UPayment, getIncompleteServerPayments, cancelPayment } from './piApi';

/**
 * App→User payments.
 *
 * Pi's A2U flow is three-legged and can only run server-side:
 *   1. POST /v2/payments                    → payment identifier + recipient address
 *   2. sign a Stellar payment with the app wallet seed, memo = identifier, submit
 *   3. POST /v2/payments/{id}/complete      → { txid }
 *
 * `Pi.createPayment` (the SDK call) is user→app only, so escrow releases,
 * withdrawals and referral bonuses all go through here.
 */

export interface PayoutResult {
  ok: boolean;
  txid?: string;
  piPaymentId?: string;
  error?: string;
}

function horizon(): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(env.PI_HORIZON_URL);
}

function appKeypair(): StellarSdk.Keypair {
  if (!env.PI_WALLET_PRIVATE_SEED) {
    throw serverError('payouts_not_configured', 'PI_WALLET_PRIVATE_SEED is not set');
  }
  return StellarSdk.Keypair.fromSecret(env.PI_WALLET_PRIVATE_SEED.trim());
}

/**
 * Sends `amount` Pi to `uid`'s wallet and records the payment row.
 * Never throws: a failed payout must not roll back the balance bookkeeping that
 * already credited the user — the admin can retry from the withdrawal screen.
 */
/**
 * Whether a payout recipient must have passed KYC. Exported so the withdrawal
 * form can refuse early, on the same rule the money gate below applies — one
 * definition, so the two can never drift into telling the user different things.
 */
export function payoutsRequireKyc(): boolean {
  return env.piNetwork === 'mainnet' || env.REQUIRE_KYC;
}

export async function sendPayout(params: {
  userId: string;
  piUid: string;
  amount: string;
  memo: string;
  type: PaymentType;
  orderId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PayoutResult> {
  const amount = toPi(params.amount);

  if (!amount.greaterThan(0)) {
    return { ok: false, error: 'amount_not_positive' };
  }
  if (!env.payoutsConfigured) {
    logger.warn('Payout skipped — payouts are disabled or the wallet seed is missing', {
      userId: params.userId,
      amount: money(amount),
    });
    return { ok: false, error: 'payouts_disabled' };
  }

  /*
   * The authoritative KYC gate: every path that moves Pi out of the app goes
   * through here, so it is the one place the check cannot be forgotten.
   *
   * Mainnet always requires it. On Testnet it follows REQUIRE_KYC, because the
   * sandbox does not issue a real status and hard-requiring it would make
   * payouts untestable.
   *
   * `kycVerified` is refreshed from GET /me at every sign-in, so a master who
   * passed KYC after their last session reads as unverified here. Refusing is
   * the safe direction, and re-opening the app clears it — which is what the
   * error tells them to do.
   */
  if (payoutsRequireKyc()) {
    const recipient = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { kycVerified: true },
    });
    if (!recipient?.kycVerified) {
      logger.warn('Payout refused — recipient has not passed KYC', {
        userId: params.userId,
        amount: money(amount),
      });
      return { ok: false, error: 'kyc_required' };
    }
  }

  let piPaymentId: string | undefined;

  try {
    await clearIncompleteServerPayments();

    const created = await createA2UPayment({
      amount: money(amount),
      memo: params.memo,
      metadata: { ...(params.metadata ?? {}), orderId: params.orderId ?? null, type: params.type },
      uid: params.piUid,
    });
    piPaymentId = created.identifier;

    const payment = await prisma.payment.create({
      data: {
        piPaymentId: created.identifier,
        userId: params.userId,
        type: params.type,
        direction: PaymentDirection.A2U,
        status: PaymentStatus.APPROVED,
        amountPi: amount,
        memo: params.memo.slice(0, 200),
        orderId: params.orderId ?? null,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
        approvedAt: new Date(),
      },
    });

    const txid = await submitStellarPayment({
      destination: created.to_address,
      amount: money(amount),
      memoText: created.identifier,
    });

    // ─── Point of no return: the Pi has left the app wallet. ───
    // Everything below is bookkeeping. It must never turn into `ok: false`,
    // because the caller answers a failed payout by crediting the balance back
    // (see payWithdrawal) — which for money that is already on-chain pays the
    // user twice. Persist the txid first so a crash here is still recoverable.
    await prisma.payment
      .update({ where: { id: payment.id }, data: { txid } })
      .catch((error) =>
        logger.error('Payout is on-chain but the txid could not be stored', {
          piPaymentId: created.identifier,
          txid,
          error: (error as Error).message,
        }),
      );

    try {
      await completePayment(created.identifier, txid);
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.COMPLETED, completedAt: new Date() },
      });
    } catch (error) {
      // Pi has not been told the payment landed. The row stays APPROVED with a
      // txid, which is exactly the shape clearIncompleteServerPayments() picks
      // up and completes on the next payout.
      logger.error('Payout landed on-chain but could not be completed — will reconcile', {
        userId: params.userId,
        piPaymentId: created.identifier,
        txid,
        error: (error as Error).message,
      });
    }

    logger.info('Payout completed', { userId: params.userId, amount: money(amount), txid });
    return { ok: true, txid, piPaymentId: created.identifier };
  } catch (error) {
    // Only reachable before the Stellar submit, so no Pi has moved and the
    // caller is safe to restore the balance.
    const message = (error as Error).message;
    logger.error('Payout failed before any Pi moved', {
      userId: params.userId,
      amount: money(amount),
      piPaymentId,
      error: message,
    });
    if (piPaymentId) {
      await prisma.payment
        .updateMany({
          where: { piPaymentId },
          data: { status: PaymentStatus.ERROR, errorText: message.slice(0, 500) },
        })
        .catch(() => undefined);
    }
    return { ok: false, error: message, piPaymentId };
  }
}

async function submitStellarPayment(params: {
  destination: string;
  amount: string;
  memoText: string;
}): Promise<string> {
  const server = horizon();
  const keypair = appKeypair();
  const account = await server.loadAccount(keypair.publicKey());
  const baseFee = await server.fetchBaseFee().catch(() => 100_000);

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: String(baseFee),
    networkPassphrase: env.PI_NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: params.destination,
        asset: StellarSdk.Asset.native(),
        amount: params.amount,
      }),
    )
    // Pi requires the payment identifier as the transaction memo.
    .addMemo(StellarSdk.Memo.text(params.memoText))
    .setTimeout(180)
    .build();

  transaction.sign(keypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

/**
 * Pi refuses to create a new A2U payment while an old one is dangling.
 * Finish the ones that already hit the chain, cancel the rest.
 */
export async function clearIncompleteServerPayments(): Promise<void> {
  const incomplete = await getIncompleteServerPayments().catch((error) => {
    logger.warn('Could not list incomplete server payments', { error: (error as Error).message });
    return [];
  });

  for (const payment of incomplete) {
    try {
      if (payment.transaction?.txid) {
        await completePayment(payment.identifier, payment.transaction.txid);
        await prisma.payment.updateMany({
          where: { piPaymentId: payment.identifier },
          data: {
            status: PaymentStatus.COMPLETED,
            txid: payment.transaction.txid,
            completedAt: new Date(),
          },
        });
        logger.info('Recovered dangling A2U payment', { piPaymentId: payment.identifier });
      } else {
        await cancelPayment(payment.identifier);
        await prisma.payment.updateMany({
          where: { piPaymentId: payment.identifier },
          data: { status: PaymentStatus.CANCELLED, cancelledAt: new Date() },
        });
        logger.info('Cancelled dangling A2U payment', { piPaymentId: payment.identifier });
      }
    } catch (error) {
      logger.error('Could not clear dangling A2U payment', {
        piPaymentId: payment.identifier,
        error: (error as Error).message,
      });
    }
  }
}
