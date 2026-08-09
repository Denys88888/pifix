import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import * as masters from '../controllers/mastersController';
import * as responses from '../controllers/responsesController';

export const mastersRouter = Router();

mastersRouter.get('/', optionalAuth, asyncHandler(masters.searchMasters));

// Static paths first — "me" must not be swallowed by /:username.
mastersRouter.get('/me/profile', requireAuth, asyncHandler(masters.getMyProfile));
mastersRouter.put('/me/profile', requireAuth, writeLimiter, asyncHandler(masters.upsertProfile));
mastersRouter.put('/me/availability', requireAuth, writeLimiter, asyncHandler(masters.setAvailability));
mastersRouter.get('/me/stats', requireAuth, asyncHandler(masters.myStats));
mastersRouter.get('/me/transactions', requireAuth, asyncHandler(masters.myTransactions));
mastersRouter.get('/me/responses', requireAuth, asyncHandler(responses.myResponses));
mastersRouter.post('/me/verification', requireAuth, writeLimiter, asyncHandler(masters.submitVerification));

mastersRouter.get('/:username', optionalAuth, asyncHandler(masters.getMasterByUsername));

export const responsesRouter = Router();
responsesRouter.delete('/:id', requireAuth, asyncHandler(responses.withdrawResponse));
