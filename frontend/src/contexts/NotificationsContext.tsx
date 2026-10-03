import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { notificationsApi } from '../api/endpoints';
import type { NotificationSummary } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePolling';

interface NotificationsValue {
  unread: number;
  byOrder: Record<string, number>;
  /** Shown for a few seconds when something new arrives while the app is open. */
  toast: string | null;
  dismissToast: () => void;
  refresh: () => Promise<void>;
  markOrderRead: (orderId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const EMPTY: NotificationSummary = { unread: 0, byOrder: {} };

export const NotificationsContext = createContext<NotificationsValue>({
  unread: 0,
  byOrder: {},
  toast: null,
  dismissToast: () => undefined,
  refresh: async () => undefined,
  markOrderRead: async () => undefined,
  markAllRead: async () => undefined,
});

/**
 * Pi Browser has no push, so "notifications" means: poll a tiny summary every
 * 20 seconds while the app is open and signed in, and turn it into a counter on
 * the bell, "new" badges on orders and a short banner when the count goes up.
 * usePolling stops while the app is in the background, so a phone in a pocket
 * sends nothing.
 */
export function NotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();
  const signedIn = status === 'signed_in';
  const [summary, setSummary] = useState<NotificationSummary>(EMPTY);
  const [toast, setToast] = useState<string | null>(null);
  const previous = useRef<number | null>(null);

  const apply = useCallback((next: NotificationSummary) => {
    // The first summary after sign-in sets the baseline; only growth after
    // that means something arrived while the pioneer was looking.
    if (previous.current !== null && next.unread > previous.current) setToast('new');
    previous.current = next.unread;
    setSummary(next);
  }, []);

  usePolling(() => notificationsApi.summary(), {
    intervalMs: 20_000,
    enabled: signedIn,
    onData: apply,
  });

  useEffect(() => {
    if (!signedIn) {
      previous.current = null;
      setSummary(EMPTY);
    }
  }, [signedIn]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const next = await notificationsApi.summary().catch(() => null);
    if (next) apply(next);
  }, [apply, signedIn]);

  const markOrderRead = useCallback(
    async (orderId: string) => {
      if (!signedIn || !summary.byOrder[orderId]) return;
      await notificationsApi.read(orderId).catch(() => undefined);
      const next = await notificationsApi.summary().catch(() => null);
      // Reading is not "something new": move the baseline down with it.
      if (next) {
        previous.current = next.unread;
        setSummary(next);
      }
    },
    [signedIn, summary.byOrder],
  );

  const markAllRead = useCallback(async () => {
    if (!signedIn) return;
    await notificationsApi.read().catch(() => undefined);
    previous.current = 0;
    setSummary(EMPTY);
  }, [signedIn]);

  const value = useMemo<NotificationsValue>(
    () => ({
      unread: summary.unread,
      byOrder: summary.byOrder,
      toast,
      dismissToast: () => setToast(null),
      refresh,
      markOrderRead,
      markAllRead,
    }),
    [summary, toast, refresh, markOrderRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
