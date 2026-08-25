import { adminApi, api } from './client';
import type {
  AdminDashboard,
  AdminSettings,
  Category,
  MasterProfile,
  MasterStats,
  NearbyResult,
  Order,
  OrderResponse,
  Paginated,
  PlatformSettings,
  Quote,
  Review,
  SelfUser,
  Transaction,
  Withdrawal,
} from './types';

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  async login(payload: { accessToken: string; referrer?: string; walletAddress?: string; language?: string }) {
    const { data } = await api.post<{ token: string; user: SelfUser; kycKnown: boolean; kycRequired: boolean }>(
      '/auth/pi',
      payload,
    );
    return data;
  },
  async me() {
    const { data } = await api.get<{ user: SelfUser }>('/auth/me');
    return data.user;
  },
  async setWallet(walletAddress: string) {
    const { data } = await api.put<{ user: SelfUser }>('/auth/wallet', { walletAddress });
    return data.user;
  },
  async setLanguage(language: string) {
    await api.put('/auth/language', { language });
  },
  async deleteAccount() {
    await api.delete('/auth/account');
  },
};

// ── Reference data ───────────────────────────────────────────────────────────

/**
 * These two run at boot, which on a free Render instance is exactly when the
 * API may be spinning back up. Render's own warning is "can delay requests by
 * 50 seconds or more", well past the 30 s default, so they get their own
 * longer budget — otherwise the very first visit after an idle period loads an
 * app with no prices and no categories.
 */
const BOOT_TIMEOUT_MS = 90_000;

export const referenceApi = {
  async settings() {
    const { data } = await api.get<{ settings: PlatformSettings }>('/settings', {
      timeout: BOOT_TIMEOUT_MS,
    });
    return data.settings;
  },
  async categories() {
    const { data } = await api.get<{ categories: Category[] }>('/categories', {
      timeout: BOOT_TIMEOUT_MS,
    });
    return data.categories;
  },
};

// ── Orders ───────────────────────────────────────────────────────────────────

export interface OrderFilters {
  page?: number;
  limit?: number;
  category?: string;
  minBudget?: number;
  maxBudget?: number;
  urgentOnly?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: 'date' | 'budget' | 'distance';
  status?: string;
}

export const ordersApi = {
  async list(filters: OrderFilters = {}) {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '' || value === false) continue;
      params[key] = typeof value === 'boolean' ? String(value) : value;
    }
    const { data } = await api.get<Paginated<Order>>('/orders', { params });
    return data;
  },
  async mine(role: 'client' | 'master', page = 1, limit = 20) {
    const { data } = await api.get<Paginated<Order>>('/orders/mine', { params: { role, page, limit } });
    return data;
  },
  async get(id: string) {
    const { data } = await api.get<{ order: Order; quote: Quote }>(`/orders/${id}`);
    return data;
  },
  async create(payload: {
    categorySlug: string;
    title: string;
    description: string;
    budgetPi: string;
    address: string;
    lat: number;
    lng: number;
    isUrgent: boolean;
    photos: string[];
  }) {
    const { data } = await api.post<{ order: Order }>('/orders', payload);
    return data.order;
  },
  async quote(orderId: string, responseId: string) {
    const { data } = await api.get<Quote>(`/orders/${orderId}/quote`, { params: { responseId } });
    return data;
  },
  async cancel(id: string) {
    const { data } = await api.post<{ ok: boolean; refundedConnects: number; withinRefundWindow: boolean }>(
      `/orders/${id}/cancel`,
    );
    return data;
  },
  async markCompleted(id: string) {
    const { data } = await api.post<{ order: Order }>(`/orders/${id}/complete`);
    return data.order;
  },
  async confirm(id: string) {
    const { data } = await api.post<{ order: Order; released: boolean }>(`/orders/${id}/confirm`);
    return data;
  },
  async dispute(id: string, reason: string) {
    const { data } = await api.post<{ order: Order }>(`/orders/${id}/dispute`, { reason });
    return data.order;
  },
  async responses(id: string, params: { page?: number; limit?: number; sort?: 'date' | 'price' | 'rating' } = {}) {
    const { data } = await api.get<Paginated<OrderResponse>>(`/orders/${id}/responses`, { params });
    return data;
  },
  async canRespond(id: string, pricePi: string) {
    const { data } = await api.get<{
      ok: boolean;
      connectPricePi: string;
      activeResponses: number;
      maxActiveResponses: number;
      refundPolicyMinutes: number;
    }>(`/orders/${id}/can-respond`, { params: { pricePi } });
    return data;
  },
};

