import type { Request, Response } from 'express';
import { OrderStatus, VerificationStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { GEO_CANDIDATE_CAP, isRecentlySeen, ONLINE_WINDOW_MS } from '../lib/serializers';
import { boundingBox, haversineKm, roundDistance } from '../services/geolocation';

/**
 * One round trip for the map screen.
 *
 * The map needs open orders and available masters *in the same viewport*, and
 * asking /orders and /masters separately means two cold-start-prone requests,
 * two bounding boxes and two paginations to reconcile on the client. This
 * returns both, already distance-sorted, in the shape the markers need — and
 * nothing else: no descriptions, no portfolios, no review lists. A map with 200
 * pins should not ship 200 biographies.
 *
 * `radius` is in METRES here, not kilometres, because that is what the caller
 * naturally has from a map viewport. Everything internal stays in km.
 */
export const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(200_000).default(5_000),
  type: z.enum(['tasks', 'workers', 'all']).default('all'),
  category: z.string().min(1).max(50).optional(),
  /** Hard cap on each list so a huge radius cannot produce a huge payload. */
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function listNearby(req: Request, res: Response): Promise<void> {
  const q = nearbySchema.parse(req.query);
  const radiusKm = q.radius / 1000;
  const box = boundingBox(q.lat, q.lng, radiusKm);

  const wantTasks = q.type === 'tasks' || q.type === 'all';
  const wantWorkers = q.type === 'workers' || q.type === 'all';

  const [orderRows, masterRows] = await Promise.all([
    wantTasks
      ? prisma.order.findMany({
          where: {
            status: OrderStatus.OPEN,
            lat: { gte: box.minLat, lte: box.maxLat },
            lng: { gte: box.minLng, lte: box.maxLng },
            ...(q.category ? { category: { slug: q.category } } : {}),
          },
          select: {
            publicId: true,
            title: true,
            budgetPi: true,
            isUrgent: true,
            lat: true,
            lng: true,
            createdAt: true,
            category: { select: { slug: true, icon: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: GEO_CANDIDATE_CAP,
        })
      : Promise.resolve([]),

    wantWorkers
      ? prisma.masterProfile.findMany({
          where: {
            isAvailable: true,
            verificationStatus: VerificationStatus.VERIFIED,
            lat: { gte: box.minLat, lte: box.maxLat },
            lng: { gte: box.minLng, lte: box.maxLng },
            ...(q.category ? { categories: { some: { category: { slug: q.category } } } } : {}),
          },
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            lat: true,
            lng: true,
            completedJobs: true,
            boostedUntil: true,
            user: { select: { username: true, ratingAvg: true, ratingCount: true, lastSeenAt: true } },
            categories: { select: { category: { select: { slug: true } } } },
          },
          orderBy: { completedJobs: 'desc' },
          take: GEO_CANDIDATE_CAP,
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();

  const tasks = orderRows
    // lat/lng are non-null on Order, so no guard is needed here.
    .map((order) => ({
      distanceKm: roundDistance(haversineKm(q.lat, q.lng, order.lat, order.lng)),
      order,
    }))
    .filter((entry) => entry.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, q.limit)
    .map(({ order, distanceKm }) => ({
      kind: 'task' as const,
      id: order.publicId,
      title: order.title,
      lat: order.lat,
      lng: order.lng,
      distanceKm,
      budgetPi: order.budgetPi.toString(),
      isUrgent: order.isUrgent,
      category: order.category?.slug ?? null,
      categoryIcon: order.category?.icon ?? null,
      createdAt: order.createdAt.toISOString(),
    }));

  const workers = masterRows
    // lat/lng are nullable on MasterProfile — a master who never set a home
    // point is already excluded by the bounding box, but the types do not know
    // that, so the coordinates are narrowed once here and carried along rather
    // than re-asserted at every use.
    .flatMap((profile) => {
      if (profile.lat === null || profile.lng === null) return [];
      const lat = profile.lat;
      const lng = profile.lng;
      return [{ profile, lat, lng, distanceKm: roundDistance(haversineKm(q.lat, q.lng, lat, lng)) }];
    })
    .filter((entry) => entry.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, q.limit)
    .map(({ profile, lat, lng, distanceKm }) => ({
      kind: 'worker' as const,
      id: profile.id,
      username: profile.user?.username ?? null,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      lat,
      lng,
      distanceKm,
      ratingAvg: profile.user ? Number(profile.user.ratingAvg) : 0,
      ratingCount: profile.user?.ratingCount ?? 0,
      completedJobs: profile.completedJobs,
      isOnline: isRecentlySeen(profile.user?.lastSeenAt),
      isBoosted: Boolean(profile.boostedUntil && profile.boostedUntil > now),
      categories: profile.categories.map((link) => link.category.slug),
    }));

  res.json({
    center: { lat: q.lat, lng: q.lng },
    radiusMeters: q.radius,
    onlineWindowMs: ONLINE_WINDOW_MS,
    tasks,
    workers,
    // Same contract as the list endpoints: past the candidate cap the counts
    // are a floor, and the client must say so rather than imply completeness.
    truncated: orderRows.length >= GEO_CANDIDATE_CAP || masterRows.length >= GEO_CANDIDATE_CAP,
  });
}
