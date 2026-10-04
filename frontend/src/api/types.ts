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
  /** Whether to offer the admin entrance. The server re-checks on every call. */
  isAdmin: boolean;
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
  /** Dispute details reach only the two sides and the admin; null for anyone else. */
  disputeReason: string | null;
  disputedBy: 'client' | 'master' | null;
  disputeOpenedAt: string | null;
  resolution: { action: ResolutionAction; note: string | null; at: string | null } | null;
  createdAt: string;
  client: PublicUser | null;
  master: PublicUser | null;
  selectedResponseId: string | null;
  responseCount?: number;
  distanceKm?: number;
  isOwner?: boolean;
}

export interface NotificationSummary {
  unread: number;
  /** Unread chat messages — the badge on the Chats tab. */
  messages: number;
  /** Unread count per order — drives the "new" badges on order cards. */
  byOrder: Record<string, number>;
  /** Unread chat messages per order — the count on an order's chat button. */
  messagesByOrder: Record<string, number>;
}

export interface AppNotification {
  id: string;
  type: string;
  count: number;
  data: Record<string, string>;
  order: { id: string; publicId: string; title: string } | null;
  read: boolean;
  at: string;
}

export type ResolutionAction ='release' | 'refund' | 'refund_with_fees' | 'cancel';

export interface ChatMessage {
  id: string;
  role: 'CLIENT' | 'MASTER' | 'ADMIN';
  username: string | null;
  text: string;
  photos: string[];
  /** Written by the person viewing — always false for the admin's view. */
  mine: boolean;
  createdAt: string;
}

export interface ChatSummary {
  orderId: string;
  publicId: string;
  title: string;
  status: OrderStatus;
  /** Username of the other side. */
  with: string | null;
  withRole: 'client' | 'master';
  last: ChatMessage | null;
  unread: number;
  at: string;
}

export interface ChatPage {
  items: ChatMessage[];
  /** Whether the two sides can still write. */
  open: boolean;
}

/** The viewing master's own response to an order, if they sent one. */
export interface MyResponse {
  id: string;
  pricePi: string;
  message: string;
  status: ResponseStatus;
  connectRefunded: boolean;
  createdAt: string;
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
  /** Known for sure once paid — Pi picks the pioneer's wallet. */
  walletAddress: string | null;
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
  /** Empty when no channel is configured — the app hides the contact block. */
  supportContact: string;
  /** Server capabilities — false while the operator has not configured them. */
  uploadsEnabled: boolean;
  payoutsEnabled: boolean;
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
    /** Whether Pi accepts this server's API key — every payment fails when it does not. */
    piApiKey: 'ok' | 'invalid' | 'unreachable';
    /** The wallet payouts are sent from — derived on the server, never the seed. */
    payoutWallet: { address: string; balancePi: string | null } | null;
    recentPaymentErrors: Array<{
      at: string;
      username: string;
      step: string;
      code: string;
      message: string;
    }>;
    sandbox: boolean;
    payoutsConfigured: boolean;
    cloudinaryConfigured: boolean;
    requireKyc: boolean;
    maintenanceMode: boolean;
  };
}

export interface AdminSettings extends PlatformSettings {
  /** Pay the master out on-chain as soon as a job is confirmed. */
  autoPayoutOnRelease: boolean;
  masterFeePercent: string;
  orderExpiryDays: number;
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
