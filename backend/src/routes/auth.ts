import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import * as auth from '../controllers/authController';

export const authRouter = Router();

authRouter.post('/pi', authLimiter, asyncHandler(auth.login));
authRouter.get('/me', requireAuth, asyncHandler(auth.me));
authRouter.put('/wallet', requireAuth, asyncHandler(auth.updateWallet));
authRouter.put('/language', requireAuth, asyncHandler(auth.updateLanguage));
authRouter.delete('/account', requireAuth, asyncHandler(auth.deleteAccount));
