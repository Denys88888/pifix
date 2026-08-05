import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const boolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  PI_API_KEY: z.string().min(1, 'PI_API_KEY is required'),
  PI_API_BASE_URL: z.string().url().default('https://api.minepi.com'),
  PI_SANDBOX: boolean(true),
  REQUIRE_KYC: boolean(false),

  PI_WALLET_PRIVATE_SEED: z.string().optional().default(''),
  PI_HORIZON_URL: z.string().url().default('https://api.testnet.minepi.com'),
  PI_NETWORK_PASSPHRASE: z.string().default('Pi Testnet'),
  PAYOUTS_ENABLED: boolean(true),

  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_FOLDER: z.string().default('pifix'),

  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD_HASH: z.string().optional().default(''),
  ADMIN_PASSWORD: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  ADMIN_JWT_EXPIRES_IN: z.string().default('12h'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  CRON_SECRET: z.string().min(8, 'CRON_SECRET must be at least 8 characters'),
  ENABLE_INTERNAL_CRON: boolean(true),
  LAZY_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${details.join('\n')}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  cloudinaryConfigured: Boolean(
    raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET,
  ),
  payoutsConfigured: Boolean(raw.PAYOUTS_ENABLED && raw.PI_WALLET_PRIVATE_SEED),
};

export type Env = typeof env;