// ── Masters ──────────────────────────────────────────────────────────────────

export interface MasterFilters {
  page?: number;
  limit?: number;
  category?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  sort?: 'rating' | 'jobs' | 'distance';
  verifiedOnly?: boolean;
}

export const mastersApi = {
  async search(filters: MasterFilters = {}) {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === '') continue;
      params[key] = typeof value === 'boolean' ? String(value) : value;
    }
    const { data } = await api.get<Paginated<MasterProfile>>('/masters', { params });
    return data;
  },
  async byUsername(username: string) {
    const { data } = await api.get<{ profile: MasterProfile; reviews: Review[] }>(
      `/masters/${encodeURIComponent(username)}`,
    );
    return data;
  },
  async myProfile() {
    const { data } = await api.get<{ profile: MasterProfile | null }>('/masters/me/profile');
    return data.profile;
  },
  /** The "I am taking work" switch that puts the master's pin on the map. */
  async setAvailability(isAvailable: boolean) {
    const { data } = await api.put<{ profile: MasterProfile }>('/masters/me/availability', {
      isAvailable,
    });
    return data.profile;
  },
  async saveProfile(payload: {
    displayName: string;
    bio: string;
    avatarUrl?: string | null;
    address?: string;
    lat?: number | null;
    lng?: number | null;
    radiusKm: number;
    categories: string[];
    portfolio: string[];
    certificates: string[];
  }) {
    const { data } = await api.put<{ profile: MasterProfile }>('/masters/me/profile', payload);
    return data.profile;
  },
  async stats() {
    const { data } = await api.get<MasterStats>('/masters/me/stats');
    return data;
  },
  async transactions(page = 1, limit = 20) {
    const { data } = await api.get<Paginated<Transaction>>('/masters/me/transactions', {
      params: { page, limit },
    });
    return data;
  },
  async myResponses(page = 1, limit = 20, status?: string) {
    const { data } = await api.get<Paginated<OrderResponse>>('/masters/me/responses', {
      params: { page, limit, status },
    });
    return data;
  },
  async submitVerification(documents: string[]) {
    const { data } = await api.post<{ profile: MasterProfile }>('/masters/me/verification', { documents });
    return data.profile;
  },
  async withdrawResponse(responseId: string) {
    const { data } = await api.delete<{ ok: boolean; refunded: boolean }>(`/responses/${responseId}`);
    return data;
  },
};

// ── Payments ─────────────────────────────────────────────────────────────────

export const paymentsApi = {
  async approve(paymentId: string) {
    const { data } = await api.post('/payments/approve', { paymentId });
    return data;
  },
  async complete(paymentId: string, txid: string) {
    const { data } = await api.post('/payments/complete', { paymentId, txid });
    return data;
  },
  async cancelIncomplete(payment: unknown) {
    const { data } = await api.post('/payments/cancel-incomplete', { payment });
    return data;
  },
  async status(paymentId: string) {
    const { data } = await api.get<{
      paymentId: string;
      status: string;
      type: string;
      amountPi: string;
      txid: string | null;
      responseId: string | null;
      order: { id: string; publicId: string; status: string } | null;
      errorText: string | null;
    }>(`/payments/${paymentId}/status`);
    return data;
  },
};

// ── Reviews ──────────────────────────────────────────────────────────────────

export const reviewsApi = {
  async create(payload: { orderId: string; rating: number; text: string }) {
    const { data } = await api.post<{ review: Review }>('/reviews', payload);
    return data.review;
  },
  async forUser(username: string, page = 1, limit = 20) {
    const { data } = await api.get<Paginated<Review> & { ratingAvg: number; ratingCount: number }>(
      `/reviews/user/${encodeURIComponent(username)}`,
      { params: { page, limit } },
    );
    return data;
  },
  async status(orderId: string) {
    const { data } = await api.get<{ canReview: boolean; alreadyReviewed: boolean }>(
      `/reviews/order/${orderId}/status`,
    );
    return data;
  },
};

// ── Uploads ──────────────────────────────────────────────────────────────────

export type UploadFolder = 'avatars' | 'portfolio' | 'orders' | 'certificates' | 'verification';

