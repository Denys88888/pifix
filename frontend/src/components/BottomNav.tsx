import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import styles from '../styles/BottomNav.module.css';

const TABS = [
  { to: '/orders', key: 'nav.orders', icon: '📋' },
  { to: '/masters', key: 'nav.masters', icon: '🛠️' },
  { to: '/profile', key: 'nav.profile', icon: '👤' },
  // Only rendered for the accounts listed in ADMIN_UIDS, the same way taxi-pro
  // gates its admin tab. Hiding it is presentation, not protection: every
  // /admin route re-checks the identity on the server.
  { to: '/admin', key: 'nav.admin', icon: '⚙️', adminOnly: true },
] as const;

export function BottomNav(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { unread, byOrder } = useNotifications();
  // Orders with something new; whatever is left (a payout) belongs to the profile.
  const orderBadge = Object.keys(byOrder).length;
  const orderUnread = Object.values(byOrder).reduce((sum, n) => sum + n, 0);
  const badgeFor = (to: string): number => (to === '/orders' ? orderBadge : to === '/profile' ? unread - orderUnread : 0);

  const tabs = TABS.filter((tab) => !('adminOnly' in tab && tab.adminOnly) || user?.isAdmin);

  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      <div className={styles.inner}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}
          >
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
              {badgeFor(tab.to) > 0 ? <span className={styles.badge}>{badgeFor(tab.to)}</span> : null}
            </span>
            <span className={styles.label}>{t(tab.key)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
