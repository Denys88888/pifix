import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * The `type` values body-parser sets when it refuses a request body, mapped to
 * the stable codes the frontend translates. Matching the exact strings rather
 * than "anything with a status" keeps an application error that happens to
 * carry a `type` field from being downgraded to a client fault.
 */
const BODY_REJECTION_CODES: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': { status: 400, code: 'malformed_body', message: 'Request body is not valid JSON' },
  'entity.verify.failed': { status: 400, code: 'malformed_body', message: 'Request body is not valid JSON' },
  'request.size.invalid': { status: 400, code: 'malformed_body', message: 'Request body size is invalid' },
  'request.aborted': { status: 400, code: 'request_aborted', message: 'Request was aborted before it finished' },
  'entity.too.large': { status: 413, code: 'payload_too_large', message: 'Request body is larger than 1 MB' },
  'parameters.too.many': { status: 413, code: 'payload_too_large', message: 'Too many parameters in request body' },
  'charset.unsupported': { status: 415, code: 'unsupported_encoding', message: 'Unsupported charset' },
  'encoding.unsupported': { status: 415, code: 'unsupported_encoding', message: 'Unsupported content encoding' },
};

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'route_not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error(error.message, { code: error.code, path: req.path, stack: error.stack });
    } else {
      logger.warn(error.message, { code: error.code, path: req.path });
    }
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request data',
        details: { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const code = error.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error';
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? 'Maximum file size is 5 MB' : `Upload error: ${error.message}`;
    res.status(400).json({ error: { code, message } });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'duplicate', message: 'This record already exists' },
      });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: { code: 'not_found', message: 'Resource not found' } });
      return;
    }
    logger.error('Prisma error', { code: error.code, path: req.path, meta: error.meta });
    res.status(400).json({ error: { code: 'database_error', message: 'Database request failed' } });
    return;
  }

  // express.json()/urlencoded() reject a body by throwing an http-errors object
  // carrying a 4xx `status` and a `type`. These are client faults, but without
  // this branch they reach the catch-all below and are answered 500 — a
  // truncated POST over a bad mobile connection would look like an outage and
  // page whoever is on call.
  const rejected = error as { type?: string; status?: number };
  if (typeof rejected.type === 'string' && BODY_REJECTION_CODES[rejected.type]) {
    const { status, code, message } = BODY_REJECTION_CODES[rejected.type];
    logger.warn('Request body rejected', { type: rejected.type, code, path: req.path });
    res.status(status).json({ error: { code, message } });
    return;
  }

  const err = error as Error;
  logger.error('Unhandled error', { message: err?.message, path: req.path, stack: err?.stack });
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: env.isProduction ? 'Internal server error' : (err?.message ?? 'Internal server error'),
    },
  });
}
