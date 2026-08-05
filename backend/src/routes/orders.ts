import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { optionalAuth, requireAuth, requireKyc } from '../middleware/auth';
import { createOrderLimiter, writeLimiter } from '../middleware/rateLimit';
import * as orders from '../controllers/ordersController';
import * as responses from '../controllers/responsesController';

export const ordersRouter = Router();

// Browsing is open to any signed-in pioneer; optionalAuth marks own orders.
ordersRouter.get('/', optionalAuth, asyncHandler(orders.listOrders));
ordersRouter.get('/mine', requireAuth, asyncHandler(orders.myOrders));
ordersRouter.post('/', requireAuth, requireKyc, createOrderLimiter, asyncHandler(orders.createOrder));

ordersRouter.get('/:id', optionalAuth, asyncHandler(orders.getOrder));
ordersRouter.get('/:id/quote', requireAuth, asyncHandler(orders.quoteForResponse));
ordersRouter.post('/:id/cancel', requireAuth, asyncHandler(orders.cancelOrder));
ordersRouter.post('/:id/complete', requireAuth, asyncHandler(orders.markCompleted));
ordersRouter.post('/:id/confirm', requireAuth, asyncHandler(orders.confirmOrder));
ordersRouter.post('/:id/dispute', requireAuth, writeLimiter, asyncHandler(orders.openDispute));

// Responses live under their order.
ordersRouter.get('/:id/responses', requireAuth, asyncHandler(responses.listResponses));
ordersRouter.get('/:id/can-respond', requireAuth, requireKyc, asyncHandler(responses.checkCanRespond));
