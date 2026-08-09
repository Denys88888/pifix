import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ordersApi } from '../api/endpoints';
import type { Order } from '../api/types';
import { OrderCard } from '../components/OrderCard';
import { SkeletonList } from '../components/SkeletonCard';
import { TaskMap } from '../components/TaskMap';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/Pages.module.css';

export default function Home(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories, settings } = usePlatformSettings();
  const { user, status } = useAuth();

  const [recent, setRecent] = useState<Order[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ordersApi
      .list({ limit: 5, sort: 'date' })
      .then((page) => {
        if (!cancelled) setRecent(page.items);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page stack">
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>{t('home.title')}</h1>
        <p className={styles.heroSub}>{t('home.subtitle')}</p>
        <div className={styles.heroActions}>
          <button className="btn" onClick={() => navigate('/orders/new')}>
            {t('home.postJob')}
          </button>
          <button className="btn btn--secondary" onClick={() => navigate('/masters')}>
            {t('home.findMaster')}
          </button>
        </div>
      </section>

      {status === 'signed_in' && user && !user.isMaster ? (
        <Link to="/dashboard/profile" className="alert alert--info" style={{ display: 'block' }}>
          {t('home.becomeMaster')}
        </Link>
      ) : null}

      <div className={styles.sectionTitle}>
        <h2>{t('home.categories')}</h2>
        <Link to="/orders" className={styles.link}>
          {t('common.seeAll')}
        </Link>
      </div>

      <div className={styles.categoryGrid}>
        {categories.map((category) => (
          <Link
            key={category.slug}
            to={`/orders?category=${category.slug}`}
            className={styles.categoryTile}
          >
            <span className={styles.categoryIcon} aria-hidden="true">
              {category.icon}
            </span>
            {t(`categories.${category.slug}`)}
          </Link>
        ))}
      </div>

      <div className={styles.sectionTitle}>
        <h2>{t('home.nearby')}</h2>
      </div>

      <TaskMap height={320} />

      <div className={styles.sectionTitle}>
        <h2>{t('home.latestJobs')}</h2>
        <Link to="/orders" className={styles.link}>
          {t('common.seeAll')}
        </Link>
      </div>

      {recent === null ? (
        <SkeletonList count={3} />
      ) : recent.length === 0 ? (
        <p className="muted">{t('orders.empty')}</p>
      ) : (
        <div className="stack">
          {recent.map((order) => (
            <OrderCard key={order.id} order={order} showResponses={false} />
          ))}
        </div>
      )}

      {settings ? (
        <div className="card stack">
          <h3>{t('home.howItWorks')}</h3>
          <ol className="muted" style={{ paddingInlineStart: 20, margin: 0, lineHeight: 1.75 }}>
            <li>{t('home.step1')}</li>
            <li>{t('home.step2', { fee: settings.clientFeePercent })}</li>
            <li>{t('home.step3', { days: settings.escrowTimeoutDays })}</li>
          </ol>
          <Link to="/privacy" className={styles.link}>
            {t('common.privacy')}
          </Link>
        </div>
      ) : null}
    </main>
  );
}
