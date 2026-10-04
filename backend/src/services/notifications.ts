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
  | 'not_selected'
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
    select: { orderId: true, count: true, type: true },
  });
  const byOrder: Record<string, number> = {};
  const messagesByOrder: Record<string, number> = {};
  let total = 0;
  let messages = 0;
  for (const row of unread) {
    total += row.count;
    if (row.orderId) byOrder[row.orderId] = (byOrder[row.orderId] ?? 0) + row.count;
    if (row.type === 'message') {
      messages += row.count;
      if (row.orderId) messagesByOrder[row.orderId] = (messagesByOrder[row.orderId] ?? 0) + row.count;
    }
  }
  // `messages` drives the badge on the Chats tab, `messagesByOrder` the one on
  // an order's chat button.
  return { unread: total, messages, byOrder, messagesByOrder };
}

/**
 * `exceptMessages`: the order page reads the order's news but not its chat —
 * those stay unread until the chat itself is opened, or the count on the chat
 * button would vanish the moment the order was opened.
 */
export async function markRead(userId: string, orderId?: string, exceptMessages = false): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(orderId ? { orderId } : {}),
      ...(exceptMessages ? { type: { not: 'message' } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
