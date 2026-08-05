import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { Order } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import styles from '../../styles/Admin.module.css';

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'DISPUTED'];

export default function AdminOrders(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await adminApiClient.orders({
        page,
        limit: 20,
        status: status || undefined,
        search: search || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load');
    }
  }, [page, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (
    id: string,
    action: 'release' | 'refund' | 'refund_with_fees' | 'cancel',
  ) => {
    const note = window.prompt(`Note for "${action}" (optional)`) ?? undefined;
    setBusy(true);
    try {
      await adminApiClient.resolveOrder(id, action, note);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ margin: 0 }}>Orders ({total})</h1>

      <div className={styles.panel}>
        <div className={styles.filterBar}>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setSearchParams(event.target.value ? { status: event.target.value } : {});
              }}
            >
              {STATUSES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value || 'All'}
                </option>
              ))}
            </select>
          </label>

          <label>
            Search (id, title, client)
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="A7K3QD" />
          </label>

          <button
            className={styles.smallBtn}
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            Apply
          </button>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Escrow</th>
                <th>Amounts</th>
                <th>Parties</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>#{order.publicId}</strong>
                    <div className="hint">{order.title}</div>
                  </td>
                  <td>
                    <span className={styles.pill}>{order.status}</span>
                  </td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        order.escrowStatus === 'FUNDED' ? styles.pillWarn : styles.pill
                      }`}
                    >
                      {order.escrowStatus}
                    </span>
                  </td>
                  <td>
                    <div>budget {order.budgetPi} π</div>
                    <div className="hint">
                      paid {order.totalPaidPi} π · fee {order.clientFeePi} π · payout {order.masterPayoutPi} π
                    </div>
                  </td>
                  <td>
                    <div>@{order.client?.username ?? '—'}</div>
                    <div className="hint">→ @{order.master?.username ?? '—'}</div>
                  </td>
                  <td className="hint">{formatDateTime(order.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      {order.escrowStatus === 'FUNDED' ? (
                        <>
                          <button
                            className={styles.smallBtn}
                            disabled={busy}
                            onClick={() => void resolve(order.id, 'release')}
                          >
                            Release
                          </button>
                          <button
                            className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
                            disabled={busy}
                            onClick={() => void resolve(order.id, 'refund')}
                          >
                            Refund
                          </button>
                          <button
                            className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
                            disabled={busy}
                            onClick={() => void resolve(order.id, 'refund_with_fees')}
                          >
                            Refund + fees
                          </button>
                        </>
                      ) : order.status === 'OPEN' ? (
                        <button
                          className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                          disabled={busy}
                          onClick={() => void resolve(order.id, 'cancel')}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Nothing to show.
                  </td>
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
          >
            Previous
          </button>
          <span className="hint">Page {page}</span>
          <button
            className={`${styles.smallBtn} ${styles.smallBtnGhost}`}
            disabled={!hasMore}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
