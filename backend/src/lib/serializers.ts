import type {
  Category,
  MasterProfile,
  Order,
  Review,
  Transaction,
  User,
  WithdrawalRequest,
} from '@prisma/client';
import { money } from './money';

type WithCategory = Order & { category?: Category | null };
type WithClient = { client?: Pick<User, 'id' | 'username' | 'ratingAvg' | 'ratingCount'> | null };
type WithMaster = { master?: Pick<User, 'id' | 'username' | 'ratingAvg' | 'ratingCount'> | null };
type WithCounts = { _count?: { responses?: number } };

export function publicUser(user: Pick<User, 'id' | 'username' | 'ratingAvg' | 'ratingCount'> | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    ratingAvg: Number(user.ratingAvg),
    ratingCount: user.ratingCount,
  };
}

export function selfUser(user: User & { masterProfile?: MasterProfile | null }) {
  return {
    id: user.id,
    username: user.username,
    walletAddress: user.walletAddress,
    language: user.language,
    isMaster: user.isMaster,
    isBlocked: user.isBlocked,
    kycVerified: user.kycVerified,
    ratingAvg: Number(user.ratingAvg),
    ratingCount: user.ratingCount,
    balancePi: money(user.balancePi),
    totalEarnedPi: money(user.totalEarnedPi),
    referralLink: `?ref=${user.username}`,
    createdAt: user.createdAt.toISOString(),
    masterProfile: user.masterProfile ? masterProfileDTO(user.masterProfile) : null,
  };
}

export function masterProfileDTO(
  profile: MasterProfile & {
    user?: Pick<User, 'id' | 'username' | 'ratingAvg' | 'ratingCount'> | null;
    categories?: Array<{ category: Category }>;
  },
  extra: { distanceKm?: number } = {},
) {
  return {
    id: profile.id,
    userId: profile.userId,
    username: profile.user?.username ?? null,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    address: profile.address,
    lat: profile.lat,
    lng: profile.lng,
    radiusKm: profile.radiusKm,
    portfolio: profile.portfolio,
    certificates: profile.certificates,
    verificationStatus: profile.verificationStatus,
    verificationNote: profile.verificationNote,
    completedJobs: profile.completedJobs,
    isBoosted: Boolean(profile.boostedUntil && profile.boostedUntil > new Date()),
    isPro: Boolean(profile.proUntil && profile.proUntil > new Date()),
    boostedUntil: profile.boostedUntil?.toISOString() ?? null,
    proUntil: profile.proUntil?.toISOString() ?? null,
    ratingAvg: profile.user ? Number(profile.user.ratingAvg) : 0,
    ratingCount: profile.user?.ratingCount ?? 0,
    categories: profile.categories?.map((link) => link.category.slug) ?? [],
    distanceKm: extra.distanceKm,
    createdAt: profile.createdAt.toISOString(),
  };
}

export function orderDTO(
  order: WithCategory & WithClient & WithMaster & WithCounts,
  extra: { distanceKm?: number; viewerIsOwner?: boolean } = {},
) {
  return {
    id: order.id,
    publicId: order.publicId,
    title: order.title,
    description: order.description,
    category: order.category?.slug ?? null,
    categoryIcon: order.category?.icon ?? null,
    budgetPi: money(order.budgetPi),
    address: order.address,
    lat: order.lat,
    lng: order.lng,
    isUrgent: order.isUrgent,
    photos: order.photos,
    status: order.status,
    escrowStatus: order.escrowStatus,
    escrowAmountPi: money(order.escrowAmountPi),
    clientFeePi: money(order.clientFeePi),
    expressFeePi: money(order.expressFeePi),
    totalPaidPi: money(order.totalPaidPi),
    masterPayoutPi: money(order.masterPayoutPi),
    autoReleaseAt: order.autoReleaseAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    disputeReason: order.disputeReason,
    createdAt: order.createdAt.toISOString(),
    client: publicUser(order.client),
    master: publicUser(order.master),
    selectedResponseId: order.selectedResponseId,
    responseCount: order._count?.responses ?? undefined,
    distanceKm: extra.distanceKm,
    isOwner: extra.viewerIsOwner,
  };
}

export function reviewDTO(
  review: Review & {
    author?: Pick<User, 'id' | 'username' | 'ratingAvg' | 'ratingCount'> | null;
    order?: Pick<Order, 'publicId' | 'title'> | null;
  },
) {
  return {
    id: review.id,
    rating: review.rating,
    text: review.text,
    role: review.role,
    createdAt: review.createdAt.toISOString(),
    author: publicUser(review.author),
    orderTitle: review.order?.title ?? null,
    orderPublicId: review.order?.publicId ?? null,
  };
}

export function transactionDTO(transaction: Transaction & { order?: Pick<Order, 'publicId'> | null }) {
  return {
    id: transaction.id,
    type: transaction.type,
    amountPi: money(transaction.amountPi),
    balanceAfter: money(transaction.balanceAfter),
    description: transaction.description,
    orderPublicId: transaction.order?.publicId ?? null,
    createdAt: transaction.createdAt.toISOString(),
  };
}

export function withdrawalDTO(withdrawal: WithdrawalRequest & { user?: Pick<User, 'username'> | null }) {
  return {
    id: withdrawal.id,
    amountPi: money(withdrawal.amountPi),
    walletAddress: withdrawal.walletAddress,
    status: withdrawal.status,
    txid: withdrawal.txid,
    adminNote: withdrawal.adminNote,
    username: withdrawal.user?.username ?? null,
    createdAt: withdrawal.createdAt.toISOString(),
    processedAt: withdrawal.processedAt?.toISOString() ?? null,
  };
}

export function categoryDTO(category: Category) {
  return { id: category.id, slug: category.slug, icon: category.icon, sortOrder: category.sortOrder };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export function paginate<T>(items: T[], page: number, limit: number, total: number): Paginated<T> {
  return { items, page, limit, total, hasMore: page * limit < total };
}
