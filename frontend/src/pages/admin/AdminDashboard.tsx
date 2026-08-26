import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { AdminDashboard as Dashboard } from '../../api/types';
import styles from '../../styles/Admin.module.css';

export default function AdminDashboard(): JSX.Element {
  const { t } = useTranslation();
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
      <h1 style={{ margin: 0 }}>{t('admin.nav.dashboard')}</h1>

      <div className={styles.grid}>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{data.users.total}</span>
          <span className={styles.tileLabel}>{t('admin.users')}</span>
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
          <span className={styles.tileLabel}>{t('admin.completedDeals')}</span>
        </div>
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{t('admin.revenue')}</h2>
        <div className={styles.grid}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.todayPi, data.revenue.todayUsd)}</span>
            <span className={styles.tileLabel}>{t('admin.today')}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.weekPi, data.revenue.weekUsd)}</span>
            <span className={styles.tileLabel}>{t('admin.last7')}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{money(data.revenue.monthPi, data.revenue.monthUsd)}</span>
            <span className={styles.tileLabel}>{t('admin.last30')}</span>
          </div>
        </div>
        {Number(data.revenue.piUsdRate) === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t('admin.setRateHint')}
          </p>
        ) : null}
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{t('admin.liabilities')}</h2>
        <div className={styles.grid}>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{data.liabilities.escrowHeldPi} π</span>
            <span className={styles.tileLabel}>{t('admin.heldInEscrow')}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileValue}>{data.liabilities.userBalancesPi} π</span>
            <span className={styles.tileLabel}>{t('admin.owedToBalances')}</span>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{t('admin.queue')}</h2>
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
        <h2 style={{ margin: 0, fontSize: 17 }}>{t('admin.system')}</h2>
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
            <span className={`${styles.pill} ${styles.pillBad}`}>{t('admin.maintenanceOn')}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
