import type { PlatformSettings } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * platform_settings is a single row (id = 1) read on every request.
 * A 5-second in-process cache keeps the hot path off the database while still
 * making an admin change visible "instantly" from the operator's point of view.
 * Call `invalidateSettings()` right after any write so the admin sees it at once.
 */
const CACHE_TTL_MS = 5_000;

let cached: { value: PlatformSettings; expiresAt: number } | null = null;

const DEFAULTS = {
  id: 1,
  connectPricePi: '0.5',
  clientFeePercent: '10.00',
  masterFeePercent: '0.00',
  proSubscriptionPricePi: '10.0',
  expressFeePi: '3.0',
  profileBoostPricePi: '5.0',
  escrowTimeoutDays: 7,
  referralBonusDirectPi: '1.0',
  referralBonusIndirectPi: '0.5',
  minBudgetPi: '1.0',
  maxOpenOrdersPerClient: 5,
  maxActiveResponsesPerMaster: 10,
  connectRefundWindowMinutes: 60,
  minWithdrawalPi: '5.0',
  autoWithdrawalPi: '0',
  piUsdRate: '0',
  maintenanceMode: false,
} as const;

export async function getSettings(): Promise<PlatformSettings> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  let row = await prisma.platformSettings.findUnique({ where: { id: 1 } });
  if (!row) {
    logger.warn('platform_settings row missing — creating it with defaults');
    row = await prisma.platformSettings.create({ data: DEFAULTS });
  }

  cached = { value: row, expiresAt: now + CACHE_TTL_MS };
  return row;
}

export function invalidateSettings(): void {
  cached = null;
}

export async function updateSettings(data: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const { id: _ignored, updatedAt: _ignoredAt, ...patch } = data;
  const row = await prisma.platformSettings.upsert({
    where: { id: 1 },
    update: patch,
    create: { ...DEFAULTS, ...patch },
  });
  invalidateSettings();
  return row;
}

/** The subset the frontend is allowed to read without admin auth. */
export function publicSettings(settings: PlatformSettings) {
  return {
    connectPricePi: settings.connectPricePi.toString(),
    clientFeePercent: settings.clientFeePercent.toString(),
    expressFeePi: settings.expressFeePi.toString(),
    profileBoostPricePi: settings.profileBoostPricePi.toString(),
    proSubscriptionPricePi: settings.proSubscriptionPricePi.toString(),
    escrowTimeoutDays: settings.escrowTimeoutDays,
    referralBonusDirectPi: settings.referralBonusDirectPi.toString(),
    referralBonusIndirectPi: settings.referralBonusIndirectPi.toString(),
    minBudgetPi: settings.minBudgetPi.toString(),
    maxOpenOrdersPerClient: settings.maxOpenOrdersPerClient,
    maxActiveResponsesPerMaster: settings.maxActiveResponsesPerMaster,
    connectRefundWindowMinutes: settings.connectRefundWindowMinutes,
    minWithdrawalPi: settings.minWithdrawalPi.toString(),
    maintenanceMode: settings.maintenanceMode,
    // Server capabilities, not operator settings. Without them the client shows
    // a photo picker and a withdraw button that can only ever fail — the
    // feature reads as broken rather than as not yet switched on.
    uploadsEnabled: env.cloudinaryConfigured,
    payoutsEnabled: env.payoutsConfigured,
  };
}

export type PublicSettings = ReturnType<typeof publicSettings>;
