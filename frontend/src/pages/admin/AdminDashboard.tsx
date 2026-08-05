import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { AdminDashboard as Dashboard } from '../../api/types';
import styles from '../../styles/Admin.module.css';

export default function AdminDashboard(): JSX.Element {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminApiClient
      .dashboard()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="alert alert--error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const money = (pi: string, usd: string | null) => (usd ? `${pi} π ($${usd})` : `${pi} π`);

  return (
    <>
      <h1 style={{ margin: 0 }}>Dashboard</h1>

      <div className={styles.grid}>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{data.users.total}</span>
          <span className={styles.tileLabel}>Users</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{data.users.masters}</span>
          <span className={styles.tileLabel}>Masters ({data.users.verifiedMasters} verified)</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{data.orders.total}</span>
          <span className={styles.tileLabel}>Orders ({data.orders.open} open)</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{data.orders.completed}</span>
          <span className={styles.tileLabel}>Completed deals</span>
        </div>
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Revenue (commission + express + connects)</h2>
        <div className={styles.grid}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.todayPi, data.revenue.todayUsd)}</span>
            <span className={styles.tileLabel}>Today</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.weekPi, data.revenue.weekUsd)}</span>
            <span className={styles.tileLabel}>Last 7 days</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.monthPi, data.revenue.monthUsd)}</span>
            <span className={styles.tileLabel}>Last 30 days</span>
          </div>
        </div>
        {Number(data.revenue.piUsdRate) === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            Set <code>piUsdRate</code> in Settings to see USD equivalents.
          </p>
        ) : null}
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Liabilities</h2>
        <div className={styles.grid}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{data.liabilities.escrowHeldPi} π</span>
            <span className={styles.tileLabel}>Held in escrow</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{data.liabilities.userBalancesPi} π</span>
            <span className={styles.tileLabel}>Owed to user balances</span>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Queue</h2>
        <div className={styles.actions}>
          <Link to="/admin/verifications" className={styles.smallBtn}>
            Verifications: {data.queue.pendingVerifications}
          </Link>
          <Link to="/admin/withdrawals" className={styles.smallBtn}>
            Withdrawals: {data.queue.pendingWithdrawals}
          </Link>
          <Link to="/admin/orders?status=DISPUTED" className={styles.smallBtn}>
            Disputes: {data.orders.disputes}
          </Link>
        </div>
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>System</h2>
        <div className={styles.actions}>
          <span className={`${styles.pill} ${data.system.sandbox ? styles.pillWarn : styles.pillGood}`}>
            {data.system.sandbox ? 'Sandbox / Testnet' : 'Mainnet'}
          </span>
          <span className={`${styles.pill} ${data.system.payoutsConfigured ? styles.pillGood : styles.pillBad}`}>
            Payouts {data.system.payoutsConfigured ? 'ready' : 'not configured'}
          </span>
          <span className={`${styles.pill} ${data.system.cloudinaryConfigured ? styles.pillGood : styles.pillBad}`}>
            Cloudinary {data.system.cloudinaryConfigured ? 'ready' : 'not configured'}
          </span>
          <span className={`${styles.pill} ${data.system.requireKyc ? styles.pillGood : styles.pillWarn}`}>
            KYC gate {data.system.requireKyc ? 'on' : 'off'}
          </span>
          {data.system.maintenanceMode ? (
            <span className={`${styles.pill} ${styles.pillBad}`}>Maintenance mode ON</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
