import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter, writeLimiter } from '../middleware/rateLimit';
import { upload } from '../middleware/upload';
import { categoryDTO } from '../lib/serializers';
import { getSettings, publicSettings } from '../services/settings';
import * as nearby from '../controllers/nearbyController';
import * as reviews from '../controllers/reviewsController';
import * as uploads from '../controllers/uploadsController';
import * as withdrawals from '../controllers/withdrawalsController';

// ── Public settings & categories ─────────────────────────────────────────────
export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({ settings: publicSettings(settings) });
  }),
);

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ categories: categories.map(categoryDTO) });
  }),
);

// ── Reviews ──────────────────────────────────────────────────────────────────
export const reviewsRouter = Router();

reviewsRouter.post('/', requireAuth, writeLimiter, asyncHandler(reviews.createReview));
reviewsRouter.get('/user/:username', asyncHandler(reviews.listReviews));
reviewsRouter.get('/order/:orderId/status', requireAuth, asyncHandler(reviews.reviewStatus));

// ── Uploads ──────────────────────────────────────────────────────────────────
export const uploadsRouter = Router();

uploadsRouter.post(
  '/:folder',
  requireAuth,
  uploadLimiter,
  upload.array('files', 10),
  asyncHandler(uploads.uploadImages),
);

// ── Withdrawals ──────────────────────────────────────────────────────────────
export const withdrawalsRouter = Router();

withdrawalsRouter.use(requireAuth);
withdrawalsRouter.post('/', writeLimiter, asyncHandler(withdrawals.requestWithdrawal));
withdrawalsRouter.get('/mine', asyncHandler(withdrawals.myWithdrawals));
withdrawalsRouter.delete('/:id', asyncHandler(withdrawals.cancelWithdrawal));

// ── Map: open orders + available masters in one viewport ─────────────────────
export const nearbyRouter = Router();

nearbyRouter.get('/', asyncHandler(nearby.listNearby));
