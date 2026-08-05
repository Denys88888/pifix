import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../styles/PullToRefresh.module.css';

const THRESHOLD = 68;
const MAX_PULL = 110;

/**
 * Touch-driven pull-to-refresh.
 *
 * Pi Browser's WebView has no native pull-to-refresh inside the page, and the
 * app polls rather than pushes, so this is the gesture people reach for to get
 * a fresh list. Only engages when the page is already scrolled to the top.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const { t } = useTranslation();

  const onTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (disabled || refreshing) return;
      if (window.scrollY > 0) return;
      startY.current = event.touches[0].clientY;
    },
    [disabled, refreshing],
  );

  const onTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (startY.current === null) return;
      const delta = event.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // Rubber-band: the further you pull, the less it moves.
      setPull(Math.min(MAX_PULL, delta * 0.45));
    },
    [],
  );

  const onTouchEnd = useCallback(async () => {
    const shouldRefresh = pull >= THRESHOLD;
    startY.current = null;
    setPull(0);

    if (!shouldRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, pull, refreshing]);

  const indicatorHeight = refreshing ? 44 : pull;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => void onTouchEnd()}
      onTouchCancel={() => {
        startY.current = null;
        setPull(0);
      }}
    >
      <div className={styles.indicator} style={{ height: indicatorHeight }} aria-hidden={!refreshing}>
        {refreshing ? (
          <span className={styles.spinner} />
        ) : pull > 0 ? (
          <span className={styles.text}>{pull >= THRESHOLD ? t('common.releaseToRefresh') : t('common.pullToRefresh')}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
