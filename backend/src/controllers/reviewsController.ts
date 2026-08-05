import type { Request, Response } from 'express';
import { OrderStatus, ReviewRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { paginate, reviewDTO } from '../lib/serializers';

export const createReviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(500).default(''),
});

/**
 * Both sides review each other after a completed job.
 * The target's aggregate rating is recomputed inside the same transaction so
 * `ratingAvg` can never drift away from the underlying reviews.
 */
export async function createReview(req: Request, res: Response): Promise<void> {
  const input = createReviewSchema.parse(req.body);
  const userId = req.user!.id;

  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.status !== OrderStatus.COMPLETED) {
    throw conflict('order_not_completed', 'You can only review a completed job');
  }
  if (!order.masterId) throw badRequest('no_master', 'This order has no master');

  const isClient = order.clientId === userId;
  const isMaster = order.masterId === userId;
  if (!isClient && !isMaster) throw forbidden('not_a_party', 'You are not a party to this order');

  const targetId = isClient ? order.masterId : order.clientId;
  const role = isClient ? ReviewRole.CLIENT_TO_MASTER : ReviewRole.MASTER_TO_CLIENT;

  const existing = await prisma.review.findUnique({
    where: { orderId_authorId: { orderId: order.id, authorId: userId } },
  });
  if (existing) throw conflict('already_reviewed', 'You have already reviewed this job');

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: { orderId: order.id, authorId: userId, targetId, role, rating: input.rating, text: input.text },
      include: {
        author: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
        order: { select: { publicId: true, title: true } },
      },
    });

    const aggregate = await tx.review.aggregate({
      where: { targetId, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await tx.user.update({
      where: { id: targetId },
      data: {
        ratingAvg: (aggregate._avg.rating ?? 0).toFixed(2),
        ratingCount: aggregate._count.rating,
      },
    });

    return created;
  });

  res.status(201).json({ review: reviewDTO(review) });
}

export async function listReviews(req: Request, res: Response): Promise<void> {
  const { username } = z.object({ username: z.string().min(1).max(64) }).parse(req.params);
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);

  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true, ratingAvg: true, ratingCount: true },
  });
  if (!user) throw notFound('user_not_found', 'User not found');

  const where = { targetId: user.id, isHidden: false };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        author: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
        order: { select: { publicId: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.review.count({ where }),
  ]);

  res.json({
    ...paginate(rows.map(reviewDTO), q.page, q.limit, total),
    ratingAvg: Number(user.ratingAvg),
    ratingCount: user.ratingCount,
  });
}

/** Tells the UI whether the "leave a review" form should be shown. */
export async function reviewStatus(req: Request, res: Response): Promise<void> {
  const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.params);
  const userId = req.user!.id;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('order_not_found', 'Order not found');

  const isParty = order.clientId === userId || order.masterId === userId;
  const mine = isParty
    ? await prisma.review.findUnique({ where: { orderId_authorId: { orderId, authorId: userId } } })
    : null;

  res.json({
    canReview: isParty && order.status === OrderStatus.COMPLETED && !mine,
    alreadyReviewed: Boolean(mine),
  });
}
