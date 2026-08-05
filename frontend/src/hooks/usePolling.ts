import { useEffect, useRef, useState } from 'react';

/**
 * Generic interval poller — the only "realtime" mechanism available, since Pi
 * Browser's WebView blocks WebSockets and has no push. Pauses while the tab is
 * hidden and while the device is offline so a backgrounded app does not burn
 * the user's data plan.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: {
    intervalMs?: number;
    enabled?: boolean;
    immediate?: boolean;
    onData?: (data: T) => void;
    onError?: (error: unknown) => void;
  } = {},
) {
  const { intervalMs = 10_000, enabled = true, immediate = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const fetcherRef = useRef(fetcher);
  const onDataRef = useRef(options.onData);
  const onErrorRef = useRef(options.onError);

  fetcherRef.current = fetcher;
  onDataRef.current = options.onData;
  onErrorRef.current = options.onError;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        timer = setTimeout(run, intervalMs);
        return;
      }

      setLoading(true);
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        onDataRef.current?.(result);
      } catch (caught) {
        if (cancelled) return;
        setError(caught);
        onErrorRef.current?.(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (!cancelled) timer = setTimeout(run, intervalMs);
    };

    if (immediate) void run();
    else timer = setTimeout(run, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs, immediate]);

  return { data, error, loading };
}

/** Tracks navigator.onLine for the offline banner. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
