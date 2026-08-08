import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { referenceApi } from '../api/endpoints';
import type { Category, PlatformSettings } from '../api/types';

export interface SettingsContextValue {
  settings: PlatformSettings | null;
  categories: Category[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

const BOOT_ATTEMPTS = 3;
/** Waits before attempts 2 and 3. Short, because the boot timeout is already long. */
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Prices and limits live in the database and can change at any moment from the
 * admin panel, so they are fetched at boot and re-fetched whenever the app
 * comes back to the foreground — a stale price would make a payment fail
 * server-side with `amount_mismatch`.
 */
export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    let lastError: unknown = null;

    // A cold free-tier instance can miss even the extended boot timeout, and
    // there is no other trigger until the tab is backgrounded and refocused —
    // so a single miss used to leave the app sitting there with no categories
    // and no prices. Retry a couple of times before giving up.
    for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
      }

      // allSettled, not all: these are independent endpoints, and letting a
      // failing one discard a successful one is how a slow /settings used to
      // blank out the category grid too.
      const [settingsResult, categoriesResult] = await Promise.allSettled([
        referenceApi.settings(),
        referenceApi.categories(),
      ]);

      if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
      else lastError = settingsResult.reason;

      if (categoriesResult.status === 'fulfilled') setCategories(categoriesResult.value);
      else lastError = categoriesResult.reason;

      if (settingsResult.status === 'fulfilled' && categoriesResult.status === 'fulfilled') {
        setError(null);
        setLoading(false);
        return;
      }
    }

    setError(lastError instanceof Error ? lastError.message : 'Could not load platform settings');
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, categories, loading, error, reload }),
    [settings, categories, loading, error, reload],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
