import { Router } from 'express';
import { asyncHandler } from '../middleware/validate';
import { requireAdmin } from '../middleware/adminAuth';
import { adminLoginLimiter } from '../middleware/rateLimit';
import * as admin from '../controllers/adminController';

export const adminRouter = Router();

adminRouter.post('/login', adminLoginLimiter, asyncHandler(admin.adminLogin));

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

adminRouter.get('/audit-log', asyncHandler(admin.listAuditLog));
