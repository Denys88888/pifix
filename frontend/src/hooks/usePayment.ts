import { useCallback, useRef, useState } from 'react';
import { paymentsApi } from '../api/endpoints';
import { createPayment, isPiBrowser } from '../lib/piSdk';
import { pollPaymentStatus, type PollResult } from '../lib/paymentPolling';
import { ApiError } from '../api/client';

export type PaymentStage =
  | 'idle'
  | 'creating'
  | 'approving'
  | 'completing'
  | 'confirming'
  | 'done'
  | 'cancelled'
  | 'error';

export interface PaymentIntentMetadata {
  purpose: 'CONNECT' | 'ESCROW' | 'BOOST' | 'SUBSCRIPTION';
  [key: string]: unknown;
}

/**
 * The whole user→app payment dance in one hook:
 *   Pi.createPayment → backend /payments/approve → chain → backend
 *   /payments/complete → poll /payments/:id/status until the server says done.
 *
 * The poll is what makes it survive a backgrounded WebView: even if the SDK
 * callbacks never fire again, the backend still finishes the job and the UI
 * picks the result up.
 */
export function usePayment() {
  const [stage, setStage] = useState<PaymentStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage('idle');
    setError(null);
    setErrorCode(null);
  }, []);

  const pay = useCallback(
    async (input: {
      amountPi: string;
      memo: string;
      metadata: PaymentIntentMetadata;
    }): Promise<PollResult | null> => {
      if (!isPiBrowser()) {
        setStage('error');
        setErrorCode('no_pi_browser');
        setError('Open PiFix in Pi Browser to pay');
        return null;
      }

      setError(null);
      setErrorCode(null);
      setStage('creating');

      const controller = new AbortController();
      abortRef.current = controller;

      let paymentId = '';

      try {
        const result = await createPayment(
          {
            // Pi's SDK takes a number here; the server re-derives the exact
            // Decimal amount and rejects anything that does not match.
            amount: Number(input.amountPi),
            memo: input.memo.slice(0, 200),
            metadata: input.metadata,
          },
          {
            onServerApproval: async (id) => {
              paymentId = id;
              setStage('approving');
              await paymentsApi.approve(id);
            },
            onServerCompletion: async (id, txid) => {
              paymentId = id;
              setStage('completing');
              await paymentsApi.complete(id, txid);
            },
          },
        );

        paymentId = result.paymentId;
        setStage('confirming');

        const final = await pollPaymentStatus(paymentId, {
          signal: controller.signal,
          timeoutMs: 120_000,
        });

        if (final.status === 'COMPLETED') {
          setStage('done');
          return final;
        }
        if (final.status === 'CANCELLED') {
          setStage('cancelled');
          setErrorCode('payment_cancelled');
          return final;
        }
        setStage('error');
        setErrorCode(final.errorText ?? 'payment_failed');
        setError(final.errorText ?? 'The payment could not be completed');
        return final;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          setStage('idle');
          return null;
        }
        if (caught instanceof Error && caught.name === 'PaymentCancelled') {
          setStage('cancelled');
          setErrorCode('payment_cancelled');
          return null;
        }

        // The SDK callback may have failed while the backend still finished the
        // work — ask the backend before declaring failure.
        if (paymentId) {
          try {
            const recovered = await pollPaymentStatus(paymentId, { timeoutMs: 15_000 });
            if (recovered.status === 'COMPLETED') {
              setStage('done');
              return recovered;
            }
          } catch {
            /* fall through to the error below */
          }
        }

        setStage('error');
        if (caught instanceof ApiError) {
          setErrorCode(caught.code);
          setError(caught.message);
        } else {
          setErrorCode('payment_failed');
          setError(caught instanceof Error ? caught.message : 'Payment failed');
        }
        return null;
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  return { pay, reset, stage, error, errorCode, busy: stage !== 'idle' && stage !== 'done' && stage !== 'error' && stage !== 'cancelled' };
}
