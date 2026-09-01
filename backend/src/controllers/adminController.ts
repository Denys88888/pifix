import type { Request, Response } from 'express';
import {
  EscrowStatus,
  OrderStatus,
  Prisma,
  TransactionType,
  VerificationStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors';
import { money, toPi } from '../lib/money';
import { masterProfileDTO, orderDTO, paginate, reviewDTO, withdrawalDTO } from '../lib/serializers';
import { isAdminPiUid, signAdminToken, verifyAdminCredentials } from '../middleware/adminAuth';
import { getSettings, updateSettings } from '../services/settings';
import { refundEscrow, releaseEscrow } from '../services/escrow';
import { postTransaction } from '../services/ledger';
import { sendPayout } from '../services/piPayouts';
import { env } from '../config/env';

async function audit(actor: string, action: string, targetId?: string, details?: unknown): Promise<void> {
  await prisma.adminLog
    .create({ data: { actor, action, targetId: targetId ?? null, details: (details ?? {}) as object } })
    .catch((error) => logger.warn('Audit log failed', { error: (error as Error).message }));
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const adminLoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function adminLogin(req: Request, res: Response): Promise<void> {
  const input = adminLoginSchema.parse(req.body);
  const ok = await verifyAdminCredentials(input.username, input.password);
  if (!ok) {
    logger.warn('Failed admin login attempt', { username: input.username, ip: req.ip });
    throw unauthorized('admin_credentials_invalid', 'Invalid credentials');
  }
  await audit(input.username, 'login');
  res.json({ token: signAdminToken(input.username), username: input.username });
}

/**
 * Exchanges the developer's own Pi session for an admin token, so the panel
 * opens from their phone without a second password. Runs behind requireAuth,
 * so the identity here has already been verified against the Pi API — this
 * only decides whether that verified person is the configured developer.
 */
export async function adminLoginWithPi(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (!isAdminPiUid(user.piUid)) {
    logger.warn('Pi account tried the developer entrance', { username: user.username, ip: req.ip });
    throw unauthorized('not_admin', 'This Pi account is not the app developer');
  }
  await audit(user.username, 'login_pi');
  res.json({ token: signAdminToken(user.username), username: user.username });
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function dashboard(_req: Request, res: Response): Promise<void> {
  const settings = await getSettings();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const revenueSince = async (since: Date) => {
    const aggregate = await prisma.order.aggregate({
      where: { escrowStatus: { in: [EscrowStatus.RELEASED] }, confirmedAt: { gte: since } },
      _sum: { clientFeePi: true, expressFeePi: true, masterFeePi: true },
    });
    return toPi(
      new Prisma.Decimal(aggregate._sum.clientFeePi ?? 0)
        .add(aggregate._sum.expressFeePi ?? 0)
        .add(aggregate._sum.masterFeePi ?? 0),
    );
  };

  const connectRevenueSince = async (since: Date) => {
    const aggregate = await prisma.payment.aggregate({
      where: { type: 'CONNECT', status: 'COMPLETED', completedAt: { gte: since } },
      _sum: { amountPi: true },
    });
    return toPi(aggregate._sum.amountPi ?? 0);
  };

  const [
    users,
    masters,
    verifiedMasters,
    orders,
    openOrders,
    completedOrders,
    disputes,
    pendingVerifications,
    pendingWithdrawals,
    todayFees,
    weekFees,
    monthFees,
    todayConnects,
    weekConnects,
    monthConnects,
    escrowHeld,
    payoutsOwed,
  ] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false } }),
    prisma.user.count({ where: { isMaster: true, isDeleted: false } }),
    prisma.masterProfile.count({ where: { verificationStatus: VerificationStatus.VERIFIED } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: OrderStatus.OPEN } }),
    prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
    prisma.order.count({ where: { status: OrderStatus.DISPUTED } }),
    prisma.masterProfile.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
    prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.REQUESTED } }),
    revenueSince(startOfDay),
    revenueSince(weekAgo),
    revenueSince(monthAgo),
    connectRevenueSince(startOfDay),
    connectRevenueSince(weekAgo),
    connectRevenueSince(monthAgo),
    prisma.order.aggregate({ where: { escrowStatus: EscrowStatus.FUNDED }, _sum: { escrowAmountPi: true } }),
    prisma.user.aggregate({ _sum: { balancePi: true } }),
  ]);

  const rate = toPi(settings.piUsdRate);
  const usd = (pi: Prisma.Decimal) => (rate.greaterThan(0) ? money(pi.mul(rate)) : null);

  const today = toPi(todayFees.add(todayConnects));
  const week = toPi(weekFees.add(weekConnects));
  const month = toPi(monthFees.add(monthConnects));

  res.json({
    users: { total: users, masters, verifiedMasters },
    orders: { total: orders, open: openOrders, completed: completedOrders, disputes },
    queue: { pendingVerifications, pendingWithdrawals },
    revenue: {
      todayPi: money(today),
      weekPi: money(week),
      monthPi: money(month),
      todayUsd: usd(today),
      weekUsd: usd(week),
      monthUsd: usd(month),
      piUsdRate: money(rate),
    },
    liabilities: {
      escrowHeldPi: money(escrowHeld._sum.escrowAmountPi ?? 0),
      userBalancesPi: money(payoutsOwed._sum.balancePi ?? 0),
    },
    system: {
      sandbox: env.PI_SANDBOX,
      payoutsConfigured: env.payoutsConfigured,
      cloudinaryConfigured: env.cloudinaryConfigured,
      requireKyc: env.REQUIRE_KYC,
      maintenanceMode: settings.maintenanceMode,
    },
  });
}

