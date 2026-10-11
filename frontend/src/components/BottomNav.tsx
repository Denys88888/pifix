import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import styles from '../styles/BottomNav.module.css';

const TABS = [
  { to: '/orders', key: 'nav.orders', icon: '📋' },
  { to: '/masters', key: 'nav.masters', icon: '🛠️' },
  { to: '/chats', key: 'nav.chats', icon: '💬', signedInOnly: true },
  { to: '/profile', key: 'nav.profile', icon: '👤' },
  // Only rendered for the accounts listed in ADMIN_UIDS, the same way taxi-pro
  // gates its admin tab. Hiding it is presentation, not protection: every
  // /admin route re-checks the identity on the server.
  { to: '/admin', key: 'nav.admin', icon: '⚙️', adminOnly: true },
] as const;

export function BottomNav(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { unread, byOrder, messages } = useNotifications();
  // Orders with something new; whatever is left (a payout) belongs to the profile.
  const orderBadge = Object.keys(byOrder).length;
  const orderUnread = Object.values(byOrder).reduce((sum, n) => sum + n, 0);
  const badgeFor = (to: string): number =>
    to === '/chats' ? messages : to === '/orders' ? orderBadge : to === '/profile' ? unread - orderUnread : 0;

  // Same rule NavLink applied: the tab is active on its page and below it.
  const isActive = (to: string): boolean => pathname === to || pathname.startsWith(`${to}/`);

  const tabs = TABS.filter(
    (tab) =>
      (!('adminOnly' in tab && tab.adminOnly) || user?.isAdmin) && (!('signedInOnly' in tab && tab.signedInOnly) || user),
  );

  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      <div className={styles.inner}>
        {tabs.map((tab) => (
          // Buttons, not links. A link has an address, and iOS offers to open a
          // held or force-pressed link in Safari — outside Pi Browser, where the
          // app cannot work. A button has nothing to open.
          <button
            key={tab.to}
            type="button"
            onClick={() => navigate(tab.to)}
            aria-current={isActive(tab.to) ? 'page' : undefined}
            className={isActive(tab.to) ? `${styles.tab} ${styles.active}` : styles.tab}
          >
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
              {badgeFor(tab.to) > 0 ? <span className={styles.badge}>{badgeFor(tab.to)}</span> : null}
            </span>
            <span className={styles.label}>{t(tab.key)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
