import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { adminTokenUsableFor, getAdminToken, setAdminToken } from '../../api/client';
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
   *
   * A Pi admin reuses the stored token while it is still good for a few more
   * minutes and only mints a new one otherwise. Minting on every single mount
   * spent the server's per-user allowance on openings that already had a
   * working token, and once it ran out the panel dropped to the password page.
   */
  useEffect(() => {
    if (status === 'booting' || status === 'signing_in') return;

    const piAdmin = status === 'signed_in' && user?.isAdmin === true;

    if (piAdmin && adminTokenUsableFor(5 * 60)) {
      setChecking(false);
      return;
    }

    if (!piAdmin) {
      // No Pi session to trade: the stored token is all there is.
      if (getAdminToken()) {
        setChecking(false);
      } else {
        navigate('/admin/login', { replace: true });
      }
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
        // The Pi door did not open — drop whatever stale token was there so the
        // password page is not shadowed by a session that cannot work.
        if (!cancelled) {
          setAdminToken(null);
          navigate('/admin/login', { replace: true });
        }
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
    // A Pi admin sent to the login page would be let straight back in by their
    // own Pi session, so "sign out" takes them back to the app instead.
    navigate(status === 'signed_in' && user?.isAdmin ? '/' : '/admin/login', { replace: true });
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
