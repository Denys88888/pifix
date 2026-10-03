import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { paymentLimiter, pollLimiter } from '../middleware/rateLimit';
import * as payments from '../controllers/paymentsController';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

// The status poll runs every 3 s while a payment is in flight. Under the
// 20-per-15-minutes payment brake one slow payment used up the allowance, and
// the next approval — the call Pi waits on — was refused as rate limited.
paymentsRouter.get('/:paymentId/status', pollLimiter, asyncHandler(payments.status));

paymentsRouter.use(paymentLimiter);

paymentsRouter.post('/approve', asyncHandler(payments.approve));
paymentsRouter.post('/complete', asyncHandler(payments.complete));
paymentsRouter.post('/cancel-incomplete', asyncHandler(payments.cancelIncomplete));
paymentsRouter.get('/mine', asyncHandler(payments.myPayments));
