import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { env } from '../config/env';

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

  const err = error as Error;
  logger.error('Unhandled error', { message: err?.message, path: req.path, stack: err?.stack });
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: env.isProduction ? 'Internal server error' : (err?.message ?? 'Internal server error'),
    },
  });
}
