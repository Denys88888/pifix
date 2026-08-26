import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getAdminToken, setAdminToken } from '../../api/client';
import { adminApiClient } from '../../api/endpoints';
import { useAuth } from '../../hooks/useAuth';
import styles from '../../styles/Admin.module.css';

const LINKS = [
  { to: '/admin', labelKey: 'admin.nav.dashboard', end: true },
  { to: '/admin/orders', labelKey: 'admin.nav.orders' },
  { to: '/admin/verifications', labelKey: 'admin.nav.verifications' },
  { to: '/admin/withdrawals', labelKey: 'admin.nav.withdrawals' },
  { to: '/admin/reviews', labelKey: 'admin.nav.reviews' },
  { to: '/admin/settings', labelKey: 'admin.nav.settings' },
];

export default function AdminLayout(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const [checking, setChecking] = useState(!getAdminToken());

  /**
   * Opened from the developer's own phone there is nothing to type: the Pi
   * session already proves who they are, so it is traded for an admin token
   * before falling back to the password page. On a desktop, where there is no
   * Pi session, this does nothing and the password page appears as before.
   */
  useEffect(() => {
    if (getAdminToken()) {
      setChecking(false);
      return;
    }
    if (status === 'booting' || status === 'signing_in') return;

    if (status !== 'signed_in' || !user?.isAdmin) {
      navigate('/admin/login', { replace: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await adminApiClient.loginWithPi();
        if (cancelled) return;
        setAdminToken(result.token);
        setChecking(false);
      } catch {
        if (!cancelled) navigate('/admin/login', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, status, user?.isAdmin]);

  if (checking) {
    return <div className={styles.shell} />;
  }

  const signOut = () => {
    setAdminToken(null);
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          Pi<span>Fix</span> admin
        </span>
        <nav className={styles.nav}>
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
              }
            >
              {t(link.labelKey)}
            </NavLink>
          ))}
          <button className={`${styles.navLink} ${styles.smallBtnGhost}`} onClick={signOut}>{t('admin.signOut')}</button>
        </nav>
      </header>

      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
