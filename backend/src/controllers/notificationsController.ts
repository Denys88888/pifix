import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { markRead, summary } from '../services/notifications';

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    include: { order: { select: { id: true, publicId: true, title: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      count: row.count,
      data: row.data ?? {},
      order: row.order,
      read: row.readAt !== null,
      at: row.updatedAt.toISOString(),
    })),
  });
}

/** Polled by the app for the counter and the "new" badges. */
export async function notificationSummary(req: Request, res: Response): Promise<void> {
  res.json(await summary(req.user!.id));
}

export async function readNotifications(req: Request, res: Response): Promise<void> {
  const input = z
    .object({ orderId: z.string().uuid().optional(), exceptMessages: z.boolean().optional() })
    .parse(req.body ?? {});
  const marked = await markRead(req.user!.id, input.orderId, input.exceptMessages ?? false);
  res.json({ ok: true, marked });
}
