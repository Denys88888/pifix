import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * In-app notifications. Pi Browser has no push and no background work, so the
 * app polls a small summary and shows a counter, "new" badges and a list.
 *
 * Every function here is best-effort: a notification that fails to be written
 * must never undo or fail the thing it is about — a payment, a dispute.
 */

export type NotificationType =
  | 'response_new'
  | 'hired'
  | 'message'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'job_done'
  | 'job_confirmed'
  | 'auto_released'
  | 'payout_sent'
  | 'order_cancelled';

export async function notify(
  userId: string | null | undefined,
  type: NotificationType,
  orderId: string | null,
  data: Record<string, string | number> = {},
): Promise<void> {
  if (!userId) return;
  try {
    if (type === 'message' && orderId) {
      // One unread line per conversation, counted up, instead of one per message.
      const bumped = await prisma.notification.updateMany({
        where: { userId, orderId, type: 'message', readAt: null },
        data: { count: { increment: 1 }, data: data as Prisma.InputJsonValue },
      });
      if (bumped.count > 0) return;
    }
    await prisma.notification.create({
      data: { userId, type, orderId, data: data as Prisma.InputJsonValue },
    });
  } catch (error) {
    logger.warn('Notification not written', { userId, type, orderId, error: (error as Error).message });
  }
}

/** What the badges need, in one cheap query. */
export async function summary(userId: string) {
  const unread = await prisma.notification.findMany({
    where: { userId, readAt: null },
    select: { orderId: true, count: true },
  });
  const byOrder: Record<string, number> = {};
  let total = 0;
  for (const row of unread) {
    total += row.count;
    if (row.orderId) byOrder[row.orderId] = (byOrder[row.orderId] ?? 0) + row.count;
  }
  return { unread: total, byOrder };
}

export async function markRead(userId: string, orderId?: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(orderId ? { orderId } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}
