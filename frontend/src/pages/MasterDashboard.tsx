import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mastersApi, ordersApi, withdrawalsApi } from '../api/endpoints';
import type { MasterStats, Order, OrderResponse, Transaction, Withdrawal } from '../api/types';
import { ApiError } from '../api/client';
import { OrderCard } from '../components/OrderCard';
import { SkeletonList } from '../components/SkeletonCard';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { ImageUploader } from '../components/ImageUploader';
import { PullToRefresh } from '../components/PullToRefresh';
import { TaskMap } from '../components/TaskMap';
import { AvailabilityToggle } from '../components/AvailabilityToggle';
import { useAuth } from '../hooks/useAuth';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { formatDate, shortWallet } from '../lib/format';
import styles from '../styles/Pages.module.css';

type Tab = 'jobs' | 'map' | 'responses' | 'money';

export default function MasterDashboard(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { settings } = usePlatformSettings();

  const [tab, setTab] = useState<Tab>('jobs');
  const [stats, setStats] = useState<MasterStats | null>(null);
  const [jobs, setJobs] = useState<Order[]>([]);
  const [responses, setResponses] = useState<OrderResponse[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [documents, setDocuments] = useState<string[]>([]);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextStats, nextJobs, nextResponses, nextTransactions, nextWithdrawals] = await Promise.all([
        mastersApi.stats(),
        ordersApi.mine('master', 1, 20),
        mastersApi.myResponses(1, 20),
        mastersApi.transactions(1, 20),
        withdrawalsApi.mine(1, 10),
      ]);
      setStats(nextStats);
      setJobs(nextJobs.items);
      setResponses(nextResponses.items);
      setTransactions(nextTransactions.items);
      setWithdrawals(nextWithdrawals.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitVerification = async () => {
    setBusy(true);
    setError(null);
    try {
      await mastersApi.submitVerification(documents);
      setVerifyOpen(false);
      setDocuments([]);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const submitWithdrawal = async () => {
    setBusy(true);
    setError(null);
    try {
      await withdrawalsApi.request(withdrawAmount);
      setWithdrawOpen(false);
      setWithdrawAmount('');
      await Promise.all([load(), refreshUser()]);
    } catch (caught) {
      setError(caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const withdrawResponse = async (responseId: string) => {
    setBusy(true);
    try {
      await mastersApi.withdrawResponse(responseId);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <SkeletonList count={4} />
      </main>
    );
  }

  const status = stats?.verificationStatus ?? 'UNVERIFIED';

  return (
    <PullToRefresh onRefresh={load}>
      <main className="page stack">
        <div className="spread">
          <h1>{t('dashboard.title')}</h1>
          <Link to="/dashboard/profile" className="btn btn--sm btn--secondary">
            {t('dashboard.editProfile')}
          </Link>
        </div>

        {error ? <div className="alert alert--error">{error}</div> : null}

        {!user?.isMaster ? (
          <div className="card stack">
            <h2>{t('dashboard.becomeMaster')}</h2>
            <p className="muted">{t('dashboard.becomeMasterHint')}</p>
            <Link to="/dashboard/profile" className="btn">
              {t('dashboard.createProfile')}
            </Link>
          </div>
        ) : null}

        {user?.isMaster && status !== 'VERIFIED' ? (
          <div className={status === 'PENDING' ? 'alert alert--info' : 'alert alert--warn'}>
            <div className="stack">
              <span>{t(`verification.${status}`)}</span>
              {status !== 'PENDING' ? (
                <button className="btn btn--sm" onClick={() => setVerifyOpen(true)}>
                  {t('verification.submit')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={styles.statGrid}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats?.completedJobs ?? 0}</span>
            <span className={styles.statLabel}>{t('dashboard.completed')}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats?.totalEarnedPi ?? '0'} π</span>
            <span className={styles.statLabel}>{t('dashboard.earned')}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats?.ratingAvg?.toFixed(1) ?? '0.0'}</span>
            <span className={styles.statLabel}>{t('dashboard.rating', { count: stats?.ratingCount ?? 0 })}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats?.balancePi ?? '0'} π</span>
            <span className={styles.statLabel}>{t('dashboard.balance')}</span>
          </div>
        </div>

        {Number(stats?.inEscrowPi ?? '0') > 0 ? (
          <div className="alert alert--info">
            {t('dashboard.inEscrow', { amount: stats?.inEscrowPi })}
          </div>
        ) : null}

        <AvailabilityToggle />

        <div className={styles.tabs}>
          {(['jobs', 'map', 'responses', 'money'] as Tab[]).map((item) => (
            <button
              key={item}
              className={tab === item ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab(item)}
            >
              {t(`dashboard.tab_${item}`)}
            </button>
          ))}
        </div>

        {tab === 'jobs' ? (
          jobs.length === 0 ? (
            <EmptyState icon="🧰" title={t('dashboard.noJobs')} hint={t('dashboard.noJobsHint')} />
          ) : (
            <div className="stack">
              {jobs.map((order) => (
                <OrderCard key={order.id} order={order} showResponses={false} />
              ))}
            </div>
          )
        ) : null}

        {tab === 'map' ? <TaskMap lock="tasks" height={380} /> : null}

        {tab === 'responses' ? (
          responses.length === 0 ? (
            <EmptyState icon="✉️" title={t('dashboard.noResponses')} hint={t('dashboard.noResponsesHint')} />
          ) : (
            <div className="stack">
              {responses.map((response) => (
                <div key={response.id} className="card stack" style={{ gap: 7 }}>
                  <div className="spread">
                    <Link to={`/orders/${response.order?.id ?? response.orderId}`} style={{ fontWeight: 700 }}>
                      {response.order?.title ?? response.orderId}
                    </Link>
                    <span className="pi-amount">{response.pricePi} π</span>
                  </div>
                  <div className="row">
                    <span className="badge badge--muted">{t(`responseStatus.${response.status}`)}</span>
                    {response.order ? (
                      <span className="badge badge--muted">{t(`orderStatus.${response.order.status}`)}</span>
                    ) : null}
                  </div>
                  {response.status === 'ACTIVE' ? (
                    <button
                      className="btn btn--sm btn--secondary"
                      onClick={() => void withdrawResponse(response.id)}
                      disabled={busy}
                    >
                      {t('dashboard.withdrawResponse')}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'money' ? (
          <div className="stack">
            <div className="card stack">
              <div className="spread">
                <span className="muted">{t('dashboard.wallet')}</span>
                <span>{shortWallet(stats?.walletAddress)}</span>
              </div>
              <div className="spread">
                <span className="muted">{t('dashboard.available')}</span>
                <span className="pi-amount">{stats?.balancePi ?? '0'} π</span>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setWithdrawAmount(stats?.balancePi ?? '');
                  setWithdrawOpen(true);
                }}
                disabled={
                  settings?.payoutsEnabled === false ||
                  !stats?.walletAddress ||
                  Number(stats?.balancePi ?? '0') < Number(settings?.minWithdrawalPi ?? '5')
                }
              >
                {t('dashboard.withdraw')}
              </button>
              {/* The balance is still real and still owed — only the payout
                  channel is off, so the wording must not read as lost money. */}
              <p className="hint">
                {settings?.payoutsEnabled === false
                  ? t('dashboard.payoutsUnavailable')
                  : t('dashboard.withdrawHint', { min: settings?.minWithdrawalPi ?? '5' })}
              </p>
            </div>

            {withdrawals.length > 0 ? (
              <div className="card">
                <h3>{t('dashboard.withdrawals')}</h3>
                {withdrawals.map((withdrawal) => (
                  <div key={withdrawal.id} className={styles.listItem}>
                    <div>
                      <div>{t(`withdrawalStatus.${withdrawal.status}`)}</div>
                      <span className="hint">{formatDate(withdrawal.createdAt, i18n.resolvedLanguage)}</span>
                    </div>
                    <span className={styles.amountNegative}>−{withdrawal.amountPi} π</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="card">
              <h3>{t('dashboard.transactions')}</h3>
              {transactions.length === 0 ? (
                <p className="muted">{t('dashboard.noTransactions')}</p>
              ) : (
                transactions.map((transaction) => (
                  <div key={transaction.id} className={styles.listItem}>
                    <div>
                      <div>{transaction.description}</div>
                      <span className="hint">{formatDate(transaction.createdAt, i18n.resolvedLanguage)}</span>
                    </div>
                    <span
                      className={
                        transaction.amountPi.startsWith('-') ? styles.amountNegative : styles.amountPositive
                      }
                    >
                      {transaction.amountPi} π
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <Modal open={verifyOpen} title={t('verification.title')} onClose={() => setVerifyOpen(false)}>
          <div className="stack">
            <p className="muted">{t('verification.hint')}</p>
            <ImageUploader
              folder="verification"
              value={documents}
              onChange={setDocuments}
              max={4}
              label={t('verification.documents')}
              hint={t('verification.documentsHint')}
            />
            <button className="btn" onClick={() => void submitVerification()} disabled={busy || documents.length < 2}>
              {t('verification.send')}
            </button>
          </div>
        </Modal>

        <Modal open={withdrawOpen} title={t('dashboard.withdraw')} onClose={() => setWithdrawOpen(false)}>
          <div className="stack">
            <label>
              <span className="label">{t('dashboard.amount')}</span>
              <input
                type="number"
                inputMode="decimal"
                min={settings?.minWithdrawalPi ?? '5'}
                step="0.01"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
              />
              <p className="hint">
                {t('dashboard.available')}: {stats?.balancePi ?? '0'} π
              </p>
            </label>
            <div className="alert alert--info">{t('dashboard.withdrawNote')}</div>
            <button
              className="btn"
              onClick={() => void submitWithdrawal()}
              disabled={busy || Number(withdrawAmount) <= 0}
            >
              {t('dashboard.requestWithdrawal')}
            </button>
          </div>
        </Modal>
      </main>
    </PullToRefresh>
  );
}
