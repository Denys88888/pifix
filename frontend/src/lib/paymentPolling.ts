import { paymentsApi } from '../api/endpoints';
import { ApiError } from '../api/client';

export type PaymentPollStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';

export interface PollResult {
  status: PaymentPollStatus;
  responseId: string | null;
  order: { id: string; publicId: string; status: string } | null;
  errorText: string | null;
}

/**
 * Polls the backend for the final state of a payment.
 *
 * Pi Browser gives no WebSocket and no push, and the SDK callbacks can be lost
 * when the WebView is backgrounded mid-payment — so the UI treats the backend
 * as the source of truth and polls it every 3 seconds.
 */
export async function pollPaymentStatus(
  paymentId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onTick?: (status: PaymentPollStatus, elapsedMs: number) => void;
  } = {},
): Promise<PollResult> {
  const interval = options.intervalMs ?? 3_000;
  const timeout = options.timeoutMs ?? 180_000;
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }

    try {
      const payment = await paymentsApi.status(paymentId);
      const status = payment.status as PaymentPollStatus;
      options.onTick?.(status, Date.now() - startedAt);

      if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'ERROR') {
        return {
          status,
          responseId: payment.responseId,
          order: payment.order,
          errorText: payment.errorText,
        };
      }
    } catch (error) {
      // A 404 right after createPayment just means the approval call has not
      // reached the server yet; anything else that is not a network blip fails.
      const isTransient =
        error instanceof ApiError && (error.status === 404 || error.status === 0 || error.status >= 500);
      if (!isTransient) throw error;
    }

    if (Date.now() - startedAt > timeout) {
      return { status: 'PENDING', responseId: null, order: null, errorText: 'timeout' };
    }

    await sleep(interval, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Polling aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
