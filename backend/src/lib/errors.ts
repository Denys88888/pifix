/**
 * Application errors carry an HTTP status and a stable machine-readable code.
 * The frontend maps `code` to a translated message; `message` is the English
 * fallback shown when no translation exists.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (code = 'unauthorized', message = 'Authentication required') =>
  new AppError(401, code, message);

export const forbidden = (code = 'forbidden', message = 'Action not allowed') =>
  new AppError(403, code, message);

export const notFound = (code = 'not_found', message = 'Resource not found') =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const tooManyRequests = (code = 'rate_limited', message = 'Too many requests') =>
  new AppError(429, code, message);

export const serverError = (code = 'internal_error', message = 'Internal server error', details?: unknown) =>
  new AppError(500, code, message, details);
