import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toPi } from '../lib/money';
import { badRequest } from '../lib/errors';

type Tx = Prisma.TransactionClient;

/**
 * Every balance movement goes through here so `users.balancePi` and the
 * `transactions` audit trail can never drift apart. Amounts are signed:
 * positive credits the user, negative debits.
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

  const user = await tx.user.findUnique({
    where: { id: params.userId },
    select: { balancePi: true },
  });
  if (!user) throw badRequest('user_not_found', 'User not found');

  const balanceAfter = toPi(user.balancePi.add(amount));

  if (params.requireFunds && balanceAfter.lessThan(0)) {
    throw badRequest('insufficient_balance', 'Insufficient balance');
  }

  await tx.user.update({
    where: { id: params.userId },
    data: {
      balancePi: balanceAfter,
      ...(params.countsAsEarning && amount.greaterThan(0)
        ? { totalEarnedPi: { increment: amount } }
        : {}),
    },
  });

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
