import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mastersApi, type MasterFilters } from '../api/endpoints';
import type { MasterProfile } from '../api/types';
import { MasterCard } from '../components/MasterCard';
import { SkeletonList } from '../components/SkeletonCard';
import { EmptyState } from '../components/EmptyState';
import { PullToRefresh } from '../components/PullToRefresh';
import { LeafletMap, type MapMarker } from '../components/LeafletMap';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { useGeolocation } from '../hooks/useGeolocation';
import { ApiError } from '../api/client';
import styles from '../styles/Pages.module.css';

export default function MastersList(): JSX.Element {
  const { t } = useTranslation();
  const { categories } = usePlatformSettings();
  const geo = useGeolocation();

  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'rating' | 'jobs' | 'distance'>('rating');
  const [radiusKm, setRadiusKm] = useState(25);
  const [view, setView] = useState<'list' | 'map'>('list');

  const [items, setItems] = useState<MasterProfile[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo<MasterFilters>(() => {
    const base: MasterFilters = { limit: 20, sort, verifiedOnly: true };
    if (category) base.category = category;
    if (geo.coords) {
      base.lat = geo.coords.lat;
      base.lng = geo.coords.lng;
      base.radiusKm = radiusKm;
    }
    return base;
  }, [category, sort, geo.coords, radiusKm]);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(!append);
      setError(null);
      try {
        const result = await mastersApi.search({ ...filters, page: nextPage });
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setTotal(result.total);
        setTruncated(Boolean(result.truncated));
        setPage(result.page);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [filters, t],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  const markers: MapMarker[] = items
    .filter((master) => master.lat !== null && master.lng !== null)
    .map((master) => ({
      id: master.id,
      lat: master.lat as number,
      lng: master.lng as number,
      label: String(master.ratingAvg.toFixed(1)),
      accent: master.isBoosted,
    }));

  return (
    <PullToRefresh onRefresh={() => load(1, false)}>
      <main className="page stack">
        <h1>{t('masters.title')}</h1>

        <div className={styles.chips}>
          <button
            className={category === '' ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => setCategory('')}
          >
            {t('common.all')}
          </button>
          {categories.map((item) => (
            <button
              key={item.slug}
              className={category === item.slug ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => setCategory((current) => (current === item.slug ? '' : item.slug))}
            >
              {item.icon} {t(`categories.${item.slug}`)}
            </button>
          ))}
        </div>

        <div className={styles.filters}>
          <label>
            <span className="label">{t('orders.sort')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="rating">{t('masters.sortRating')}</option>
              <option value="jobs">{t('masters.sortJobs')}</option>
              <option value="distance" disabled={!geo.coords}>
                {t('orders.sortDistance')}
              </option>
            </select>
          </label>

          <button className="btn btn--secondary" onClick={() => void geo.request()} disabled={geo.loading}>
            {geo.loading ? t('geo.locating') : geo.coords ? t('geo.updateLocation') : t('geo.useMyLocation')}
          </button>

          {geo.errorCode ? <p className="hint">{t(`geo.${geo.errorCode}`)}</p> : null}

          {geo.coords ? (
            <label>
              <span className="label">{t('orders.radius', { km: radiusKm })}</span>
              <input
                className={styles.slider}
                type="range"
                min={1}
                max={100}
                value={radiusKm}
                onChange={(event) => setRadiusKm(Number(event.target.value))}
              />
            </label>
          ) : null}
        </div>

        <div className={styles.viewToggle}>
          <button
            className={view === 'list' ? `${styles.viewButton} ${styles.viewButtonActive}` : styles.viewButton}
            onClick={() => setView('list')}
          >
            {t('common.list')}
          </button>
          <button
            className={view === 'map' ? `${styles.viewButton} ${styles.viewButtonActive}` : styles.viewButton}
            onClick={() => setView('map')}
          >
            {t('common.map')}
          </button>
        </div>

        {error ? <div className="alert alert--error">{error}</div> : null}

        {truncated ? (
          <div className="alert alert--warn">{t('common.truncated', { shown: total })}</div>
        ) : null}

        {view === 'map' ? (
          <LeafletMap
            center={geo.coords}
            markers={markers}
            radiusKm={geo.coords ? radiusKm : undefined}
            height={340}
            zoom={11}
          />
        ) : null}

        {loading ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState icon="🛠️" title={t('masters.empty')} hint={t('masters.emptyHint')} />
        ) : (
          <div className="stack">
            {items.map((master) => (
              <MasterCard key={master.id} master={master} />
            ))}
          </div>
        )}

        {hasMore && !loading ? (
          <button className={styles.loadMore} onClick={() => void load(page + 1, true)}>
            {t('common.loadMore')}
          </button>
        ) : null}
      </main>
    </PullToRefresh>
  );
}
