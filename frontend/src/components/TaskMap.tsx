import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { mapApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { NearbyResult } from '../api/types';
import { LeafletMap, type MapMarker } from './LeafletMap';
import { useGeolocation } from '../hooks/useGeolocation';
import styles from '../styles/TaskMap.module.css';

export type MapFilter = 'all' | 'tasks' | 'workers';

interface Props {
  /** Restricts the filter to one kind and hides the switch. */
  lock?: MapFilter;
  /** Overrides the user's own position, e.g. an order's location. */
  center?: { lat: number; lng: number } | null;
  radiusMeters?: number;
  height?: number;
  category?: string;
  /** Full-bleed variant used when the map is the whole screen. */
  fullBleed?: boolean;
}

const REFRESH_MS = 60_000;

/**
 * Open jobs and available masters on one map.
 *
 * Deliberately a single /api/nearby call rather than reusing the two list
 * endpoints: the map needs both sets for the same viewport, and stitching two
 * independently paginated, independently cold-starting requests together on the
 * client was the alternative.
 */
export function TaskMap({
  lock,
  center: centerProp,
  radiusMeters = 5_000,
  height = 360,
  category,
  fullBleed = false,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [filter, setFilter] = useState<MapFilter>(lock ?? 'all');
  const [data, setData] = useState<NearbyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const center = centerProp ?? geo.coords;
  const effectiveFilter = lock ?? filter;

  const load = useCallback(async () => {
    if (!center) return;
    setLoading(true);
    setError(null);
    try {
      const result = await mapApi.nearby({
        lat: center.lat,
        lng: center.lng,
        radius: radiusMeters,
        type: effectiveFilter,
        category,
      });
      setData(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [center?.lat, center?.lng, radiusMeters, effectiveFilter, category, t, center]);

  useEffect(() => {
    void load();
  }, [load]);

  // Presence goes stale on its own — a master who closed the app keeps a green
  // pin until something re-reads it, so the map refreshes on a slow timer.
  // Paused while the tab is hidden so a backgrounded phone is not polling.
  useEffect(() => {
    if (!center) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, center]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];

    const taskPins: MapMarker[] = data.tasks.map((task) => ({
      id: `task:${task.id}`,
      lat: task.lat,
      lng: task.lng,
      tone: 'task',
      accent: task.isUrgent,
      popup: {
        title: task.title,
        lines: [
          `${task.budgetPi} π`,
          t('map.distanceAway', { km: task.distanceKm }),
          ...(task.isUrgent ? [t('order.urgent')] : []),
        ],
        action: { label: t('map.respond'), href: `/orders/${task.id}` },
      },
    }));

    const workerPins: MapMarker[] = data.workers.map((worker) => ({
      id: `worker:${worker.id}`,
      lat: worker.lat,
      lng: worker.lng,
      tone: 'worker',
      live: worker.isOnline,
      popup: {
        title: worker.displayName,
        lines: [
          worker.ratingCount > 0
            ? `★ ${worker.ratingAvg.toFixed(1)} (${worker.ratingCount})`
            : t('master.noReviews'),
          t('map.jobsDone', { n: worker.completedJobs }),
          t('map.distanceAway', { km: worker.distanceKm }),
        ],
        // Falls back to the map itself when a master somehow has no username,
        // so the popup can never render a link to /masters/undefined.
        action: worker.username
          ? { label: t('map.viewMaster'), href: `/masters/${worker.username}` }
          : undefined,
      },
    }));

    return [...taskPins, ...workerPins];
  }, [data, t]);

  const counts = {
    tasks: data?.tasks.length ?? 0,
    workers: data?.workers.length ?? 0,
  };

  return (
    <div className={fullBleed ? `${styles.wrap} ${styles.full}` : styles.wrap}>
      {!lock ? (
        <div className={styles.filters} role="group" aria-label={t('map.filterLabel')}>
          {(['all', 'tasks', 'workers'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? `${styles.filter} ${styles.filterActive}` : styles.filter}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`map.filter.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {!center ? (
        <div className={styles.prompt}>
          <p className="muted">{t('map.needLocation')}</p>
          <button className="btn" onClick={() => void geo.request()} disabled={geo.loading}>
            {geo.loading ? t('geo.locating') : t('geo.useMyLocation')}
          </button>
          {geo.errorCode ? <p className="hint">{t(`geo.${geo.errorCode}`)}</p> : null}
        </div>
      ) : (
        <>
          <LeafletMap
            center={center}
            markers={markers}
            radiusKm={radiusMeters / 1000}
            height={fullBleed ? 0 : height}
            zoom={13}
            onNavigate={(href) => navigate(href)}
          />

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <i className={`${styles.dot} ${styles.dotTask}`} /> {t('map.legendTasks', { n: counts.tasks })}
            </span>
            <span className={styles.legendItem}>
              <i className={`${styles.dot} ${styles.dotWorker}`} />{' '}
              {t('map.legendWorkers', { n: counts.workers })}
            </span>
            {loading ? <span className={styles.legendItem}>{t('common.loading')}</span> : null}
          </div>

          {error ? <div className="alert alert--error">{error}</div> : null}

          {data?.truncated ? (
            <div className="alert alert--warn">{t('map.truncated')}</div>
          ) : null}

          {!loading && !error && counts.tasks === 0 && counts.workers === 0 ? (
            <p className={styles.empty}>{t('map.empty')}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
