import { prisma } from './prisma';
import { logger } from './logger';

/** Admin and system actions worth a trail. Never throws: an audit line must not fail the action. */
export async function audit(actor: string, action: string, targetId?: string, details?: unknown): Promise<void> {
  await prisma.adminLog
    .create({ data: { actor, action, targetId: targetId ?? null, details: (details ?? {}) as object } })
    .catch((error) => logger.warn('Audit log failed', { error: (error as Error).message }));
}
