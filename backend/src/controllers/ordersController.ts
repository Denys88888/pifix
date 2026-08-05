import type { Request, Response } from 'express';
import { EscrowStatus, OrderStatus, Prisma, ResponseStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { money, toPi } from '../lib/money';
import { publicId } from '../lib/ids';
import { GEO_CANDIDATE_CAP, orderDTO, paginate } from '../lib/serializers';
import { getSettings } from '../services/settings';
import { computeOrderCharges, releaseEscrow } from '../services/escrow';
import { refundConnect } from '../services/paymentVerification';
import { boundingBox, haversineKm, roundDistance } from '../services/geolocation';

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d{1,7})?$/.test(value), 'Amount must be a number with up to 7 decimals');

export const createOrderSchema = z.object({
  categorySlug: z.string().min(1).max(40),
  title: z.string().trim().min(4, 'Title is too short').max(120),
  description: z.string().trim().min(10, 'Please describe the job').max(1000),
  budgetPi: decimalString,
  address: z.string().trim().min(3).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isUrgent: z.boolean().default(false),
  photos: z.array(z.string().url()).max(3).default([]),
});

export const listOrdersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  category: z.string().max(40).optional(),
  minBudget: z.coerce.number().min(0).optional(),
  maxBudget: z.coerce.number().min(0).optional(),
  urgentOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(500).optional(),
  sort: z.enum(['date', 'budget', 'distance']).default('date'),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export async function createOrder(req: Request, res: Response): Promise<void> {
  const input = createOrderSchema.parse(req.body);
  const settings = await getSettings();
  const user = req.user!;

  if (settings.maintenanceMode) {
    throw conflict('maintenance', 'PiFix is under maintenance, please try again shortly');
  }

  const budget = toPi(input.budgetPi);
  if (budget.lessThan(settings.minBudgetPi)) {
    throw badRequest('budget_too_low', `Minimum budget is ${money(settings.minBudgetPi)} Pi`);
  }

  const openOrders = await prisma.order.count({
    where: {
      clientId: user.id,
      status: { in: [OrderStatus.OPEN, OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_CONFIRMATION] },
    },
  });
  if (openOrders >= settings.maxOpenOrdersPerClient) {
    throw conflict(
      'order_limit_reached',
      `You can have at most ${settings.maxOpenOrdersPerClient} active orders`,
    );
  }

  const category = await prisma.category.findUnique({ where: { slug: input.categorySlug } });
  if (!category || !category.isActive) throw badRequest('unknown_category', 'Unknown category');

  const order = await prisma.order.create({
    data: {
      publicId: publicId(),
      clientId: user.id,
      categoryId: category.id,
      title: input.title,
      description: input.description,
      budgetPi: budget,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      isUrgent: input.isUrgent,
      photos: input.photos,
    },
    include: { category: true, client: true, master: true },
  });

  logger.info('Order published', { orderId: order.id, publicId: order.publicId, budget: money(budget) });
  res.status(201).json({ order: orderDTO(order, { viewerIsOwner: true }) });
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const q = listOrdersSchema.parse(req.query);
  const viewerId = req.user?.id;

  const where: Prisma.OrderWhereInput = {
    status: q.status ?? OrderStatus.OPEN,
  };

  if (q.category) {
    where.category = { slug: q.category };
  }
  if (q.minBudget !== undefined || q.maxBudget !== undefined) {
    where.budgetPi = {
      ...(q.minBudget !== undefined ? { gte: new Prisma.Decimal(q.minBudget) } : {}),
      ...(q.maxBudget !== undefined ? { lte: new Prisma.Decimal(q.maxBudget) } : {}),
    };
  }
  if (q.urgentOnly) where.isUrgent = true;

  const geoFilterActive = q.lat !== undefined && q.lng !== undefined && q.radiusKm !== undefined;

  if (geoFilterActive) {
    // Index-friendly prefilter; the exact circle is applied in memory below.
    const box = boundingBox(q.lat!, q.lng!, q.radiusKm!);
    where.lat = { gte: box.minLat, lte: box.maxLat };
    where.lng = { gte: box.minLng, lte: box.maxLng };
  }

  const orderBy: Prisma.OrderOrderByWithRelationInput =
    q.sort === 'budget' ? { budgetPi: 'desc' } : { createdAt: 'desc' };

  if (geoFilterActive) {
    // Distance sorting cannot be pushed down without raw SQL, so pull a
    // bounded candidate set from the box and rank it here.
    const candidates = await prisma.order.findMany({
      where,
      include: { category: true, client: true, master: true, _count: { select: { responses: true } } },
      orderBy,
      take: GEO_CANDIDATE_CAP,
    });

    const within = candidates
      .map((order) => ({
        order,
        distanceKm: roundDistance(haversineKm(q.lat!, q.lng!, order.lat, order.lng)),
      }))
      .filter((entry) => entry.distanceKm <= q.radiusKm!);

    if (q.sort === 'distance') within.sort((a, b) => a.distanceKm - b.distanceKm);

    const total = within.length;
    const start = (q.page - 1) * q.limit;
    const items = within
      .slice(start, start + q.limit)
      .map((entry) =>
        orderDTO(entry.order, {
          distanceKm: entry.distanceKm,
          viewerIsOwner: entry.order.clientId === viewerId,
        }),
      );

    res.json(paginate(items, q.page, q.limit, total, candidates.length === GEO_CANDIDATE_CAP));
    return;
  }

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { category: true, client: true, master: true, _count: { select: { responses: true } } },
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.order.count({ where }),
  ]);

  res.json(
    paginate(
      rows.map((order) => orderDTO(order, { viewerIsOwner: order.clientId === viewerId })),
      q.page,
      q.limit,
      total,
    ),
  );
}

