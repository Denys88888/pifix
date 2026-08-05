import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { paymentLimiter } from '../middleware/rateLimit';
import * as payments from '../controllers/paymentsController';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth, paymentLimiter);

paymentsRouter.post('/approve', asyncHandler(payments.approve));
paymentsRouter.post('/complete', asyncHandler(payments.complete));
paymentsRouter.post('/cancel-incomplete', asyncHandler(payments.cancelIncomplete));
paymentsRouter.get('/mine', asyncHandler(payments.myPayments));
paymentsRouter.get('/:paymentId/status', asyncHandler(payments.status));