// ── Orders ───────────────────────────────────────────────────────────────────

export const adminOrdersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
  category: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().max(120).optional(),
});

export async function listOrders(req: Request, res: Response): Promise<void> {
  const q = adminOrdersSchema.parse(req.query);

  const where: Prisma.OrderWhereInput = {
    ...(q.status ? { status: q.status as OrderStatus } : {}),
    ...(q.category ? { category: { slug: q.category } } : {}),
    ...(q.from || q.to
      ? {
          createdAt: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        }
      : {}),
    ...(q.search
      ? {
          OR: [
            { publicId: { contains: q.search.toUpperCase() } },
            { title: { contains: q.search, mode: 'insensitive' } },
            { client: { username: { contains: q.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { category: true, client: true, master: true, _count: { select: { responses: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.order.count({ where }),
  ]);

  res.json(paginate(rows.map((order) => orderDTO(order)), q.page, q.limit, total));
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      category: true,
      client: true,
      master: true,
      responses: { include: { master: { select: { id: true, username: true } } } },
      payments: true,
      reviews: {
        include: {
          author: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
          order: { select: { publicId: true, title: true } },
        },
      },
    },
  });
  if (!order) throw notFound('order_not_found', 'Order not found');

  res.json({
    order: orderDTO(order),
    responses: order.responses.map((response) => ({
      id: response.id,
      masterId: response.masterId,
      masterUsername: response.master.username,
      pricePi: money(response.pricePi),
      message: response.message,
      status: response.status,
      connectRefunded: response.connectRefunded,
      createdAt: response.createdAt.toISOString(),
    })),
    payments: order.payments.map((payment) => ({
      piPaymentId: payment.piPaymentId,
      type: payment.type,
      direction: payment.direction,
      status: payment.status,
      amountPi: money(payment.amountPi),
      txid: payment.txid,
      createdAt: payment.createdAt.toISOString(),
    })),
    reviews: order.reviews.map(reviewDTO),
  });
}

export const resolveOrderSchema = z.object({
  action: z.enum(['release', 'refund', 'refund_with_fees', 'cancel']),
  note: z.string().max(500).optional(),
});

/** Dispute resolution: release to the master, refund the client, or cancel. */
export async function resolveOrder(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = resolveOrderSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');

  switch (input.action) {
    case 'release': {
      if (order.escrowStatus !== EscrowStatus.FUNDED) {
        throw conflict('escrow_not_funded', 'There is no funded escrow on this order');
      }
      await releaseEscrow(order.id, 'admin_release');
      break;
    }
    case 'refund':
    case 'refund_with_fees': {
      if (order.escrowStatus !== EscrowStatus.FUNDED) {
        throw conflict('escrow_not_funded', 'There is no funded escrow on this order');
      }
      await refundEscrow(order.id, input.action === 'refund_with_fees');
      break;
    }
    case 'cancel': {
      if (order.escrowStatus === EscrowStatus.FUNDED) {
        throw conflict('escrow_funded', 'Refund or release the escrow before cancelling');
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      break;
    }
  }

  await audit(req.admin!.username, `order:${input.action}`, order.id, { note: input.note });

  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { category: true, client: true, master: true },
  });
  res.json({ order: orderDTO(fresh) });
}

// ── Masters & verification ───────────────────────────────────────────────────

export const adminMastersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
  search: z.string().max(120).optional(),
});

export async function listMasters(req: Request, res: Response): Promise<void> {
  const q = adminMastersSchema.parse(req.query);

  const where: Prisma.MasterProfileWhereInput = {
    ...(q.status ? { verificationStatus: q.status as VerificationStatus } : {}),
    ...(q.search
      ? {
          OR: [
            { displayName: { contains: q.search, mode: 'insensitive' } },
            { user: { username: { contains: q.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.masterProfile.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, ratingAvg: true, ratingCount: true, isBlocked: true } },
        categories: { include: { category: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.masterProfile.count({ where }),
  ]);

  res.json(
    paginate(
      rows.map((profile) => ({
        ...masterProfileDTO(profile),
        isBlocked: profile.user.isBlocked,
        // Admin-only: the raw ID/selfie URLs for review.
        verificationDocs: profile.verificationDocs,
      })),
      q.page,
      q.limit,
      total,
    ),
  );
}

export const verifyMasterSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});

export async function verifyMaster(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = verifyMasterSchema.parse(req.body);

  const profile = await prisma.masterProfile.findUnique({ where: { id } });
  if (!profile) throw notFound('master_not_found', 'Master profile not found');

  const approved = input.decision === 'approve';

  const updated = await prisma.masterProfile.update({
    where: { id },
    data: {
      verificationStatus: approved ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED,
      verificationNote: input.note ?? null,
      verifiedAt: approved ? new Date() : null,
      // Rejected documents are dropped: no reason to keep ID scans around.
      ...(approved ? {} : { verificationDocs: [] }),
    },
    include: {
      user: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
      categories: { include: { category: true } },
    },
  });

  await audit(req.admin!.username, `master:${input.decision}`, id, { note: input.note });
  logger.info('Master verification decided', { profileId: id, decision: input.decision });

  res.json({ profile: masterProfileDTO(updated) });
}

export const blockUserSchema = z.object({ blocked: z.boolean(), note: z.string().max(500).optional() });

export async function blockUser(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = blockUserSchema.parse(req.body);

  const user = await prisma.user.update({ where: { id }, data: { isBlocked: input.blocked } });
  await audit(req.admin!.username, input.blocked ? 'user:block' : 'user:unblock', id, { note: input.note });

  res.json({ ok: true, username: user.username, isBlocked: user.isBlocked });
}

// ── Reviews moderation ───────────────────────────────────────────────────────

export async function listReviews(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      hidden: z.enum(['true', 'false']).optional(),
    })
    .parse(req.query);

  const where: Prisma.ReviewWhereInput = q.hidden ? { isHidden: q.hidden === 'true' } : {};

  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        author: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
        target: { select: { username: true } },
        order: { select: { publicId: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.review.count({ where }),
  ]);

  res.json(
    paginate(
      rows.map((review) => ({ ...reviewDTO(review), targetUsername: review.target.username, isHidden: review.isHidden })),
      q.page,
      q.limit,
      total,
    ),
  );
}

/** Hides a review and recomputes the target's rating without it. */
export async function hideReview(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = z.object({ hidden: z.boolean().default(true) }).parse(req.body);

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) throw notFound('review_not_found', 'Review not found');

  await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id }, data: { isHidden: input.hidden } });
    const aggregate = await tx.review.aggregate({
      where: { targetId: review.targetId, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await tx.user.update({
      where: { id: review.targetId },
      data: {
        ratingAvg: (aggregate._avg.rating ?? 0).toFixed(2),
        ratingCount: aggregate._count.rating,
      },
    });
  });

  await audit(req.admin!.username, input.hidden ? 'review:hide' : 'review:show', id);
  res.json({ ok: true });
}

