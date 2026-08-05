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
    try {
      const [nextSettings, nextCategories] = await Promise.all([
        referenceApi.settings(),
        referenceApi.categories(),
      ]);
      setSettings(nextSettings);
      setCategories(nextCategories);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load platform settings');
    } finally {
      setLoading(false);
    }
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
