import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ordersApi, type OrderFilters } from '../api/endpoints';
import type { Order } from '../api/types';
import { OrderCard } from '../components/OrderCard';
import { SkeletonList } from '../components/SkeletonCard';
import { EmptyState } from '../components/EmptyState';
import { PullToRefresh } from '../components/PullToRefresh';
import { LeafletMap, type MapMarker } from '../components/LeafletMap';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { useGeolocation } from '../hooks/useGeolocation';
import { ApiError } from '../api/client';
import styles from '../styles/Pages.module.css';

const PAGE_SIZE = 20;

export default function OrdersList(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories } = usePlatformSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const geo = useGeolocation();

  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [sort, setSort] = useState<'date' | 'budget' | 'distance'>('date');
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState(25);
  const [view, setView] = useState<'list' | 'map'>('list');

  const [items, setItems] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filters = useMemo<OrderFilters>(() => {
    const base: OrderFilters = { limit: PAGE_SIZE, sort, status: 'OPEN' };
    if (category) base.category = category;
    if (minBudget) base.minBudget = Number(minBudget);
    if (maxBudget) base.maxBudget = Number(maxBudget);
    if (urgentOnly) base.urgentOnly = true;
    if (geo.coords) {
      base.lat = geo.coords.lat;
      base.lng = geo.coords.lng;
      base.radiusKm = radiusKm;
    }
    return base;
  }, [category, sort, minBudget, maxBudget, urgentOnly, geo.coords, radiusKm]);

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await ordersApi.list({ ...filters, page: nextPage });
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
        setLoadingMore(false);
      }
    },
    [filters, t],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  // Infinite scroll: an IntersectionObserver on the sentinel is far cheaper
  // than a scroll listener on a low-end Android WebView.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load(page + 1, true);
      },
      { rootMargin: '320px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, load]);

  const applyCategory = (slug: string) => {
    const next = slug === category ? '' : slug;
    setCategory(next);
    setSearchParams(next ? { category: next } : {});
  };

  const markers: MapMarker[] = items
    .filter((order) => Number.isFinite(order.lat) && Number.isFinite(order.lng))
    .map((order) => ({
      id: order.id,
      lat: order.lat,
      lng: order.lng,
      label: order.budgetPi.split('.')[0],
      accent: order.isUrgent,
      tone: 'task' as const,
      popup: {
        title: order.title,
        lines: [
          `${order.budgetPi} π`,
          ...(order.distanceKm !== undefined ? [t('map.distanceAway', { km: order.distanceKm })] : []),
          ...(order.isUrgent ? [t('order.urgent')] : []),
        ],
        action: { label: t('map.respond'), href: `/orders/${order.id}` },
      },
    }));

  return (
    <PullToRefresh onRefresh={() => load(1, false)}>
      <main className="page stack">
        <div className="spread">
          <h1>{t('orders.title')}</h1>
          <Link to="/orders/new" className="btn btn--sm">
            + {t('orders.new')}
          </Link>
        </div>

        <div className={styles.chips}>
          <button
            className={category === '' ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => applyCategory('')}
          >
            {t('common.all')}
          </button>
          {categories.map((item) => (
            <button
              key={item.slug}
              className={category === item.slug ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => applyCategory(item.slug)}
            >
              {item.icon} {t(`categories.${item.slug}`)}
            </button>
          ))}
        </div>

        <details className={styles.filters}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
            {t('orders.filters')}
          </summary>

          <div className="stack" style={{ marginTop: 12 }}>
            <div className={styles.filterRow}>
              <label>
                <span className="label">{t('orders.minBudget')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={minBudget}
                  onChange={(event) => setMinBudget(event.target.value)}
                  placeholder="0"
                />
              </label>
              <label>
                <span className="label">{t('orders.maxBudget')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={maxBudget}
                  onChange={(event) => setMaxBudget(event.target.value)}
                  placeholder="∞"
                />
              </label>
            </div>

            <label>
              <span className="label">{t('orders.sort')}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="date">{t('orders.sortDate')}</option>
                <option value="budget">{t('orders.sortBudget')}</option>
                <option value="distance" disabled={!geo.coords}>
                  {t('orders.sortDistance')}
                </option>
              </select>
            </label>

            <div className={styles.toggleRow}>
              <span>{t('orders.urgentOnly')}</span>
              <button
                type="button"
                className={urgentOnly ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                onClick={() => setUrgentOnly((current) => !current)}
                role="switch"
                aria-checked={urgentOnly}
                aria-label={t('orders.urgentOnly')}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>

            <div className="stack">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void geo.request()}
                disabled={geo.loading}
              >
                {geo.loading
                  ? t('geo.locating')
                  : geo.coords
                    ? t('geo.updateLocation')
                    : t('geo.useMyLocation')}
              </button>

              {geo.errorCode ? (
                <p className="hint">{t(`geo.${geo.errorCode}`)}</p>
              ) : null}

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
          </div>
        </details>

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
            onNavigate={(href) => navigate(href)}
            center={geo.coords ?? (items[0] ? { lat: items[0].lat, lng: items[0].lng } : null)}
            markers={markers}
            radiusKm={geo.coords ? radiusKm : undefined}
            height={340}
            zoom={11}
          />
        ) : null}

        {loading ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={t('orders.empty')}
            hint={t('orders.emptyHint')}
            action={
              <Link to="/orders/new" className="btn btn--sm">
                {t('orders.new')}
              </Link>
            }
          />
        ) : (
          <div className="stack">
            {items.map((order) => (
              <OrderCard key={order.id} order={order} showResponses={false} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} />

        {loadingMore ? <SkeletonList count={2} /> : null}

        {!loading && hasMore && !loadingMore ? (
          <button className={styles.loadMore} onClick={() => void load(page + 1, true)}>
            {t('common.loadMore')}
          </button>
        ) : null}
      </main>
    </PullToRefresh>
  );
}