// ── Platform settings ────────────────────────────────────────────────────────

const decimalField = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,7})?$/.test(value), 'Must be a non-negative number');

const percentField = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100, 'Must be between 0 and 100');

export const settingsSchema = z.object({
  connectPricePi: decimalField.optional(),
  clientFeePercent: percentField.optional(),
  masterFeePercent: percentField.optional(),
  proSubscriptionPricePi: decimalField.optional(),
  expressFeePi: decimalField.optional(),
  profileBoostPricePi: decimalField.optional(),
  escrowTimeoutDays: z.coerce.number().int().min(1).max(90).optional(),
  referralBonusDirectPi: decimalField.optional(),
  referralBonusIndirectPi: decimalField.optional(),
  minBudgetPi: decimalField.optional(),
  maxOpenOrdersPerClient: z.coerce.number().int().min(1).max(100).optional(),
  maxActiveResponsesPerMaster: z.coerce.number().int().min(1).max(100).optional(),
  connectRefundWindowMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  minWithdrawalPi: decimalField.optional(),
  autoWithdrawalPi: decimalField.optional(),
  piUsdRate: decimalField.optional(),
  maintenanceMode: z.boolean().optional(),
  supportContact: z.string().trim().max(200).optional(),
  orderExpiryDays: z.coerce.number().int().min(0).max(365).optional(),
});

