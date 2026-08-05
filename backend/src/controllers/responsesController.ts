import type { Request, Response } from 'express';
import { OrderStatus, ResponseStatus, VerificationStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { money, toPi } from '../lib/money';
import { paginate, publicUser } from '../lib/serializers';
import { getSettings } from '../services/settings';
import { refundConnect } from '../services/paymentVerification';

const idParam = z.object({ id: z.string().uuid() });

export const listResponsesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['date', 'price', 'rating']).default('date'),
});

function responseDTO(row: {
  id: string;
  orderId: string;
  masterId: string;
  pricePi: unknown;
  message: string;
  status: ResponseStatus;
  createdAt: Date;
  master?: {
    id: string;
    username: string;
    ratingAvg: unknown;
    ratingCount: number;
    masterProfile?: {
      displayName: string;
      avatarUrl: string | null;
      completedJobs: number;
      verificationStatus: VerificationStatus;
      boostedUntil: Date | null;
    } | null;
  } | null;
}) {
  const profile = row.master?.masterProfile;
  return {
    id: row.id,
    orderId: row.orderId,
    masterId: row.masterId,
    pricePi: money(row.pricePi as never),
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    master: publicUser(row.master as never),
    masterName: profile?.displayName ?? row.master?.username ?? null,
    masterAvatar: profile?.avatarUrl ?? null,
    masterCompletedJobs: profile?.completedJobs ?? 0,
    masterVerified: profile?.verificationStatus === VerificationStatus.VERIFIED,
    masterBoosted: Boolean(profile?.boostedUntil && profile.boostedUntil > new Date()),
  };
}

const masterInclude = {
  master: {
    select: {
      id: true,
      username: true,
      ratingAvg: true,
      ratingCount: true,
      masterProfile: {
        select: {
          displayName: true,
          avatarUrl: true,
          completedJobs: true,
          verificationStatus: true,
          boostedUntil: true,
        },
      },
    },
  },
} as const;

/**
 * Pre-flight check before the master pays the connect fee.
 * Everything checked here is checked again server-side at payment approval and
 * at execution — this endpoint exists so the master is not charged for a
 * response that would be rejected anyway.
 */
export const checkResponseSchema = z.object({
  pricePi: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d{1,7})?$/.test(value), 'Price must be a number with up to 7 decimals'),
});

export async function checkCanRespond(req: Request, res: Response): Promise<void> {
  const { id } = idParam.parse(req.params);
  const input = checkResponseSchema.parse(req.query);
  const settings = await getSettings();
  const user = req.user!;

  const profile = await prisma.masterProfile.findUnique({ where: { userId: user.id } });
  if (!profile) throw badRequest('no_master_profile', 'Create a master profile first');
  if (profile.verificationStatus !== VerificationStatus.VERIFIED) {
    throw forbidden('master_not_verified', 'Your master profile is not verified yet');
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.status !== OrderStatus.OPEN) throw conflict('order_not_open', 'This order is no longer open');
  if (order.clientId === user.id) throw badRequest('own_order', 'You cannot respond to your own order');

  const existing = await prisma.response.findUnique({
    where: { orderId_masterId: { orderId: order.id, masterId: user.id } },
  });
  if (existing) throw conflict('already_responded', 'You have already responded to this order');

  const active = await prisma.response.count({
    where: { masterId: user.id, status: ResponseStatus.ACTIVE },
  });
  if (active >= settings.maxActiveResponsesPerMaster) {
    throw conflict(
      'response_limit_reached',
      `You already have ${settings.maxActiveResponsesPerMaster} active responses`,
    );
  }

  const price = toPi(input.pricePi);
  if (price.lessThan(settings.minBudgetPi)) {
    throw badRequest('price_too_low', `Minimum price is ${money(settings.minBudgetPi)} Pi`);
  }

  res.json({
    ok: true,
    connectPricePi: money(settings.connectPricePi),
    activeResponses: active,
    maxActiveResponses: settings.maxActiveResponsesPerMaster,
    // Shown verbatim above the payment button — the policy must be visible before paying.
    refundPolicyMinutes: settings.connectRefundWindowMinutes,
  });
}

export async function listResponses(req: Request, res: Response): Promise<void> {
  const { id } = idParam.parse(req.params);
  const q = listResponsesSchema.parse(req.query);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');

  const isOwner = order.clientId === req.user?.id;
  const isAssignedMaster = order.masterId === req.user?.id;
  if (!isOwner && !isAssignedMaster) {
    throw forbidden('not_your_order', 'Only the client can see the responses to this order');
  }

  const orderBy =
    q.sort === 'price'
      ? ({ pricePi: 'asc' } as const)
      : q.sort === 'rating'
        ? ({ master: { ratingAvg: 'desc' } } as const)
        : ({ createdAt: 'desc' } as const);

  const where = { orderId: order.id, status: { in: [ResponseStatus.ACTIVE, ResponseStatus.SELECTED] } };

  const [rows, total] = await Promise.all([
    prisma.response.findMany({
      where,
      include: masterInclude,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.response.count({ where }),
  ]);

  res.json(paginate(rows.map(responseDTO), q.page, q.limit, total));
}

export async function myResponses(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      status: z.enum(['ACTIVE', 'SELECTED', 'REJECTED', 'WITHDRAWN']).optional(),
    })
    .parse(req.query);

  const where = {
    masterId: req.user!.id,
    ...(q.status ? { status: q.status as ResponseStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.response.findMany({
      where,
      include: {
        ...masterInclude,
        order: { include: { category: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.response.count({ where }),
  ]);

  res.json(
    paginate(
      rows.map((row) => ({
        ...responseDTO(row),
        order: {
          id: row.order.id,
          publicId: row.order.publicId,
          title: row.order.title,
          status: row.order.status,
          budgetPi: money(row.order.budgetPi),
          category: row.order.category.slug,
          address: row.order.address,
          isUrgent: row.order.isUrgent,
        },
      })),
      q.page,
      q.limit,
      total,
    ),
  );
}

/**
 * A master withdraws their own response.
 * The connect fee is refunded only inside the refund window and only while the
 * order is still open (policy 4.5).
 */
export async function withdrawResponse(req: Request, res: Response): Promise<void> {
  const { id } = idParam.parse(req.params);
  const settings = await getSettings();

  const response = await prisma.response.findUnique({ where: { id }, include: { order: true } });
  if (!response) throw notFound('response_not_found', 'Response not found');
  if (response.masterId !== req.user!.id) throw forbidden('not_your_response', 'This is not your response');
  if (response.status !== ResponseStatus.ACTIVE) {
    throw conflict('response_not_active', 'This response is no longer active');
  }

  const withinWindow =
    Date.now() - response.createdAt.getTime() <= settings.connectRefundWindowMinutes * 60 * 1000;
  const orderStillOpen = response.order.status === OrderStatus.OPEN;

  if (withinWindow && orderStillOpen) {
    await refundConnect(response.id, 'Response withdrawn within the refund window');
    res.json({ ok: true, refunded: true });
    return;
  }

  await prisma.response.update({ where: { id }, data: { status: ResponseStatus.WITHDRAWN } });
  res.json({ ok: true, refunded: false });
}
