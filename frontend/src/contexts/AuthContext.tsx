import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import i18n from 'i18next';
import { ApiError, getAuthToken, setAuthToken, setUnauthorizedHandler } from '../api/client';
import { authApi, paymentsApi } from '../api/endpoints';
import type { SelfUser } from '../api/types';
import {
  authenticate,
  initPi,
  isPiBrowser,
  PiBridgeTimeoutError,
  PiUnavailableError,
  type IncompletePayment,
} from '../lib/piSdk';

export type AuthStatus = 'booting' | 'no_pi' | 'signed_out' | 'signing_in' | 'signed_in' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: SelfUser | null;
  error: string | null;
  piAvailable: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: SelfUser) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const REFERRER_KEY = 'pifix_ref';

/** Captures ?ref=username on first load, before React Router rewrites the URL. */
function captureReferrer(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ref');
    if (fromUrl) {
      sessionStorage.setItem(REFERRER_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(REFERRER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUserState] = useState<SelfUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const piAvailable = useRef(false);
  const signingIn = useRef(false);

  /**
   * Dangling payments must be cleared before a new one can be created, so this
   * handler is wired into Pi.init and reused by every authenticate() call.
   */
  const handleIncompletePayment = useCallback((payment: IncompletePayment) => {
    void paymentsApi.cancelIncomplete(payment).catch(() => {
      // The user may not have a session yet on the very first load; the same
      // payment is surfaced again on the next authenticate().
    });
  }, []);

  const signIn = useCallback(async () => {
    if (signingIn.current) return;
    signingIn.current = true;
    setError(null);
    setStatus('signing_in');

    try {
      const auth = await authenticate(['username', 'payments', 'wallet_address']);
      const result = await authApi.login({
        accessToken: auth.accessToken,
        referrer: captureReferrer(),
        language: i18n.resolvedLanguage ?? 'en',
      });
      setAuthToken(result.token);
      setUserState(result.user);
      setStatus('signed_in');
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Authentication failed';
      // A bridge timeout is NOT proof the pioneer is outside Pi Browser — the
      // same hang happens inside it when they have no Pi session. So it keeps
      // them on the app with an honest message and a working retry, instead of
      // replacing the whole UI with "open in Pi Browser", which is what an
      // earlier version did and which was wrong for exactly that case.
      if (caught instanceof PiBridgeTimeoutError) {
        setError(i18n.t('auth.piNoResponse'));
        setStatus('signed_out');
      } else {
        setError(message);
        setStatus(caught instanceof PiUnavailableError || !isPiBrowser() ? 'no_pi' : 'signed_out');
      }
    } finally {
      signingIn.current = false;
    }
  }, []);

  const signOut = useCallback(() => {
    setAuthToken(null);
    setUserState(null);
    setStatus(piAvailable.current ? 'signed_out' : 'no_pi');
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const fresh = await authApi.me();
      setUserState(fresh);
      setStatus('signed_in');
    } catch {
      signOut();
    }
  }, [signOut]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState(null);
      setStatus('signed_out');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    captureReferrer();

    const sandbox = String(import.meta.env.VITE_PI_SANDBOX ?? 'true') !== 'false';
    const ready = initPi({ sandbox, onIncompletePaymentFound: handleIncompletePayment });
    piAvailable.current = ready;

    if (!ready) {
      // Pi SDK is not there — desktop Chrome, a normal mobile browser, or a
      // blocked script. The app renders the "open in Pi Browser" screen.
      setStatus('no_pi');
      return;
    }

    const existing = getAuthToken();
    if (existing) {
      void refreshUser().then(() => {
        setStatus((current) => (current === 'booting' ? 'signed_out' : current));
      });
    } else {
      setStatus('signed_out');
    }
    // handleIncompletePayment and refreshUser are stable useCallbacks.
  }, [handleIncompletePayment, refreshUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      piAvailable: piAvailable.current,
      signIn,
      signOut,
      refreshUser,
      setUser: setUserState,
    }),
    [status, user, error, signIn, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
