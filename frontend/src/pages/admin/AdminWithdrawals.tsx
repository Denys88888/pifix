import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { Withdrawal } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import styles from '../../styles/Admin.module.css';

const STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', ''];

export default function AdminWithdrawals(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await adminApiClient.withdrawals({ page, limit: 20, status: status || undefined });
      setItems(result.items);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load');
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async (withdrawal: Withdrawal) => {
    const confirmed = window.confirm(
      `Send ${withdrawal.amountPi} π to ${withdrawal.walletAddress} (@${withdrawal.username})?\n\n` +
        'This creates a real App→User payment on the Pi network.',
    );
    if (!confirmed) return;

    setBusyId(withdrawal.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await adminApiClient.payWithdrawal(withdrawal.id);
      setMessage(`Paid. txid: ${updated.txid ?? '—'}`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Payout failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (withdrawal: Withdrawal) => {
    const note = window.prompt('Reason for rejection') ?? undefined;
    setBusyId(withdrawal.id);
    try {
      await adminApiClient.rejectWithdrawal(withdrawal.id, note);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 style={{ margin: 0 }}>{t('admin.withdrawalRequests')}</h1>

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
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? <div className="alert alert--info">{message}</div> : null}

      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('admin.user')}</th>
                <th>{t('admin.amount')}</th>
                <th>{t('admin.wallet')}</th>
                <th>{t('admin.status')}</th>
                <th>{t('admin.requested')}</th>
                <th>{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((withdrawal) => (
                <tr key={withdrawal.id}>
                  <td>@{withdrawal.username ?? '—'}</td>
                  <td>
                    <strong>{withdrawal.amountPi} π</strong>
                  </td>
                  <td style={{ wordBreak: 'break-all', maxWidth: 220 }}>
                    <span className="hint">{withdrawal.walletAddress}</span>
                    {withdrawal.txid ? <div className="hint">tx: {withdrawal.txid}</div> : null}
                  </td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        withdrawal.status === 'PAID'
                          ? styles.pillGood
                          : withdrawal.status === 'REJECTED'
                            ? styles.pillBad
                            : styles.pillWarn
                      }`}
                    >
                      {withdrawal.status}
                    </span>
                    {withdrawal.adminNote ? <div className="hint">{withdrawal.adminNote}</div> : null}
                  </td>
                  <td className="hint">{formatDateTime(withdrawal.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={styles.smallBtn}
                        disabled={busyId === withdrawal.id || withdrawal.status === 'PAID'}
                        onClick={() => void pay(withdrawal)}
                      >
                        {busyId === withdrawal.id ? t('admin.paying') : t('admin.payOut')}
                      </button>
                      <button
                        className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                        disabled={busyId === withdrawal.id || withdrawal.status === 'PAID'}
                        onClick={() => void reject(withdrawal)}
                      >{t('admin.reject')}</button>
                    </div>
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
