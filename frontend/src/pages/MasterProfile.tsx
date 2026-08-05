import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mastersApi, reviewsApi } from '../api/endpoints';
import type { MasterProfile as MasterProfileType, Review } from '../api/types';
import { ReviewStars } from '../components/ReviewStars';
import { SkeletonList } from '../components/SkeletonCard';
import { LeafletMap } from '../components/LeafletMap';
import { formatDate } from '../lib/format';
import { ApiError } from '../api/client';
import styles from '../styles/Pages.module.css';
import profileStyles from '../styles/MasterProfile.module.css';

export default function MasterProfile(): JSX.Element {
  const { username = '' } = useParams();
  const { t, i18n } = useTranslation();

  const [profile, setProfile] = useState<MasterProfileType | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void mastersApi
      .byUsername(username)
      .then((data) => {
        if (cancelled) return;
        setProfile(data.profile);
        setReviews(data.reviews);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username, t]);

  const loadMoreReviews = async () => {
    const next = reviewPage + 1;
    const page = await reviewsApi.forUser(username, next, 10);
    setReviews((current) => [...current, ...page.items]);
    setHasMoreReviews(page.hasMore);
    setReviewPage(next);
  };

  useEffect(() => {
    if (reviews.length >= 10) setHasMoreReviews(true);
  }, [reviews.length]);

  if (loading) {
    return (
      <main className="page">
        <SkeletonList count={3} />
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="page stack">
        <div className="alert alert--error">{error ?? t('errors.not_found')}</div>
        <Link to="/masters" className="btn btn--secondary">
          {t('common.back')}
        </Link>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className={profileStyles.header}>
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className={profileStyles.avatar} />
        ) : (
          <div className={`${profileStyles.avatar} ${profileStyles.placeholder}`} aria-hidden="true">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className={profileStyles.headerInfo}>
          <h1 className={profileStyles.name}>
            {profile.displayName}
            {profile.verificationStatus === 'VERIFIED' ? (
              <span className={profileStyles.verified} title={t('master.verified')}>
                ✓
              </span>
            ) : null}
          </h1>
          <span className="muted">@{profile.username}</span>
          <ReviewStars value={profile.ratingAvg} showValue count={profile.ratingCount} />
        </div>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{profile.completedJobs}</span>
          <span className={styles.statLabel}>{t('master.completedJobs')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{profile.radiusKm} {t('common.km')}</span>
          <span className={styles.statLabel}>{t('master.radius')}</span>
        </div>
      </div>

      {profile.verificationStatus !== 'VERIFIED' ? (
        <div className="alert alert--warn">{t('master.notVerifiedPublic')}</div>
      ) : null}

      <div className="card stack">
        <h2>{t('master.about')}</h2>
        <p className={profileStyles.bio}>{profile.bio}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {profile.categories.map((slug) => (
            <span key={slug} className="badge badge--muted">
              {t(`categories.${slug}`)}
            </span>
          ))}
        </div>
        <span className="hint">{t('master.memberSince', { date: formatDate(profile.createdAt, i18n.resolvedLanguage) })}</span>
      </div>

      {profile.portfolio.length > 0 ? (
        <div className="card stack">
          <h2>{t('master.portfolio')}</h2>
          <div className={styles.photoStrip}>
            {profile.portfolio.map((photo) => (
              <img key={photo} src={photo} alt="" loading="lazy" />
            ))}
          </div>
        </div>
      ) : null}

      {profile.certificates.length > 0 ? (
        <div className="card stack">
          <h2>{t('master.certificates')}</h2>
          <div className={styles.photoStrip}>
            {profile.certificates.map((photo) => (
              <img key={photo} src={photo} alt="" loading="lazy" />
            ))}
          </div>
        </div>
      ) : null}

      {profile.lat !== null && profile.lng !== null ? (
        <div className="card stack">
          <h2>{t('master.workArea')}</h2>
          <LeafletMap
            center={{ lat: profile.lat, lng: profile.lng }}
            markers={[{ id: profile.id, lat: profile.lat, lng: profile.lng, accent: true }]}
            radiusKm={profile.radiusKm}
            height={220}
            zoom={10}
          />
        </div>
      ) : null}

      <div className={styles.sectionTitle}>
        <h2>{t('master.reviews', { count: profile.ratingCount })}</h2>
      </div>

      {reviews.length === 0 ? (
        <p className="muted">{t('master.noReviews')}</p>
      ) : (
        <div className="stack">
          {reviews.map((review) => (
            <div key={review.id} className="card stack" style={{ gap: 6 }}>
              <div className="spread">
                <span style={{ fontWeight: 600 }}>@{review.author?.username ?? '—'}</span>
                <ReviewStars value={review.rating} size="sm" />
              </div>
              {review.text ? <p style={{ margin: 0, fontSize: 14 }}>{review.text}</p> : null}
              <span className="hint">{formatDate(review.createdAt, i18n.resolvedLanguage)}</span>
            </div>
          ))}
        </div>
      )}

      {hasMoreReviews ? (
        <button className={styles.loadMore} onClick={() => void loadMoreReviews()}>
          {t('common.loadMore')}
        </button>
      ) : null}
    </main>
  );
}
