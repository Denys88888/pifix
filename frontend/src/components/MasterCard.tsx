import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MasterProfile } from '../api/types';
import { ReviewStars } from './ReviewStars';
import { truncate } from '../lib/format';
import styles from '../styles/MasterCard.module.css';

export function MasterCard({ master }: { master: MasterProfile }): JSX.Element {
  const { t } = useTranslation();
  const initials = master.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <Link to={`/masters/${encodeURIComponent(master.username ?? '')}`} className={styles.card}>
      <div className={styles.head}>
        {master.avatarUrl ? (
          <img src={master.avatarUrl} alt="" className={styles.avatar} loading="lazy" />
        ) : (
          <div className={`${styles.avatar} ${styles.placeholder}`} aria-hidden="true">
            {initials}
          </div>
        )}

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{master.displayName}</span>
            {master.verificationStatus === 'VERIFIED' ? (
              <span className={styles.verified} title={t('master.verified')}>
                ✓
              </span>
            ) : null}
            {master.isPro ? <span className="badge">PRO</span> : null}
          </div>
          <ReviewStars value={master.ratingAvg} size="sm" showValue count={master.ratingCount} />
          <span className={styles.jobs}>{t('master.jobsDone', { count: master.completedJobs })}</span>
        </div>

        {master.isBoosted ? <span className={styles.boost}>🔥</span> : null}
      </div>

      <p className={styles.bio}>{truncate(master.bio, 120)}</p>

      <div className={styles.tags}>
        {master.categories.slice(0, 3).map((slug) => (
          <span key={slug} className="badge badge--muted">
            {t(`categories.${slug}`)}
          </span>
        ))}
        {master.categories.length > 3 ? (
          <span className="badge badge--muted">+{master.categories.length - 3}</span>
        ) : null}
        {typeof master.distanceKm === 'number' && Number.isFinite(master.distanceKm) ? (
          <span className="badge">
            {master.distanceKm} {t('common.km')}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
