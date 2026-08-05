import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '../lib/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and REPLACES req.body / req.query / req.params with the parsed
 * result, so controllers only ever see data that passed Zod.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Express 5 makes req.query a getter; assign through defineProperty to stay compatible.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new AppError(400, 'validation_error', 'Invalid request data', {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          }),
        );
        return;
      }
      next(error);
    }
  };
}

/** Typed accessors so controllers do not need casts. */
export const body = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> => req.body;
export const query = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> =>
  req.query as z.infer<T>;
export const params = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> =>
  req.params as z.infer<T>;

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
