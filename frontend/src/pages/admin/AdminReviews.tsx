import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { Review } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import styles from '../../styles/Admin.module.css';

export default function AdminReviews(): JSX.Element {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Review[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await adminApiClient.reviews({ page, limit: 20, hidden: hidden || undefined });
      setItems(result.items);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load');
    }
  }, [page, hidden]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (review: Review) => {
    setBusy(true);
    try {
      await adminApiClient.hideReview(review.id, !review.isHidden);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ margin: 0 }}>{t('admin.reviewModeration')}</h1>

      <div className={styles.panel}>
        <div className={styles.filterBar}>
          <label>{t('admin.visibility')}<select
              value={hidden}
              onChange={(event) => {
                setHidden(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('admin.all')}</option>
              <option value="false">{t('admin.visible')}</option>
              <option value="true">{t('admin.hidden')}</option>
            </select>
          </label>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('admin.rating')}</th>
                <th>{t('admin.text')}</th>
                <th>From → To</th>
                <th>{t('admin.job')}</th>
                <th>{t('admin.date')}</th>
                <th>{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((review) => (
                <tr key={review.id}>
                  <td>
                    <strong>{'★'.repeat(review.rating)}</strong>
                    <div className="hint">{review.rating}/5</div>
                  </td>
                  <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{review.text || <span className="hint">—</span>}</td>
                  <td className="hint">
                    @{review.author?.username ?? '—'} → @{review.targetUsername ?? '—'}
                  </td>
                  <td className="hint">#{review.orderPublicId ?? '—'}</td>
                  <td className="hint">{formatDateTime(review.createdAt)}</td>
                  <td>
                    <button
                      className={
                        review.isHidden
                          ? styles.smallBtn
                          : `${styles.smallBtn} ${styles.smallBtnDanger}`
                      }
                      disabled={busy}
                      onClick={() => void toggle(review)}
                    >
                      {review.isHidden ? t('admin.restore') : t('admin.hide')}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">{t('admin.nothingToShow')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

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
      </div>
    </>
  );
}
