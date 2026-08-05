import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env } from '../config/env';
import { AppError, badRequest, serverError, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';

/** Shape returned by GET /v2/me. `kyc_status` is only present when the scope is granted. */
export interface PiMe {
  uid: string;
  username: string;
  kyc_status?: string;
  roles?: string[];
  credentials?: {
    scopes?: string[];
    valid_until?: { timestamp: number; iso8601: string };
  };
  wallet_address?: string;
}

export interface PiPaymentDTO {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  from_address: string;
  to_address: string;
  direction: 'user_to_app' | 'app_to_user';
  created_at: string;
  network: string;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: null | {
    txid: string;
    verified: boolean;
    _link: string;
  };
}

const serverClient: AxiosInstance = axios.create({
  baseURL: `${env.PI_API_BASE_URL}/v2`,
  timeout: 20_000,
  headers: {
    Authorization: `Key ${env.PI_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

function wrap(error: unknown, code: string, fallback: string): AppError {
  const axiosError = error as AxiosError<{ error?: string; error_message?: string; message?: string }>;
  const status = axiosError.response?.status;
  const body = axiosError.response?.data;
  const detail = body?.error_message ?? body?.error ?? body?.message ?? axiosError.message;
  logger.error(`Pi API call failed: ${code}`, { status, detail });
  if (status === 401 || status === 403) {
    return unauthorized('pi_api_unauthorized', 'Pi API rejected the server credentials');
  }
  if (status === 404) {
    return badRequest('pi_payment_not_found', 'Payment not found on the Pi Platform');
  }
  return serverError(code, `${fallback}: ${detail}`);
}

/** Verifies a user access token issued by Pi.authenticate on the client. */
export async function verifyAccessToken(accessToken: string): Promise<PiMe> {
  try {
    const { data } = await axios.get<PiMe>(`${env.PI_API_BASE_URL}/v2/me`, {
      timeout: 15_000,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data?.uid || !data?.username) {
      throw unauthorized('pi_auth_invalid', 'Pi did not return a valid identity');
    }
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const status = (error as AxiosError).response?.status;
    if (status === 401 || status === 403) {
      throw unauthorized('pi_auth_invalid', 'Pi access token is invalid or expired');
    }
    throw wrap(error, 'pi_auth_failed', 'Could not verify the Pi access token');
  }
}

export async function getPayment(paymentId: string): Promise<PiPaymentDTO> {
  try {
    const { data } = await serverClient.get<PiPaymentDTO>(`/payments/${paymentId}`);
    return data;
  } catch (error) {
    throw wrap(error, 'pi_payment_fetch_failed', 'Could not read the payment from the Pi Platform');
  }
}

export async function approvePayment(paymentId: string): Promise<PiPaymentDTO> {
  try {
    const { data } = await serverClient.post<PiPaymentDTO>(`/payments/${paymentId}/approve`, {});
    return data;
  } catch (error) {
    throw wrap(error, 'pi_payment_approve_failed', 'Could not approve the payment');
  }
}

export async function completePayment(paymentId: string, txid: string): Promise<PiPaymentDTO> {
  try {
    const { data } = await serverClient.post<PiPaymentDTO>(`/payments/${paymentId}/complete`, { txid });
    return data;
  } catch (error) {
    throw wrap(error, 'pi_payment_complete_failed', 'Could not complete the payment');
  }
}

export async function cancelPayment(paymentId: string): Promise<PiPaymentDTO> {
  try {
    const { data } = await serverClient.post<PiPaymentDTO>(`/payments/${paymentId}/cancel`, {});
    return data;
  } catch (error) {
    throw wrap(error, 'pi_payment_cancel_failed', 'Could not cancel the payment');
  }
}

/** Step 1 of an App→User payment: ask Pi to create it. Returns the identifier to sign. */
export async function createA2UPayment(input: {
  amount: string;
  memo: string;
  metadata: Record<string, unknown>;
  uid: string;
}): Promise<PiPaymentDTO> {
  try {
    const { data } = await serverClient.post<PiPaymentDTO>('/payments', {
      payment: {
        amount: Number(input.amount),
        memo: input.memo.slice(0, 200),
        metadata: input.metadata,
        uid: input.uid,
      },
    });
    return data;
  } catch (error) {
    throw wrap(error, 'pi_a2u_create_failed', 'Could not create the payout on the Pi Platform');
  }
}

/** App→User payments left dangling by a previous crash; must be cleared before a new one. */
export async function getIncompleteServerPayments(): Promise<PiPaymentDTO[]> {
  try {
    const { data } = await serverClient.get<{ incomplete_server_payments: PiPaymentDTO[] }>(
      '/payments/incomplete_server_payments',
    );
    return data.incomplete_server_payments ?? [];
  } catch (error) {
    throw wrap(error, 'pi_incomplete_fetch_failed', 'Could not read incomplete server payments');
  }
}

/**
 * KYC gate. Pi exposes `kyc_status` only when the app was granted that scope in
 * the Developer Portal; when the field is absent we fall back to REQUIRE_KYC so
 * Testnet apps are not locked out by a missing field.
 */
export function isKycVerified(me: PiMe): boolean | null {
  const status = me.kyc_status?.toLowerCase();
  if (!status) return null;
  return ['verified', 'approved', 'passed', 'completed'].includes(status);
}
