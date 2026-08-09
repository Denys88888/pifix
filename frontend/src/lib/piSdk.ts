/**
 * Pi SDK v2 wrapper.
 *
 * Everything the app does with Pi goes through here so the rest of the code
 * never touches `window.Pi` directly and always gets typed, promise-based APIs.
 */

// Exactly the three scopes the Pi SDK reference documents. 'roles' used to be
// listed here and is not in the docs — leaving it in the type advertised a
// scope that may simply be rejected at the consent screen.
export type PiScope = 'username' | 'payments' | 'wallet_address';

export interface PiAuthResult {
  accessToken: string;
  user: { uid: string; username: string };
}

export interface PiPaymentData {
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
}

export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: unknown) => void;
}

export interface IncompletePayment {
  identifier: string;
  transaction?: { txid: string } | null;
  [key: string]: unknown;
}

interface PiSdk {
  init(config: { version: string; sandbox?: boolean }): void;
  authenticate(
    scopes: PiScope[],
    onIncompletePaymentFound: (payment: IncompletePayment) => void,
  ): Promise<PiAuthResult>;
  createPayment(data: PiPaymentData, callbacks: PiPaymentCallbacks): void;
  openShareDialog(title: string, message: string): void;
  nativeFeaturesList?: () => Promise<string[]>;
}

declare global {
  interface Window {
    Pi?: PiSdk;
  }
}

let initialised = false;
let incompleteHandler: ((payment: IncompletePayment) => void) | null = null;

/**
 * How long to wait for the Pi native bridge to answer authenticate() before
 * concluding there is no bridge. Sized for a human reading a consent screen,
 * not for a network round-trip.
 */
const AUTH_BRIDGE_TIMEOUT_MS = 60_000;

export function isPiBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.Pi !== 'undefined';
}

/**
 * Called once on app mount. Safe to call repeatedly.
 * `onIncompletePaymentFound` is registered here and reused by authenticate(),
 * because the SDK only surfaces dangling payments through that callback.
 */
export function initPi(options: {
  sandbox: boolean;
  onIncompletePaymentFound: (payment: IncompletePayment) => void;
}): boolean {
  incompleteHandler = options.onIncompletePaymentFound;

  if (!isPiBrowser()) return false;
  if (initialised) return true;

  window.Pi!.init({ version: '2.0', sandbox: options.sandbox });
  initialised = true;
  return true;
}

export class PiUnavailableError extends Error {
  constructor() {
    super('Pi SDK is not available — open this app in Pi Browser');
    this.name = 'PiUnavailableError';
  }
}

/**
 * The bridge did not answer in time. Deliberately distinct from
 * PiUnavailableError: a timeout does NOT prove the pioneer is outside Pi
 * Browser. Observed on the emulator inside the genuine Pi Browser, on an
 * account with no Pi session — authenticate() hung there exactly as it does in
 * desktop Chrome. Treating the two as the same thing tells a pioneer who is
 * already in Pi Browser to go and open Pi Browser.
 */
export class PiBridgeTimeoutError extends Error {
  constructor() {
    super('Pi did not respond in time');
    this.name = 'PiBridgeTimeoutError';
  }
}

/**
 * `payments` is required: it is the scope that lets the app create payments and
 * that exposes the wallet address used for payouts.
 */
export async function authenticate(
  scopes: PiScope[] = ['username', 'payments', 'wallet_address'],
): Promise<PiAuthResult> {
  if (!isPiBrowser()) throw new PiUnavailableError();

  // isPiBrowser() only proves the SDK script loaded, and index.html loads it
  // from sdk.minepi.com in every browser — so outside Pi Browser we get here
  // with a window.Pi that has no native bridge behind it, and authenticate()
  // then never settles: it does not resolve, it does not reject, and the sign-in
  // button sits on its spinner forever with nothing logged. Verified in desktop
  // Chrome against the deployed app.
  //
  // The timeout is the only thing that turns that dead end into a message. What
  // it must NOT do is claim to know why: the same hang happens inside the real
  // Pi Browser when the pioneer has no Pi session, so it reports "Pi did not
  // respond" rather than "you are not in Pi Browser".
  return Promise.race([
    window.Pi!.authenticate(scopes, (payment) => {
      incompleteHandler?.(payment);
    }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new PiBridgeTimeoutError()), AUTH_BRIDGE_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Wraps createPayment in a promise that settles when the server has completed
 * (or the user cancelled). The `onServerApproval`/`onServerCompletion` hooks are
 * where the app calls its own backend.
 */
export function createPayment(
  data: PiPaymentData,
  hooks: {
    onServerApproval: (paymentId: string) => Promise<void>;
    onServerCompletion: (paymentId: string, txid: string) => Promise<void>;
    onProgress?: (stage: 'created' | 'approving' | 'signing' | 'completing') => void;
  },
): Promise<{ paymentId: string; txid: string }> {
  if (!isPiBrowser()) return Promise.reject(new PiUnavailableError());

  return new Promise((resolve, reject) => {
    let currentPaymentId = '';

    hooks.onProgress?.('created');

    window.Pi!.createPayment(data, {
      onReadyForServerApproval: (paymentId) => {
        currentPaymentId = paymentId;
        hooks.onProgress?.('approving');
        hooks
          .onServerApproval(paymentId)
          .catch((error: Error) => reject(error));
      },
      onReadyForServerCompletion: (paymentId, txid) => {
        currentPaymentId = paymentId;
        hooks.onProgress?.('completing');
        hooks
          .onServerCompletion(paymentId, txid)
          .then(() => resolve({ paymentId, txid }))
          .catch((error: Error) => reject(error));
      },
      onCancel: (paymentId) => {
        const error = new Error('payment_cancelled');
        error.name = 'PaymentCancelled';
        reject(Object.assign(error, { paymentId: paymentId || currentPaymentId }));
      },
      onError: (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    });
  });
}

/** Native share sheet — used for referral links. Falls back to the Web Share API. */
export async function share(title: string, message: string): Promise<boolean> {
  if (isPiBrowser() && typeof window.Pi!.openShareDialog === 'function') {
    window.Pi!.openShareDialog(title, message);
    return true;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text: message });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    return false;
  }
}
