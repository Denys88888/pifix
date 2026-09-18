import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { requireAdmin } from '../middleware/adminAuth';
import { requireAuth } from '../middleware/auth';
import { adminLoginLimiter, piAdminLimiter } from '../middleware/rateLimit';
import * as admin from '../controllers/adminController';

export const adminRouter = Router();

adminRouter.post('/login', adminLoginLimiter, asyncHandler(admin.adminLogin));

/*
 * The developer's own Pi session, traded for an admin token.
 *
 * NOT the password limiter: there is no secret to guess here — requireAuth has
 * already proved who the caller is, and the uid either is in ADMIN_UIDS or is
 * not. Sharing the 10-per-15-minutes brake meant the panel locked the developer
 * out of their own phone after ten openings and dropped them on the password
 * page with no explanation. The brake that belongs here is per-user and only
 * has to stop a loop, so requireAuth runs first and the key is the user id.
 */
adminRouter.post('/login-pi', requireAuth, piAdminLimiter, asyncHandler(admin.adminLoginWithPi));

// Everything below requires a valid admin JWT or HTTP Basic Auth.
adminRouter.use(requireAdmin);

adminRouter.get('/dashboard', asyncHandler(admin.dashboard));

adminRouter.get('/orders', asyncHandler(admin.listOrders));
adminRouter.get('/orders/:id', asyncHandler(admin.getOrder));
adminRouter.post('/orders/:id/resolve', asyncHandler(admin.resolveOrder));

adminRouter.get('/masters', asyncHandler(admin.listMasters));
adminRouter.post('/masters/:id/verify', asyncHandler(admin.verifyMaster));
adminRouter.post('/users/:id/block', asyncHandler(admin.blockUser));

adminRouter.get('/reviews', asyncHandler(admin.listReviews));
adminRouter.post('/reviews/:id/hide', asyncHandler(admin.hideReview));

adminRouter.get('/settings', asyncHandler(admin.getAdminSettings));
adminRouter.put('/settings', asyncHandler(admin.putAdminSettings));

adminRouter.get('/withdrawals', asyncHandler(admin.listWithdrawals));
adminRouter.post('/withdrawals/:id/pay', asyncHandler(admin.payWithdrawal));
adminRouter.post('/withdrawals/:id/reject', asyncHandler(admin.rejectWithdrawal));
// Settles a payout whose result was never confirmed, by asking Pi and the ledger.
adminRouter.post('/withdrawals/:id/reconcile', asyncHandler(admin.reconcileWithdrawal));

adminRouter.get('/audit-log', asyncHandler(admin.listAuditLog));
