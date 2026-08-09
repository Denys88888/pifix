import type { Request, Response } from 'express';
import { OrderStatus, Prisma, VerificationStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, conflict, notFound } from '../lib/errors';
import { money } from '../lib/money';
import { GEO_CANDIDATE_CAP, masterProfileDTO, paginate, reviewDTO, transactionDTO } from '../lib/serializers';
import { boundingBox, haversineKm, roundDistance } from '../services/geolocation';

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().min(10, 'Tell clients what you do').max(1000),
  avatarUrl: z.string().url().nullable().optional(),
  address: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  radiusKm: z.number().int().min(1).max(100).default(20),
  categories: z.array(z.string().min(1).max(40)).min(1, 'Pick at least one category').max(12),
  portfolio: z.array(z.string().url()).max(10).default([]),
  certificates: z.array(z.string().url()).max(10).default([]),
});

export const searchMastersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  category: z.string().max(40).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(500).optional(),
  sort: z.enum(['rating', 'jobs', 'distance']).default('rating'),
  verifiedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
});

const profileInclude = {
  user: { select: { id: true, username: true, ratingAvg: true, ratingCount: true, lastSeenAt: true } },
  categories: { include: { category: true } },
} as const;

export async function upsertProfile(req: Request, res: Response): Promise<void> {
  const input = profileSchema.parse(req.body);
  const userId = req.user!.id;

  const categories = await prisma.category.findMany({
    where: { slug: { in: input.categories }, isActive: true },
    select: { id: true, slug: true },
  });
  if (categories.length !== input.categories.length) {
    throw badRequest('unknown_category', 'One or more categories are unknown');
  }

  const existing = await prisma.masterProfile.findUnique({ where: { userId } });

  const profile = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.masterProfile.update({
          where: { userId },
          data: {
            displayName: input.displayName,
            bio: input.bio,
            avatarUrl: input.avatarUrl ?? existing.avatarUrl,
            address: input.address ?? existing.address,
            lat: input.lat ?? existing.lat,
            lng: input.lng ?? existing.lng,
            radiusKm: input.radiusKm,
            portfolio: input.portfolio,
            certificates: input.certificates,
          },
        })
      : await tx.masterProfile.create({
          data: {
            userId,
            displayName: input.displayName,
            bio: input.bio,
            avatarUrl: input.avatarUrl ?? null,
            address: input.address ?? null,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            radiusKm: input.radiusKm,
            portfolio: input.portfolio,
            certificates: input.certificates,
          },
        });

    await tx.masterCategory.deleteMany({ where: { masterProfileId: saved.id } });
    await tx.masterCategory.createMany({
      data: categories.map((category) => ({ masterProfileId: saved.id, categoryId: category.id })),
    });

    await tx.user.update({ where: { id: userId }, data: { isMaster: true } });

    return tx.masterProfile.findUniqueOrThrow({ where: { id: saved.id }, include: profileInclude });
  });

  logger.info('Master profile saved', { userId, isNew: !existing });
  res.status(existing ? 200 : 201).json({ profile: masterProfileDTO(profile) });
}

export async function getMyProfile(req: Request, res: Response): Promise<void> {
  const profile = await prisma.masterProfile.findUnique({
    where: { userId: req.user!.id },
    include: profileInclude,
  });
  res.json({ profile: profile ? masterProfileDTO(profile) : null });
}

const availabilitySchema = z.object({ isAvailable: z.boolean() });

/**
 * The master's "I am taking work" switch, which is what puts their green pin on
 * the map. Deliberately separate from upsertProfile: that one is a full-form
 * PUT, and a master toggling availability from the dashboard must not have to
 * round-trip their whole bio and category list to do it.
 */
export async function setAvailability(req: Request, res: Response): Promise<void> {
  const { isAvailable } = availabilitySchema.parse(req.body);

  const existing = await prisma.masterProfile.findUnique({
    where: { userId: req.user!.id },
    select: { id: true, lat: true, lng: true },
  });
  if (!existing) throw notFound('profile_not_found', 'Create a master profile first');

  // Going available without a home point would mean a pin at (null, null) —
  // the map query filters those out, so the master would silently never appear.
  if (isAvailable && (existing.lat === null || existing.lng === null)) {
    throw badRequest('location_required', 'Set your work location before going available');
  }

  const profile = await prisma.masterProfile.update({
    where: { id: existing.id },
    data: { isAvailable },
    include: profileInclude,
  });

  res.json({ profile: masterProfileDTO(profile) });
}

