import type { User } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth / optionalAuth. */
      user?: User;
      /** Set by requireAdmin. */
      admin?: { username: string };
      /** Raw Pi access token, kept for KYC re-checks within the same request. */
      piAccessToken?: string;
    }
  }
}

export {};
