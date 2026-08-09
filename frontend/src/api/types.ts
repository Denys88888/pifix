export type OrderStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

export type EscrowStatus = 'NONE' | 'FUNDED' | 'RELEASED' | 'REFUNDED';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ResponseStatus = 'ACTIVE' | 'SELECTED' | 'REJECTED' | 'WITHDRAWN';
export type PaymentStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
export type WithdrawalStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';

export interface PublicUser {
  id: string;
  username: string;
  ratingAvg: number;
  ratingCount: number;
}

export interface MasterProfile {
  id: string;
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  portfolio: string[];
  certificates: string[];
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  verificationDocs?: string[];
  completedJobs: number;
  isBoosted: boolean;
  isPro: boolean;
  /** The master's own "taking work now" switch. */
  isAvailable: boolean;
  /** Derived server-side from lastSeenAt — never sent by the client. */
  isOnline: boolean;
  boostedUntil: string | null;
  proUntil: string | null;
  ratingAvg: number;
  ratingCount: number;
  categories: string[];
  distanceKm?: number;
  isBlocked?: boolean;
  createdAt: string;
}

export interface SelfUser {
  id: string;
  username: string;
  walletAddress: string | null;
  language: string;
  isMaster: boolean;
  isBlocked: boolean;
  kycVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  balancePi: string;
  totalEarnedPi: string;
  referralLink: string;
  createdAt: string;
  masterProfile: MasterProfile | null;
}

export interface Order {
  id: string;
  publicId: string;
  title: string;
  description: string;
  category: string | null;
  categoryIcon: string | null;
  budgetPi: string;
  address: string;
  lat: number;
  lng: number;
  isUrgent: boolean;
  photos: string[];
  status: OrderStatus;
  escrowStatus: EscrowStatus;
  escrowAmountPi: string;
  clientFeePi: string;
  expressFeePi: string;
  totalPaidPi: string;
  masterPayoutPi: string;
  autoReleaseAt: string | null;
  completedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  disputeReason: string | null;
  createdAt: string;
  client: PublicUser | null;
  master: PublicUser | null;
  selectedResponseId: string | null;
  responseCount?: number;
  distanceKm?: number;
  isOwner?: boolean;
}

export interface OrderResponse {
  id: string;
  orderId: string;
  masterId: string;
  pricePi: string;
  message: string;
  status: ResponseStatus;
  createdAt: string;
  master: PublicUser | null;
  masterName: string | null;
  masterAvatar: string | null;
  masterCompletedJobs: number;
  masterVerified: boolean;
  masterBoosted: boolean;
  order?: {
    id: string;
    publicId: string;
    title: string;
    status: OrderStatus;
    budgetPi: string;
    category: string;
    address: string;
    isUrgent: boolean;
  };
}

export interface Review {
  id: string;
  rating: number;
  text: string;
  role: 'CLIENT_TO_MASTER' | 'MASTER_TO_CLIENT';
  createdAt: string;
  author: PublicUser | null;
  orderTitle: string | null;
  orderPublicId: string | null;
  targetUsername?: string;
  isHidden?: boolean;
}

export interface Transaction {
  id: string;
  type: string;
  amountPi: string;
  balanceAfter: string;
  description: string;
  orderPublicId: string | null;
  createdAt: string;
}

export interface Withdrawal {
  id: string;
  amountPi: string;
  walletAddress: string;
  status: WithdrawalStatus;
  txid: string | null;
  adminNote: string | null;
  username: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface Category {
  id: string;
  slug: string;
  icon: string;
  sortOrder: number;
}

export interface PlatformSettings {
  connectPricePi: string;
  clientFeePercent: string;
  expressFeePi: string;
  profileBoostPricePi: string;
  proSubscriptionPricePi: string;
  escrowTimeoutDays: number;
  referralBonusDirectPi: string;
  referralBonusIndirectPi: string;
  minBudgetPi: string;
  maxOpenOrdersPerClient: number;
  maxActiveResponsesPerMaster: number;
  connectRefundWindowMinutes: number;
  minWithdrawalPi: string;
  maintenanceMode: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  /**
   * Distance searches rank a bounded candidate set in memory. When the cap is
   * hit this is true and `total` is a floor, not the real count — the list is
   * showing the nearest matches, not all of them.
   */
  truncated?: boolean;
}

export interface Quote {
  escrowAmountPi: string;
  clientFeePi: string;
  expressFeePi: string;
  totalPi: string;
  clientFeePercent?: string;
}

export interface MasterStats {
  completedJobs: number;
  activeJobs: number;
  activeResponses: number;
  ratingAvg: number;
  ratingCount: number;
  balancePi: string;
  totalEarnedPi: string;
  inEscrowPi: string;
  pendingWithdrawals: number;
  verificationStatus: VerificationStatus;
  walletAddress: string | null;
}

export interface AdminDashboard {
  users: { total: number; masters: number; verifiedMasters: number };
  orders: { total: number; open: number; completed: number; disputes: number };
  queue: { pendingVerifications: number; pendingWithdrawals: number };
  revenue: {
    todayPi: string;
    weekPi: string;
    monthPi: string;
    todayUsd: string | null;
    weekUsd: string | null;
    monthUsd: string | null;
    piUsdRate: string;
  };
  liabilities: { escrowHeldPi: string; userBalancesPi: string };
  system: {
    sandbox: boolean;
    payoutsConfigured: boolean;
    cloudinaryConfigured: boolean;
    requireKyc: boolean;
    maintenanceMode: boolean;
  };
}

export interface AdminSettings extends PlatformSettings {
  masterFeePercent: string;
  autoWithdrawalPi: string;
  piUsdRate: string;
  updatedAt: string;
}

// ── Map: /api/nearby ─────────────────────────────────────────────────────────

export interface NearbyTask {
  kind: 'task';
  id: string;
  title: string;
  lat: number;
  lng: number;
  distanceKm: number;
  budgetPi: string;
  isUrgent: boolean;
  category: string | null;
  categoryIcon: string | null;
  createdAt: string;
}

export interface NearbyWorker {
  kind: 'worker';
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  isOnline: boolean;
  isBoosted: boolean;
  categories: string[];
}

export interface NearbyResult {
  center: { lat: number; lng: number };
  radiusMeters: number;
  onlineWindowMs: number;
  tasks: NearbyTask[];
  workers: NearbyWorker[];
  /** True when either list hit the server candidate cap; counts are a floor. */
  truncated: boolean;
}
