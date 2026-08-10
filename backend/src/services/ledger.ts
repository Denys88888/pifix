import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toPi } from '../lib/money';
import { badRequest } from '../lib/errors';

type Tx = Prisma.TransactionClient;

/**
 * Every balance movement goes through here so `users.balancePi` and the
 * `transactions` audit trail can never drift apart. Amounts are signed:
 * positive credits the user, negative debits.
 *
 * Rows written here always carry `affectsBalance = true` (the column default).
 * Payments made from the user's Pi wallet — connect fees, escrow funding,
 * boost, subscription — are recorded elsewhere with `affectsBalance = false`,
 * because they never touch `balancePi` and would otherwise break the audit sum.
 */
export async function postTransaction(
  tx: Tx,
  params: {
    userId: string;
    type: TransactionType;
    amountPi: Prisma.Decimal.Value;
    description: string;
    orderId?: string | null;
    /** Also add the amount to lifetime earnings (job payouts and bonuses). */
    countsAsEarning?: boolean;
    /** Reject the debit when the balance would go negative. */
    requireFunds?: boolean;
  },
): Promise<{ balanceAfter: Prisma.Decimal }> {
  const amount = toPi(params.amountPi);

  // The arithmetic has to happen inside the UPDATE. Reading balancePi and
  // writing the computed total back is a lost-update race under Read Committed:
  // two concurrent movements read the same figure and the second overwrites the
  // first, so one of them vanishes while both leave a transaction row behind.
  // `increment` also row-locks the user for the rest of this transaction, which
  // is what makes the requireFunds check below trustworthy.
  let updated: { balancePi: Prisma.Decimal };
  try {
    updated = await tx.user.update({
      where: { id: params.userId },
      data: {
        balancePi: { increment: amount },
        ...(params.countsAsEarning && amount.greaterThan(0)
          ? { totalEarnedPi: { increment: amount } }
          : {}),
      },
      select: { balancePi: true },
    });
  } catch (error) {
    // Keep the old error contract: an unknown user is a 400, not a raw P2025.
    if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
      throw badRequest('user_not_found', 'User not found');
    }
    throw error;
  }

  const balanceAfter = toPi(updated.balancePi);

  // Checked after the write rather than before it: the row is locked from the
  // UPDATE above until this transaction ends, so nothing can slip a debit in
  // between. Throwing rolls the increment back with everything else.
  if (params.requireFunds && balanceAfter.lessThan(0)) {
    throw badRequest('insufficient_balance', 'Insufficient balance');
  }

  await tx.transaction.create({
    data: {
      userId: params.userId,
      type: params.type,
      amountPi: amount,
      balanceAfter,
      description: params.description.slice(0, 300),
      orderId: params.orderId ?? null,
    },
  });

  return { balanceAfter };
}

export async function getBalance(userId: string): Promise<Prisma.Decimal> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { balancePi: true } });
  return user?.balancePi ?? new Prisma.Decimal(0);
}
