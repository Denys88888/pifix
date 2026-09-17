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
  /**
   * The transfer was submitted but its outcome is unknown (the connection
   * dropped, Horizon timed out). The Pi may already be in the recipient's
   * wallet, so the caller must NOT hand the amount back — a human has to check.
   */
  uncertain?: boolean;
}

/**
 * One App→User payout at a time, across every instance.
 *
 * Each payout starts by clearing Pi's dangling server payments, and that step
 * cancels anything without a txid — including a payout another request created
 * a moment earlier and is about to sign. A lease row in system_state (the same
 * pattern as the escrow sweep) keeps them apart. The lease outlives the
 * Stellar transaction timeout, so a crashed holder frees it on its own.
 */
const A2U_LOCK_KEY = 'a2u_payout_lock';
const A2U_LEASE_MS = 5 * 60 * 1000;

async function acquireA2uLock(): Promise<string | null> {
  const now = Date.now();
  const lease = String(now + A2U_LEASE_MS);
  const claimed = await prisma.$executeRaw`
    UPDATE system_state
       SET value = ${lease}, "updatedAt" = NOW()
     WHERE key = ${A2U_LOCK_KEY}
       AND value ~ '^[0-9]+$'
       AND value::bigint < ${now}::bigint
  `;
  if (claimed > 0) return lease;
  const created = await prisma.systemState
    .create({ data: { key: A2U_LOCK_KEY, value: lease } })
    .catch(() => null);
  return created ? lease : null;
}

async function releaseA2uLock(lease: string): Promise<void> {
  await prisma.systemState
    .updateMany({ where: { key: A2U_LOCK_KEY, value: lease }, data: { value: '0' } })
    .catch((error) => logger.warn('Could not release the payout lock', { error: (error as Error).message }));
}

async function withA2uLock<T>(waitMs: number, fn: () => Promise<T>): Promise<T | null> {
  const deadline = Date.now() + waitMs;
  let lease = await acquireA2uLock();
  while (!lease && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    lease = await acquireA2uLock();
  }
  if (!lease) return null;
  try {
    return await fn();
  } finally {
    await releaseA2uLock(lease);
  }
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

interface SendPayoutParams {
  userId: string;
  piUid: string;
  amount: string;
  memo: string;
  type: PaymentType;
  orderId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function sendPayout(params: SendPayoutParams): Promise<PayoutResult> {
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

  const result = await withA2uLock(30_000, () => runPayout(params, amount));
  // Nothing was created or signed while waiting, so the caller may safely
  // restore the balance and let the admin try again.
  return result ?? { ok: false, error: 'payout_busy' };
}

async function runPayout(params: SendPayoutParams, amount: Prisma.Decimal): Promise<PayoutResult> {
  let piPaymentId: string | undefined;

  try {
    await clearIncompleteUnlocked();

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

    let txid: string;
    try {
      txid = await submitStellarPayment({
        destination: created.to_address,
        amount: money(amount),
        memoText: created.identifier,
      });
    } catch (error) {
      if (!(error instanceof SubmitOutcomeUnknown)) throw error;

      // The request left this server and no clear answer came back. Treating
      // that as "nothing moved" is how a payout gets paid twice: the caller
      // restores the balance while the Pi is already in the wallet. Ask the
      // ledger instead — the memo is the Pi payment identifier.
      const found = await findOnChainByMemo(created.identifier);
      if (!found) {
        const note = `Submitted, outcome unknown: ${error.message}`.slice(0, 500);
        await prisma.payment
          .update({ where: { id: payment.id }, data: { status: PaymentStatus.ERROR, errorText: note } })
          .catch(() => undefined);
        logger.error('Payout outcome unknown — balance must not be restored until checked', {
          userId: params.userId,
          piPaymentId: created.identifier,
          amount: money(amount),
        });
        return { ok: false, uncertain: true, error: 'payout_unconfirmed', piPaymentId: created.identifier };
      }
      logger.warn('Payout submit reported an error but the transfer is on the ledger', {
        piPaymentId: created.identifier,
        txid: found,
      });
      txid = found;
    }

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
  try {
    const result = await server.submitTransaction(transaction);
    return result.hash;
  } catch (error) {
    // Horizon answers 400 only when it rejected the transaction outright
    // (bad sequence, underfunded, malformed) — then nothing moved. Anything
    // else, a 504 or a dropped connection, may still have been applied.
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 400) throw error;
    throw new SubmitOutcomeUnknown((error as Error).message);
  }
}

class SubmitOutcomeUnknown extends Error {}

/**
 * Looks for a successful app-wallet transaction carrying this memo. Polled a
 * few times because a transaction Horizon timed out on can still be sitting in
 * the queue and land seconds later.
 */
async function findOnChainByMemo(memo: string, attempts = 4): Promise<string | null> {
  const account = appKeypair().publicKey();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
    try {
      const page = await horizon().transactions().forAccount(account).order('desc').limit(50).call();
      const hit = page.records.find((record) => record.memo === memo && record.successful);
      if (hit) return hit.hash;
    } catch (error) {
      logger.warn('Ledger lookup failed', { memo, error: (error as Error).message });
    }
  }
  return null;
}

/**
 * Pi refuses to create a new A2U payment while an old one is dangling.
 * Finish the ones that already hit the chain, cancel the rest.
 */
export async function clearIncompleteServerPayments(): Promise<void> {
  // No waiting: if a payout holds the lock it is clearing them itself.
  await withA2uLock(0, clearIncompleteUnlocked);
}

async function clearIncompleteUnlocked(): Promise<void> {
  const incomplete = await getIncompleteServerPayments().catch((error) => {
    logger.warn('Could not list incomplete server payments', { error: (error as Error).message });
    return [];
  });

  for (const payment of incomplete) {
    try {
      // Pi only knows a txid once somebody reported it. A payout whose submit
      // ended without an answer has none, yet its Pi may have moved — so the
      // ledger is asked before anything is cancelled.
      const txid = payment.transaction?.txid ?? (await findOnChainByMemo(payment.identifier, 1));
      if (txid) {
        await completePayment(payment.identifier, txid);
        await prisma.payment.updateMany({
          where: { piPaymentId: payment.identifier },
          data: {
            status: PaymentStatus.COMPLETED,
            txid,
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
