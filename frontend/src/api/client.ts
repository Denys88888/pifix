import axios, { AxiosError, type AxiosInstance } from 'axios';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/**
 * Pi Browser wipes localStorage on update, so the session token is kept in
 * memory first and mirrored to sessionStorage as a best-effort convenience.
 * Losing it only costs one extra Pi.authenticate round-trip.
 */
let authToken: string | null = null;
const TOKEN_KEY = 'pifix_token';

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode / storage disabled — the in-memory copy still works.
  }
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  try {
    authToken = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    authToken = null;
  }
  return authToken;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (!error.response) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return Promise.reject(
        new ApiError(0, offline ? 'offline' : 'network_error', offline ? 'No internet connection' : 'Network error'),
      );
    }

    const { status, data } = error.response;
    const code = data?.error?.code ?? 'unknown_error';
    const message = data?.error?.message ?? error.message;

    if (status === 401 && code !== 'admin_credentials_invalid') {
      setAuthToken(null);
      onUnauthorized?.();
    }

    return Promise.reject(new ApiError(status, code, message, data?.error?.details));
  },
);

/** Admin panel keeps its own short-lived token, separate from the user session. */
const ADMIN_TOKEN_KEY = 'pifix_admin_token';
let adminToken: string | null = null;

export function setAdminToken(token: string | null): void {
  adminToken = token;
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getAdminToken(): string | null {
  if (adminToken) return adminToken;
  try {
    adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    adminToken = null;
  }
  return adminToken;
}

export const adminApi: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (!error.response) {
      return Promise.reject(new ApiError(0, 'network_error', 'Network error'));
    }
    const { status, data } = error.response;
    return Promise.reject(
      new ApiError(status, data?.error?.code ?? 'unknown_error', data?.error?.message ?? error.message, data?.error?.details),
    );
  },
);
