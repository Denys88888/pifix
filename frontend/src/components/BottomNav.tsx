import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from '../styles/BottomNav.module.css';

const TABS = [
  { to: '/orders', key: 'nav.orders', icon: '📋' },
  { to: '/masters', key: 'nav.masters', icon: '🛠️' },
  { to: '/profile', key: 'nav.profile', icon: '👤' },
] as const;

export function BottomNav(): JSX.Element {
  const { t } = useTranslation();

  return (
    <nav className={styles.nav} aria-label={t('nav.label')}>
      <div className={styles.inner}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}
          >
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
            </span>
            <span className={styles.label}>{t(tab.key)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
