import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { money } from '../lib/money';
import {
  approveIncomingPayment,
  completeIncomingPayment,
  handleIncompletePayment,
} from '../services/paymentVerification';

export const approveSchema = z.object({ paymentId: z.string().min(4).max(128) });
export const completeSchema = z.object({
  paymentId: z.string().min(4).max(128),
  txid: z.string().min(4).max(128),
});

/**
 * Pi SDK callback: onReadyForServerApproval.
 * The server re-derives the price and the eligibility rules before approving,
 * so a tampered `metadata`/`amount` never gets past this point.
 */
export async function approve(req: Request, res: Response): Promise<void> {
  const input = approveSchema.parse(req.body);
  const result = await approveIncomingPayment(input.paymentId, req.user!);
  res.json(result);
}

/** Pi SDK callback: onReadyForServerCompletion. Grants the purchase. */
export async function complete(req: Request, res: Response): Promise<void> {
  const input = completeSchema.parse(req.body);
  const result = await completeIncomingPayment(input.paymentId, input.txid, req.user!);
  res.json(result);
}

/**
 * Pi SDK callback: onIncompletePaymentFound.
 * Accepts either the full payment object the SDK hands over or just its id.
 */
export const cancelIncompleteSchema = z.object({
  payment: z
    .object({ identifier: z.string().min(4).max(128) })
    .passthrough()
    .optional(),
  paymentId: z.string().min(4).max(128).optional(),
});

export async function cancelIncomplete(req: Request, res: Response): Promise<void> {
  const input = cancelIncompleteSchema.parse(req.body);
  const paymentId = input.paymentId ?? input.payment?.identifier;
  if (!paymentId) {
    res.status(400).json({ error: { code: 'no_payment_id', message: 'paymentId is required' } });
    return;
  }
  const result = await handleIncompletePayment(paymentId, req.user!);
  res.json(result);
}

/** Polled by the frontend every 3 s while a payment is in flight. */
export async function status(req: Request, res: Response): Promise<void> {
  const { paymentId } = z.object({ paymentId: z.string().min(4).max(128) }).parse(req.params);

  const payment = await prisma.payment.findUnique({
    where: { piPaymentId: paymentId },
    include: { order: { select: { id: true, publicId: true, status: true } } },
  });
  if (!payment) throw notFound('payment_not_found', 'Payment not found');
  if (payment.userId !== req.user!.id) throw notFound('payment_not_found', 'Payment not found');

  res.json({
    paymentId: payment.piPaymentId,
    status: payment.status,
    type: payment.type,
    amountPi: money(payment.amountPi),
    txid: payment.txid,
    responseId: payment.responseId,
    order: payment.order,
    errorText: payment.errorText,
    updatedAt: payment.updatedAt.toISOString(),
  });
}

export async function myPayments(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);

  const where = { userId: req.user!.id };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { order: { select: { publicId: true, title: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  res.json({
    items: rows.map((payment) => ({
      id: payment.id,
      paymentId: payment.piPaymentId,
      type: payment.type,
      direction: payment.direction,
      status: payment.status,
      amountPi: money(payment.amountPi),
      memo: payment.memo,
      txid: payment.txid,
      orderTitle: payment.order?.title ?? null,
      createdAt: payment.createdAt.toISOString(),
    })),
    page: q.page,
    limit: q.limit,
    total,
    hasMore: q.page * q.limit < total,
  });
}
