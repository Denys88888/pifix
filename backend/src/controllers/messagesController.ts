import type { Request, Response } from 'express';
import { MessageRole, OrderStatus, type Order, type OrderMessage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { conflict, forbidden, notFound } from '../lib/errors';

/**
 * Chat on an order, between the client and the master they hired.
 *
 * It opens when a master is hired, not before: until then the client is
 * talking to everybody who responded, and the response message already covers
 * that. The admin is not a pioneer account, so admin messages carry no author
 * and are written through the admin routes below.
 */

const MESSAGE_MAX = 1000;
const PAGE = 200;

export const postMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message is empty').max(MESSAGE_MAX),
});

const listSchema = z.object({
  /** Only messages newer than this — what the polling client asks for. */
  after: z.string().datetime().optional(),
});

type Party = 'client' | 'master';

function partyOf(order: Order, userId: string): Party | null {
  if (order.clientId === userId) return 'client';
  if (order.masterId && order.masterId === userId) return 'master';
  return null;
}

export function messageDTO(
  message: OrderMessage & { author?: { username: string } | null },
  viewerId?: string,
) {
  return {
    id: message.id,
    role: message.authorRole,
    username: message.author?.username ?? null,
    text: message.text,
    mine: Boolean(viewerId && message.authorId === viewerId),
    createdAt: message.createdAt.toISOString(),
  };
}

export async function listMessagesFor(orderId: string, after?: string) {
  // gte, not gt: a message written in the same millisecond as the last one the
  // client saw would otherwise never be fetched. The client drops repeats by id.
  return prisma.orderMessage.findMany({
    where: { orderId, ...(after ? { createdAt: { gte: new Date(after) } } : {}) },
    include: { author: { select: { username: true } } },
    orderBy: { createdAt: 'asc' },
    take: PAGE,
  });
}

async function loadOrderForParty(req: Request): Promise<{ order: Order; party: Party }> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  const party = partyOf(order, req.user!.id);
  // Not "forbidden": whether an order has a chat at all is nobody else's business.
  if (!party) throw notFound('order_not_found', 'Order not found');
  return { order, party };
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const { order } = await loadOrderForParty(req);
  const q = listSchema.parse(req.query);
  const rows = await listMessagesFor(order.id, q.after);
  res.json({
    items: rows.map((row) => messageDTO(row, req.user!.id)),
    open: chatOpen(order),
  });
}

/** Whether the two sides can still write: from the hire until the order is closed for good. */
export function chatOpen(order: Order): boolean {
  if (!order.masterId) return false;
  return order.status !== OrderStatus.CANCELLED;
}

export async function postMessage(req: Request, res: Response): Promise<void> {
  const { order, party } = await loadOrderForParty(req);
  const input = postMessageSchema.parse(req.body);

  if (!order.masterId) {
    throw forbidden('chat_not_open', 'The chat opens once a master is hired');
  }
  if (!chatOpen(order)) {
    throw conflict('chat_closed', 'This order is closed');
  }

  const created = await prisma.orderMessage.create({
    data: {
      orderId: order.id,
      authorId: req.user!.id,
      authorRole: party === 'client' ? MessageRole.CLIENT : MessageRole.MASTER,
      text: input.text,
    },
    include: { author: { select: { username: true } } },
  });

  res.status(201).json({ message: messageDTO(created, req.user!.id) });
}

// ── Admin side ───────────────────────────────────────────────────────────────

export async function adminListMessages(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  const q = listSchema.parse(req.query);
  const rows = await listMessagesFor(order.id, q.after);
  res.json({ items: rows.map((row) => messageDTO(row)), open: chatOpen(order) });
}

/** The admin writes into the same thread, so both sides read the same words. */
export async function adminPostMessage(req: Request, res: Response): Promise<void> {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const input = postMessageSchema.parse(req.body);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound('order_not_found', 'Order not found');
  if (!order.masterId) throw conflict('chat_not_open', 'This order has no hired master yet');

  const created = await prisma.orderMessage.create({
    data: { orderId: order.id, authorId: null, authorRole: MessageRole.ADMIN, text: input.text },
  });
  res.status(201).json({ message: messageDTO(created) });
}