export async function getMasterByUsername(req: Request, res: Response): Promise<void> {
  const { username } = z.object({ username: z.string().min(1).max(64) }).parse(req.params);

  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, isDeleted: false },
    include: { masterProfile: { include: profileInclude } },
  });
  if (!user?.masterProfile) throw notFound('master_not_found', 'Master not found');

  const reviews = await prisma.review.findMany({
    where: { targetId: user.id, isHidden: false },
    include: {
      author: { select: { id: true, username: true, ratingAvg: true, ratingCount: true } },
      order: { select: { publicId: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  res.json({
    profile: masterProfileDTO(user.masterProfile),
    reviews: reviews.map(reviewDTO),
  });
}

export async function searchMasters(req: Request, res: Response): Promise<void> {
  const q = searchMastersSchema.parse(req.query);

  const where: Prisma.MasterProfileWhereInput = {
    user: { isBlocked: false, isDeleted: false },
    ...(q.verifiedOnly ? { verificationStatus: VerificationStatus.VERIFIED } : {}),
    ...(q.category ? { categories: { some: { category: { slug: q.category } } } } : {}),
  };

  const geoActive = q.lat !== undefined && q.lng !== undefined && q.radiusKm !== undefined;
  if (geoActive) {
    const box = boundingBox(q.lat!, q.lng!, q.radiusKm!);
    where.lat = { gte: box.minLat, lte: box.maxLat };
    where.lng = { gte: box.minLng, lte: box.maxLng };
  }

  // Boosted profiles float to the top of every ordering.
  const orderBy: Prisma.MasterProfileOrderByWithRelationInput[] = [
    { boostedUntil: { sort: 'desc', nulls: 'last' } },
    q.sort === 'jobs' ? { completedJobs: 'desc' } : { user: { ratingAvg: 'desc' } },
  ];

  if (geoActive) {
    const candidates = await prisma.masterProfile.findMany({
      where,
      include: profileInclude,
      orderBy,
      take: GEO_CANDIDATE_CAP,
    });

    const within = candidates
      .map((profile) => ({
        profile,
        distanceKm:
          profile.lat !== null && profile.lng !== null
            ? roundDistance(haversineKm(q.lat!, q.lng!, profile.lat, profile.lng))
            : Number.POSITIVE_INFINITY,
      }))
      // A master's own working radius also has to cover the point.
      .filter((entry) => entry.distanceKm <= Math.min(q.radiusKm!, entry.profile.radiusKm));

    if (q.sort === 'distance') within.sort((a, b) => a.distanceKm - b.distanceKm);

    const total = within.length;
    const start = (q.page - 1) * q.limit;
    const items = within
      .slice(start, start + q.limit)
      .map((entry) => masterProfileDTO(entry.profile, { distanceKm: entry.distanceKm }));

    res.json(paginate(items, q.page, q.limit, total, candidates.length === GEO_CANDIDATE_CAP));
    return;
  }

  const [rows, total] = await Promise.all([
    prisma.masterProfile.findMany({
      where,
      include: profileInclude,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.masterProfile.count({ where }),
  ]);

  res.json(paginate(rows.map((profile) => masterProfileDTO(profile)), q.page, q.limit, total));
}

export const verificationSchema = z.object({
  documents: z
    .array(z.string().url())
    .min(2, 'Upload the ID document and a selfie holding it')
    .max(4),
});

/** Qualification verification (not Pi KYC): ID + selfie reviewed by an admin. */
export async function submitVerification(req: Request, res: Response): Promise<void> {
  const input = verificationSchema.parse(req.body);

  const profile = await prisma.masterProfile.findUnique({ where: { userId: req.user!.id } });
  if (!profile) throw badRequest('no_master_profile', 'Create a master profile first');
  if (profile.verificationStatus === VerificationStatus.VERIFIED) {
    throw conflict('already_verified', 'Your profile is already verified');
  }
  if (profile.verificationStatus === VerificationStatus.PENDING) {
    throw conflict('verification_pending', 'Your documents are already under review');
  }

  const updated = await prisma.masterProfile.update({
    where: { userId: req.user!.id },
    data: {
      verificationDocs: input.documents,
      verificationStatus: VerificationStatus.PENDING,
      verificationNote: null,
    },
    include: profileInclude,
  });

  logger.info('Verification submitted', { userId: req.user!.id });
  res.json({ profile: masterProfileDTO(updated) });
}

/** Master dashboard: jobs done, Pi earned, rating, withdrawable balance. */
export async function myStats(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;

  const [user, profile, completed, active, activeResponses, pendingWithdrawals] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.masterProfile.findUnique({ where: { userId } }),
    prisma.order.count({ where: { masterId: userId, status: OrderStatus.COMPLETED } }),
    prisma.order.count({
      where: { masterId: userId, status: { in: [OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_CONFIRMATION] } },
    }),
    prisma.response.count({ where: { masterId: userId, status: 'ACTIVE' } }),
    prisma.withdrawalRequest.count({ where: { userId, status: { in: ['REQUESTED', 'APPROVED'] } } }),
  ]);

  const escrowHeld = await prisma.order.aggregate({
    where: {
      masterId: userId,
      escrowStatus: 'FUNDED',
    },
    _sum: { masterPayoutPi: true },
  });

  res.json({
    completedJobs: completed,
    activeJobs: active,
    activeResponses: activeResponses,
    ratingAvg: Number(user.ratingAvg),
    ratingCount: user.ratingCount,
    balancePi: money(user.balancePi),
    totalEarnedPi: money(user.totalEarnedPi),
    inEscrowPi: money(escrowHeld._sum.masterPayoutPi ?? 0),
    pendingWithdrawals,
    verificationStatus: profile?.verificationStatus ?? VerificationStatus.UNVERIFIED,
    walletAddress: user.walletAddress,
  });
}

export async function myTransactions(req: Request, res: Response): Promise<void> {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);

  const where = { userId: req.user!.id };
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { order: { select: { publicId: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json(paginate(rows.map(transactionDTO), q.page, q.limit, total));
}