export async function myOrders(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      role: z.enum(['client', 'master']).default('client'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);

  const where: Prisma.OrderWhereInput =
    q.role === 'client' ? { clientId: req.user!.id } : { masterId: req.user!.id };

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

  res.json(
    paginate(
      rows.map((order) => orderDTO(order, { viewerIsOwner: order.clientId === req.user!.id })),
      q.page,
      q.limit,
      total,
    ),
  );
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { category: true, client: true, master: true, _count: { select: { responses: true } } },
  });
  if (!order) throw notFound('order_not_found', 'Order not found');

  const settings = await getSettings();
  const charges = computeOrderCharges(settings, order.budgetPi, order.isUrgent);

  res.json({
    order: orderDTO(order, { viewerIsOwner: order.clientId === req.user?.id }),
    quote: {
      escrowAmountPi: money(charges.escrowAmountPi),
      clientFeePi: money(charges.clientFeePi),
      expressFeePi: money(charges.expressFeePi),
      totalPi: money(charges.totalPi),
    },
  });
}

/** Price preview for a specific response, used right before the escrow payment. */
export async function quoteForResponse(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const { responseId } = z.object({ responseId: z.string().uuid() }).parse(req.query);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.clientId !== req.user!.id) throw forbidden('not_your_order', 'This is not your order');

  const response = await prisma.response.findUnique({ where: { id: responseId } });
  if (!response || response.orderId !== order.id) throw notFound('response_not_found', 'Response not found');

  const settings = await getSettings();
  const charges = computeOrderCharges(settings, response.pricePi, order.isUrgent);

  res.json({
    escrowAmountPi: money(charges.escrowAmountPi),
    clientFeePi: money(charges.clientFeePi),
    expressFeePi: money(charges.expressFeePi),
    totalPi: money(charges.totalPi),
    clientFeePercent: settings.clientFeePercent.toString(),
  });
}

/** Client cancels an order. Connect refunds follow policy 4.5. */
export async function cancelOrder(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const settings = await getSettings();

  const order = await prisma.order.findUnique({ where: { id }, include: { responses: true } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.clientId !== req.user!.id) throw forbidden('not_your_order', 'This is not your order');
  if (order.status !== OrderStatus.OPEN) {
    throw conflict('order_not_open', 'Only an open order can be cancelled');
  }

  const withinRefundWindow =
    Date.now() - order.createdAt.getTime() <= settings.connectRefundWindowMinutes * 60 * 1000;

  await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
  });

  let refunded = 0;
  if (withinRefundWindow) {
    for (const response of order.responses) {
      if (response.status === ResponseStatus.ACTIVE && !response.connectRefunded) {
        await refundConnect(response.id, `Order #${order.publicId} cancelled within the refund window`);
        refunded += 1;
      }
    }
  } else {
    await prisma.response.updateMany({
      where: { orderId: order.id, status: ResponseStatus.ACTIVE },
      data: { status: ResponseStatus.REJECTED },
    });
  }

  logger.info('Order cancelled', { orderId: order.id, refundedConnects: refunded });
  res.json({ ok: true, refundedConnects: refunded, withinRefundWindow });
}

/** Master marks the job as done; the client's confirmation window starts. */
export async function markCompleted(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const settings = await getSettings();

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.masterId !== req.user!.id) throw forbidden('not_your_job', 'You are not the assigned master');
  if (order.status !== OrderStatus.IN_PROGRESS) {
    throw conflict('order_not_in_progress', 'This job is not in progress');
  }

  const autoReleaseAt = new Date(Date.now() + settings.escrowTimeoutDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.AWAITING_CONFIRMATION, completedAt: new Date(), autoReleaseAt },
    include: { category: true, client: true, master: true },
  });

  res.json({ order: orderDTO(updated) });
}

/** Client confirms → escrow is released to the master's balance. */
export async function confirmOrder(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.clientId !== req.user!.id) throw forbidden('not_your_order', 'This is not your order');
  if (order.escrowStatus !== EscrowStatus.FUNDED) {
    throw conflict('escrow_not_funded', 'There is nothing to release for this order');
  }
  const confirmable: OrderStatus[] = [OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_CONFIRMATION];
  if (!confirmable.includes(order.status)) {
    throw conflict('order_not_confirmable', 'This order cannot be confirmed');
  }

  const released = await releaseEscrow(order.id, 'client_confirmed');
  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { category: true, client: true, master: true },
  });

  res.json({ order: orderDTO(fresh), released: Boolean(released) });
}

export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(500) });

/** Either side can escalate; the escrow stays frozen until an admin decides. */
export async function openDispute(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = disputeSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (order.clientId !== req.user!.id && order.masterId !== req.user!.id) {
    throw forbidden('not_a_party', 'You are not a party to this order');
  }
  if (order.escrowStatus !== EscrowStatus.FUNDED) {
    throw conflict('escrow_not_funded', 'There is no escrow to dispute');
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.DISPUTED,
      disputeReason: input.reason,
      // Freeze the auto-release so an admin, not the timer, resolves it.
      autoReleaseAt: null,
    },
    include: { category: true, client: true, master: true },
  });

  logger.warn('Dispute opened', { orderId: order.id, by: req.user!.username });
  res.json({ order: orderDTO(updated) });
}
