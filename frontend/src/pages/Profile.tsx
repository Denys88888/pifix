import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, ordersApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Order } from '../api/types';
import { OrderCard } from '../components/OrderCard';
import { SkeletonList } from '../components/SkeletonCard';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ReviewStars } from '../components/ReviewStars';
import { PullToRefresh } from '../components/PullToRefresh';
import { useAuth } from '../hooks/useAuth';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { share } from '../lib/piSdk';
import { formatDate, shortWallet } from '../lib/format';
import styles from '../styles/Pages.module.css';

const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin;

export default function Profile(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, signOut, refreshUser } = useAuth();
  const { settings } = usePlatformSettings();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const referralUrl = user ? `${APP_URL}/?ref=${user.username}` : APP_URL;

  const load = useCallback(async () => {
    try {
      const page = await ordersApi.mine('client', 1, 20);
      setOrders(page.items);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shareReferral = async () => {
    const ok = await share(t('referral.shareTitle'), `${t('referral.shareText')} ${referralUrl}`);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2500);
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.deleteAccount();
      setDeleteOpen(false);
      signOut();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <main className="page">
        <SkeletonList count={2} />
      </main>
    );
  }

  return (
    <PullToRefresh onRefresh={async () => {
      await Promise.all([load(), refreshUser()]);
    }}>
      <main className="page stack">
        <h1>{t('profile.title')}</h1>

        <div className="card stack">
          <div className="spread">
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>@{user.username}</div>
              <ReviewStars value={user.ratingAvg} size="sm" showValue count={user.ratingCount} />
            </div>
            <div className="center">
              <div className="pi-amount" style={{ fontSize: 19 }}>
                {user.balancePi} π
              </div>
              <span className="hint">{t('profile.balance')}</span>
            </div>
          </div>
          <div className="spread">
            <span className="muted">{t('profile.wallet')}</span>
            <span>{shortWallet(user.walletAddress)}</span>
          </div>
          <div className="spread">
            <span className="muted">{t('profile.kyc')}</span>
            <span className={user.kycVerified ? 'badge' : 'badge badge--muted'}>
              {user.kycVerified ? t('profile.kycOk') : t('profile.kycMissing')}
            </span>
          </div>
          <div className="spread">
            <span className="muted">{t('profile.memberSince')}</span>
            <span>{formatDate(user.createdAt, i18n.resolvedLanguage)}</span>
          </div>
        </div>

        <div className="card stack">
          <h2>{t('referral.title')}</h2>
          <p className="muted">
            {t('referral.description', {
              direct: settings?.referralBonusDirectPi ?? '0',
              indirect: settings?.referralBonusIndirectPi ?? '0',
            })}
          </p>
          <div
            style={{
              background: 'var(--bg)',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              padding: 10,
              fontSize: 13,
              wordBreak: 'break-all',
              color: 'var(--accent)',
            }}
          >
            {referralUrl}
          </div>
          <button className="btn btn--secondary" onClick={() => void shareReferral()}>
            {copied ? t('referral.copied') : t('referral.share')}
          </button>
        </div>

        <div className="card stack">
          <h2>{t('profile.settings')}</h2>
          <div>
            <span className="label">{t('common.language')}</span>
            <LanguageSwitcher />
          </div>
          <Link to="/dashboard" className="btn btn--secondary">
            {t('profile.masterDashboard')}
          </Link>
          <Link to="/privacy" className="btn btn--secondary">
            {t('common.privacy')}
          </Link>
        </div>

        {/* Hidden until an operator fills it in: pointing people at an address
            nobody reads is worse than showing nothing. */}
        {settings?.supportContact ? (
          <div className="card stack">
            <h2>{t('support.title')}</h2>
            <p className="muted" style={{ margin: 0 }}>{t('support.body')}</p>
            <p style={{ margin: 0, fontWeight: 600, wordBreak: 'break-all' }}>
              {settings.supportContact}
            </p>
          </div>
        ) : null}

        <div className={styles.sectionTitle}>
          <h2>{t('profile.myOrders')}</h2>
          <Link to="/orders/new" className={styles.link}>
            + {t('orders.new')}
          </Link>
        </div>

        {loading ? (
          <SkeletonList count={2} />
        ) : orders.length === 0 ? (
          <EmptyState icon="📋" title={t('profile.noOrders')} hint={t('profile.noOrdersHint')} />
        ) : (
          <div className="stack">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}

        {error ? <div className="alert alert--error">{error}</div> : null}

        <div className="card stack">
          <h2>{t('profile.dangerZone')}</h2>
          <button className="btn btn--secondary" onClick={signOut}>
            {t('profile.signOut')}
          </button>
          <button className="btn btn--danger" onClick={() => setDeleteOpen(true)}>
            {t('profile.deleteAccount')}
          </button>
        </div>

        <Modal open={deleteOpen} title={t('profile.deleteAccount')} onClose={() => setDeleteOpen(false)}>
          <div className="stack">
            <p>{t('profile.deleteWarning')}</p>
            <p className="muted">{t('profile.deleteExplain')}</p>
            <button className="btn btn--danger" onClick={() => void deleteAccount()} disabled={busy}>
              {busy ? t('common.loading') : t('profile.deleteConfirm')}
            </button>
            <button className="btn btn--secondary" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </Modal>
      </main>
    </PullToRefresh>
  );
}
