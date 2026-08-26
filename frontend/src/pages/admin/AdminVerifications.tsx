import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { MasterProfile } from '../../api/types';
import styles from '../../styles/Admin.module.css';

const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'UNVERIFIED', ''];

export default function AdminVerifications(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MasterProfile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await adminApiClient.masters({
        page,
        limit: 20,
        status: status || undefined,
        search: search || undefined,
      });
      setItems(result.items);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load');
    }
  }, [page, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (profile: MasterProfile, decision: 'approve' | 'reject') => {
    const note =
      decision === 'reject'
        ? (window.prompt('Reason shown to the master (optional)') ?? undefined)
        : undefined;
    setBusy(true);
    try {
      await adminApiClient.verifyMaster(profile.id, decision, note);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async (profile: MasterProfile) => {
    setBusy(true);
    try {
      await adminApiClient.blockUser(profile.userId, !profile.isBlocked);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ margin: 0 }}>{t('admin.masterVerification')}</h1>

      <div className={styles.panel}>
        <div className={styles.filterBar}>
          <label>{t('admin.status')}<select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              {STATUSES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value || 'All'}
                </option>
              ))}
            </select>
          </label>
          <label>{t('admin.search')}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.searchUsername')} />
          </label>
          <button className={styles.smallBtn} onClick={() => void load()}>{t('admin.apply')}</button>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {items.length === 0 ? <p className="muted">{t('admin.nothingInQueue')}</p> : null}

      {items.map((profile) => (
        <div key={profile.id} className={styles.panel}>
          <div className="spread">
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>
                {profile.displayName}{' '}
                <span className="hint">@{profile.username}</span>
              </h2>
              <div className={styles.actions} style={{ marginTop: 6 }}>
                <span
                  className={`${styles.pill} ${
                    profile.verificationStatus === 'VERIFIED'
                      ? styles.pillGood
                      : profile.verificationStatus === 'PENDING'
                        ? styles.pillWarn
                        : styles.pillBad
                  }`}
                >
                  {profile.verificationStatus}
                </span>
                <span className={styles.pill}>{profile.completedJobs} jobs</span>
                <span className={styles.pill}>
                  ★ {profile.ratingAvg.toFixed(1)} ({profile.ratingCount})
                </span>
                {profile.isBlocked ? <span className={`${styles.pill} ${styles.pillBad}`}>{t('admin.blocked')}</span> : null}
              </div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>

          <div className={styles.actions}>
            {profile.categories.map((slug) => (
              <span key={slug} className={styles.pill}>
                {slug}
              </span>
            ))}
          </div>

          {profile.verificationDocs && profile.verificationDocs.length > 0 ? (
            <>
              <strong style={{ fontSize: 13 }}>{t('admin.submittedDocs')}</strong>
              <div className={styles.docStrip}>
                {profile.verificationDocs.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                    <img src={url} alt="verification document" />
                  </a>
                ))}
              </div>
            </>
          ) : (
            <span className="hint">{t('admin.noDocs')}</span>
          )}

          {profile.portfolio.length > 0 ? (
            <>
              <strong style={{ fontSize: 13 }}>{t('admin.portfolio')}</strong>
              <div className={styles.docStrip}>
                {profile.portfolio.map((url) => (
                  <img key={url} src={url} alt="portfolio" />
                ))}
              </div>
            </>
          ) : null}

          <div className={styles.actions}>
            <button
              className={styles.smallBtn}
              disabled={busy || profile.verificationStatus === 'VERIFIED'}
              onClick={() => void decide(profile, 'approve')}
            >{t('admin.approve')}</button>
            <button
              className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
              disabled={busy || profile.verificationStatus === 'REJECTED'}
              onClick={() => void decide(profile, 'reject')}
            >{t('admin.reject')}</button>
            <button
              className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
              disabled={busy}
              onClick={() => void toggleBlock(profile)}
            >
              {profile.isBlocked ? t('admin.unblockUser') : t('admin.blockUser')}
            </button>
          </div>
        </div>
      ))}

      <div className={styles.actions}>
        <button
          className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
          disabled={page === 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >{t('admin.previous')}</button>
        <span className="hint">Page {page}</span>
        <button
          className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
          disabled={!hasMore}
          onClick={() => setPage((current) => current + 1)}
        >{t('admin.next')}</button>
      </div>
    </>
  );
}