export async function getAdminSettings(_req: Request, res: Response): Promise<void> {
  const settings = await getSettings();
  res.json({
    settings: {
      connectPricePi: settings.connectPricePi.toString(),
      clientFeePercent: settings.clientFeePercent.toString(),
      masterFeePercent: settings.masterFeePercent.toString(),
      proSubscriptionPricePi: settings.proSubscriptionPricePi.toString(),
      expressFeePi: settings.expressFeePi.toString(),
      profileBoostPricePi: settings.profileBoostPricePi.toString(),
      escrowTimeoutDays: settings.escrowTimeoutDays,
      referralBonusDirectPi: settings.referralBonusDirectPi.toString(),
      referralBonusIndirectPi: settings.referralBonusIndirectPi.toString(),
      minBudgetPi: settings.minBudgetPi.toString(),
      maxOpenOrdersPerClient: settings.maxOpenOrdersPerClient,
      maxActiveResponsesPerMaster: settings.maxActiveResponsesPerMaster,
      connectRefundWindowMinutes: settings.connectRefundWindowMinutes,
      minWithdrawalPi: settings.minWithdrawalPi.toString(),
      autoWithdrawalPi: settings.autoWithdrawalPi.toString(),
      piUsdRate: settings.piUsdRate.toString(),
      maintenanceMode: settings.maintenanceMode,
      supportContact: settings.supportContact,
      orderExpiryDays: settings.orderExpiryDays,
      updatedAt: settings.updatedAt.toISOString(),
    },
  });
}

export async function putAdminSettings(req: Request, res: Response): Promise<void> {
  const input = settingsSchema.parse(req.body);
  if (Object.keys(input).length === 0) throw badRequest('nothing_to_update', 'No settings provided');

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    patch[key] = typeof value === 'string' ? new Prisma.Decimal(value) : value;
  }

  const saved = await updateSettings(patch as never);
  await audit(req.admin!.username, 'settings:update', '1', input);
  logger.info('Platform settings updated', { by: req.admin!.username, fields: Object.keys(input) });

  req.body = {};
  res.json({ settings: { ...saved, updatedAt: saved.updatedAt.toISOString() } });
}

// ── Withdrawals ──────────────────────────────────────────────────────────────

export async function listWithdrawals(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED']).optional(),
    })
    .parse(req.query);

  const where: Prisma.WithdrawalRequestWhereInput = q.status
    ? { status: q.status as WithdrawalStatus }
    : {};

  const [rows, total] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where,
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.withdrawalRequest.count({ where }),
  ]);

  res.json(paginate(rows.map(withdrawalDTO), q.page, q.limit, total));
}