export const uploadsApi = {
  async images(folder: UploadFolder, files: File[], onProgress?: (percent: number) => void) {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    const { data } = await api.post<{ files: Array<{ url: string; publicId: string }> }>(
      `/uploads/${folder}`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
        },
      },
    );
    return data.files;
  },
};

// ── Withdrawals ──────────────────────────────────────────────────────────────

export const withdrawalsApi = {
  async request(amountPi: string) {
    const { data } = await api.post<{ withdrawal: Withdrawal }>('/withdrawals', { amountPi });
    return data.withdrawal;
  },
  async mine(page = 1, limit = 20) {
    const { data } = await api.get<Paginated<Withdrawal> & { balancePi: string; minWithdrawalPi: string }>(
      '/withdrawals/mine',
      { params: { page, limit } },
    );
    return data;
  },
  async cancel(id: string) {
    await api.delete(`/withdrawals/${id}`);
  },
};

// ── Admin ────────────────────────────────────────────────────────────────────

export const adminApiClient = {
  async login(username: string, password: string) {
    const { data } = await adminApi.post<{ token: string; username: string }>('/admin/login', {
      username,
      password,
    });
    return data;
  },
  /**
   * Trades the signed-in Pi session for an admin token. Goes through the normal
   * user client, not adminApi, because the credential being presented here is
   * the pioneer's own token.
   */
  async loginWithPi() {
    const { data } = await api.post<{ token: string; username: string }>('/admin/login-pi');
    return data;
  },
  async dashboard() {
    const { data } = await adminApi.get<AdminDashboard>('/admin/dashboard');
    return data;
  },
  async orders(params: Record<string, string | number | undefined>) {
    const { data } = await adminApi.get<Paginated<Order>>('/admin/orders', { params });
    return data;
  },
  async order(id: string) {
    const { data } = await adminApi.get(`/admin/orders/${id}`);
    return data;
  },
  async resolveOrder(id: string, action: 'release' | 'refund' | 'refund_with_fees' | 'cancel', note?: string) {
    const { data } = await adminApi.post<{ order: Order }>(`/admin/orders/${id}/resolve`, { action, note });
    return data.order;
  },
  async masters(params: Record<string, string | number | undefined>) {
    const { data } = await adminApi.get<Paginated<MasterProfile>>('/admin/masters', { params });
    return data;
  },
  async verifyMaster(id: string, decision: 'approve' | 'reject', note?: string) {
    const { data } = await adminApi.post<{ profile: MasterProfile }>(`/admin/masters/${id}/verify`, {
      decision,
      note,
    });
    return data.profile;
  },
  async blockUser(id: string, blocked: boolean, note?: string) {
    const { data } = await adminApi.post(`/admin/users/${id}/block`, { blocked, note });
    return data;
  },
  async reviews(params: Record<string, string | number | undefined>) {
    const { data } = await adminApi.get<Paginated<Review>>('/admin/reviews', { params });
    return data;
  },
  async hideReview(id: string, hidden: boolean) {
    await adminApi.post(`/admin/reviews/${id}/hide`, { hidden });
  },
  async settings() {
    const { data } = await adminApi.get<{ settings: AdminSettings }>('/admin/settings');
    return data.settings;
  },
  async saveSettings(patch: Record<string, string | number | boolean>) {
    const { data } = await adminApi.put<{ settings: AdminSettings }>('/admin/settings', patch);
    return data.settings;
  },
  async withdrawals(params: Record<string, string | number | undefined>) {
    const { data } = await adminApi.get<Paginated<Withdrawal>>('/admin/withdrawals', { params });
    return data;
  },
  async payWithdrawal(id: string) {
    const { data } = await adminApi.post<{ withdrawal: Withdrawal }>(`/admin/withdrawals/${id}/pay`);
    return data.withdrawal;
  },
  async rejectWithdrawal(id: string, note?: string) {
    const { data } = await adminApi.post<{ withdrawal: Withdrawal }>(`/admin/withdrawals/${id}/reject`, { note });
    return data.withdrawal;
  },
};

// ── Map ──────────────────────────────────────────────────────────────────────

export interface NearbyQuery {
  lat: number;
  lng: number;
  /** METRES, matching what a map viewport gives you. */
  radius?: number;
  type?: 'tasks' | 'workers' | 'all';
  category?: string;
  limit?: number;
}

export const mapApi = {
  async nearby(query: NearbyQuery) {
    const { data } = await api.get<NearbyResult>('/nearby', { params: query });
    return data;
  },
};
