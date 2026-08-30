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

  /**
   * The one switch that decides which Pi network this instance talks to.
   * Everything below is derived from it, because sandbox, the Horizon URL and
   * the network passphrase used to be three independent settings — and three
   * settings can disagree. Flipping only the first one would take real money
   * on Mainnet while still signing against the Testnet ledger.
   *
   * Left unset it falls back to PI_SANDBOX, so existing deployments keep
   * working unchanged.
   */
  PI_NETWORK: z.enum(['testnet', 'mainnet']).optional(),
  PI_SANDBOX: boolean(true),
  REQUIRE_KYC: boolean(false),

  PI_WALLET_PRIVATE_SEED: z.string().optional().default(''),
  // Overrides. Optional: the network preset supplies them.
  PI_HORIZON_URL: z.string().url().optional(),
  PI_NETWORK_PASSPHRASE: z.string().optional(),
  PAYOUTS_ENABLED: boolean(true),

  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_FOLDER: z.string().default('pifix'),

  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD_HASH: z.string().optional().default(''),
  ADMIN_PASSWORD: z.string().optional().default(''),
  /**
   * Comma-separated Pi uids that get the admin panel with no password, same
   * shape as taxi-pro's ADMIN_UIDS. The uid rather than the username because
   * it never changes hands: a username can in principle be renamed and later
   * claimed by somebody else, and that would hand them the panel.
   *
   * Only as strong as the phone the Pi Browser is signed in on, so the
   * password login stays as the way in from a desktop.
   */
  ADMIN_UIDS: z.string().optional().default(''),

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

/**
 * Testnet ships with working defaults. Mainnet deliberately has none: the
 * Horizon URL and the network passphrase must be supplied explicitly, and the
 * boot fails if they are missing or still point at Testnet. Guessing them here
 * would mean a silent switch to real money signed against the wrong ledger,
 * which is the one mistake in this file that cannot be undone afterwards.
 */
const NETWORK_PRESETS = {
  testnet: {
    sandbox: true,
    horizon: 'https://api.testnet.minepi.com',
    passphrase: 'Pi Testnet',
  },
  mainnet: {
    sandbox: false,
    horizon: null,
    passphrase: null,
  },
} as const;

const piNetwork = raw.PI_NETWORK ?? (raw.PI_SANDBOX ? 'testnet' : 'mainnet');
const preset = NETWORK_PRESETS[piNetwork];

// Only when PI_SANDBOX was written down by hand. Comparing against its default
// would make PI_NETWORK=mainnet impossible to use on its own, which is the
// exact opposite of it being the single switch.
const sandboxSetExplicitly = (process.env.PI_SANDBOX ?? '').trim() !== '';

// Both set and disagreeing means one of them is a leftover. Refusing is safer
// than picking a winner and being wrong about which one was intended.
if (raw.PI_NETWORK && sandboxSetExplicitly && raw.PI_SANDBOX !== preset.sandbox) {
  // eslint-disable-next-line no-console
  console.error(
    `PI_NETWORK=${piNetwork} contradicts PI_SANDBOX=${raw.PI_SANDBOX}. ` +
      'Remove PI_SANDBOX and keep PI_NETWORK as the only switch.',
  );
  process.exit(1);
}

const piHorizonUrl = raw.PI_HORIZON_URL ?? preset.horizon;
const piNetworkPassphrase = raw.PI_NETWORK_PASSPHRASE ?? preset.passphrase;

if (!piHorizonUrl || !piNetworkPassphrase) {
  // eslint-disable-next-line no-console
  console.error(
    `PI_NETWORK=${piNetwork} requires PI_HORIZON_URL and PI_NETWORK_PASSPHRASE to be set explicitly.`,
  );
  process.exit(1);
}

if (piNetwork === 'mainnet' && /testnet/i.test(`${piHorizonUrl} ${piNetworkPassphrase}`)) {
  // eslint-disable-next-line no-console
  console.error(
    'PI_NETWORK=mainnet but the Horizon URL or the passphrase still says testnet. ' +
      'Refusing to start: this would move real Pi against the wrong ledger.',
  );
  process.exit(1);
}

/*
 * Pi's own documentation, payments_advanced.md, states plainly:
 *
 *   "Please note that the A2U payments feature is currently available only on
 *    the Testnet."
 *
 * So a Mainnet instance with payouts switched on is configured for something
 * the platform does not offer: masters would earn a balance and every payout
 * would fail. Warned rather than refused, because Pi may enable it and a hard
 * stop would then block a setup that had started working.
 */
if (piNetwork === 'mainnet' && raw.PAYOUTS_ENABLED) {
  // eslint-disable-next-line no-console
  console.warn(
    'WARNING: PAYOUTS_ENABLED on Mainnet. Pi documents App-to-User payments as ' +
      'Testnet-only, so payouts to masters are expected to fail until Pi ships them ' +
      'on Mainnet. Balances will still accrue; only the transfer out is affected.',
  );
}

export const env = {
  ...raw,
  piNetwork,
  PI_SANDBOX: preset.sandbox,
  PI_HORIZON_URL: piHorizonUrl,
  PI_NETWORK_PASSPHRASE: piNetworkPassphrase,
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