/**
 * Pays a withdrawal out on-chain.
 * The balance is debited first (inside a transaction, with a funds check) and
 * refunded if the on-chain send fails — the user is never debited for a payout
 * that did not happen.
 */
export async function payWithdrawal(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!withdrawal) throw notFound('withdrawal_not_found', 'Withdrawal request not found');
  if (withdrawal.status === WithdrawalStatus.PAID) {
    throw conflict('already_paid', 'This withdrawal was already paid');
  }
  if (withdrawal.status === WithdrawalStatus.REJECTED) {
    throw conflict('already_rejected', 'This withdrawal was rejected');
  }
  if (!env.payoutsConfigured) {
    throw badRequest('payouts_disabled', 'Set PI_WALLET_PRIVATE_SEED and PAYOUTS_ENABLED to pay out');
  }
  if (withdrawal.txid) {
    throw conflict('already_paid', 'This withdrawal already has a chain transaction');
  }
  // Debited and claimed by an attempt that never reported back — a crash between
  // the debit and the payout leaves this state. Sending again could pay twice,
  // so it takes a human checking the payment against Pi before it moves.
  if (withdrawal.status === WithdrawalStatus.APPROVED) {
    throw conflict(
      'needs_reconciliation',
      'An earlier attempt already claimed this withdrawal — verify it on the Pi API before retrying',
    );
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-swap on the status. Two admins pressing Pay at the same moment
    // both clear the checks above; only the one that actually flips
    // REQUESTED → APPROVED gets to debit the balance and send.
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.APPROVED },
    });
    if (claimed.count === 0) {
      throw conflict('already_processing', 'This withdrawal is already being paid');
    }

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

  if (!payout.ok) {
    // Give the money back and reopen the request so it can be retried.
    await prisma.$transaction(async (tx) => {
      await postTransaction(tx, {
        userId: withdrawal.userId,
        type: TransactionType.ADMIN_ADJUSTMENT,
        amountPi: toPi(withdrawal.amountPi),
        description: 'Withdrawal payout failed — balance restored',
      });
      await tx.withdrawalRequest.update({
        where: { id },
        data: {
          status: WithdrawalStatus.REQUESTED,
          adminNote: `Payout failed: ${payout.error ?? 'unknown error'}`.slice(0, 500),
        },
      });
    });
    await audit(req.admin!.username, 'withdrawal:failed', id, { error: payout.error });
    throw badRequest('payout_failed', `Payout failed: ${payout.error ?? 'unknown error'}`);
  }

  const updated = await prisma.withdrawalRequest.update({
    where: { id },
    data: {
      status: WithdrawalStatus.PAID,
      txid: payout.txid,
      piPaymentId: payout.piPaymentId,
      processedAt: new Date(),
    },
    include: { user: { select: { username: true } } },
  });

  await audit(req.admin!.username, 'withdrawal:paid', id, { txid: payout.txid });
  res.json({ withdrawal: withdrawalDTO(updated) });
}

export async function rejectWithdrawal(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = z.object({ note: z.string().max(500).optional() }).parse(req.body);

  const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!withdrawal) throw notFound('withdrawal_not_found', 'Withdrawal request not found');
  if (withdrawal.status === WithdrawalStatus.PAID) {
    throw conflict('already_paid', 'This withdrawal was already paid');
  }

  const updated = await prisma.withdrawalRequest.update({
    where: { id },
    data: {
      status: WithdrawalStatus.REJECTED,
      adminNote: input.note ?? 'Rejected by admin',
      processedAt: new Date(),
    },
    include: { user: { select: { username: true } } },
  });

  await audit(req.admin!.username, 'withdrawal:reject', id, { note: input.note });
  res.json({ withdrawal: withdrawalDTO(updated) });
}

export async function listAuditLog(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .parse(req.query);

  const [rows, total] = await Promise.all([
    prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.adminLog.count(),
  ]);

  res.json(
    paginate(
      rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        targetId: row.targetId,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      })),
      q.page,
      q.limit,
      total,
    ),
  );
}
