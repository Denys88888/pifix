import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { money, toPi } from '../lib/money';
import { getSettings } from './settings';
import { postTransaction } from './ledger';

/**
 * Pays the two-level referral bonus after a user's FIRST completed deal.
 * `referralBonusPaid` on the user is the idempotency guard, and it is flipped
 * inside the same transaction that credits the bonuses.
 */
export async function payReferralBonuses(userId: string): Promise<void> {
  const settings = await getSettings();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      referralBonusPaid: true,
      referrerId: true,
      referrer: { select: { id: true, username: true, isDeleted: true, referrerId: true } },
    },
  });

  if (!user || user.referralBonusPaid || !user.referrerId || !user.referrer) return;

  const directBonus = toPi(settings.referralBonusDirectPi);
  const indirectBonus = toPi(settings.referralBonusIndirectPi);

  const grandReferrer = user.referrer.referrerId
    ? await prisma.user.findUnique({
        where: { id: user.referrer.referrerId },
        select: { id: true, isDeleted: true },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    // Re-read under the transaction so two concurrent releases cannot both pay.
    const fresh = await tx.user.findUnique({
      where: { id: userId },
      select: { referralBonusPaid: true },
    });
    if (!fresh || fresh.referralBonusPaid) return;

    await tx.user.update({ where: { id: userId }, data: { referralBonusPaid: true } });

    if (directBonus.greaterThan(0) && !user.referrer!.isDeleted) {
      await postTransaction(tx, {
        userId: user.referrer!.id,
        type: TransactionType.REFERRAL_BONUS,
        amountPi: directBonus,
        description: `Referral bonus (level 1) for @${user.username}`,
        countsAsEarning: true,
      });
    }

    if (grandReferrer && !grandReferrer.isDeleted && indirectBonus.greaterThan(0)) {
      await postTransaction(tx, {
        userId: grandReferrer.id,
        type: TransactionType.REFERRAL_BONUS,
        amountPi: indirectBonus,
        description: `Referral bonus (level 2) for @${user.username}`,
        countsAsEarning: true,
      });
    }
  });

  logger.info('Referral bonuses paid', {
    userId,
    direct: money(directBonus),
    indirect: grandReferrer ? money(indirectBonus) : '0',
  });
}

/** Resolves `?ref=username` into a referrer id, ignoring self-referral and unknown names. */
export async function resolveReferrer(
  referrerUsername: string | undefined,
  newUsername: string,
): Promise<string | null> {
  if (!referrerUsername) return null;
  const clean = referrerUsername.trim().replace(/^@/, '').toLowerCase();
  if (!clean || clean === newUsername.toLowerCase()) return null;

  const referrer = await prisma.user.findFirst({
    where: { username: { equals: clean, mode: 'insensitive' }, isDeleted: false, isBlocked: false },
    select: { id: true },
  });
  return referrer?.id ?? null;
}
