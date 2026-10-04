import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import styles from '../styles/Header.module.css';

const ROOT_PATHS = ['/', '/orders', '/masters', '/chats', '/profile', '/dashboard'];

export function Header(): JSX.Element {
  const { t } = useTranslation();
  const { user, status, signIn, error } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();

  const showBack = !ROOT_PATHS.includes(location.pathname);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        {showBack ? (
          <button
            className={styles.back}
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
            type="button"
          >
            ‹
          </button>
        ) : null}

        <Link to="/" className={styles.brand}>
          <span className={styles.pi}>π</span>
          <span>PiFix</span>
        </Link>

        <div className={styles.right}>
          {status === 'signed_in' && user ? (
            <Link
              to="/notifications"
              className={styles.bell}
              aria-label={unread > 0 ? t('notifications.unreadAria', { count: unread }) : t('notifications.title')}
            >
              🔔
              {unread > 0 ? <span className={styles.bellCount}>{unread > 99 ? '99+' : unread}</span> : null}
            </Link>
          ) : null}
          <LanguageSwitcher compact />
          {status === 'signed_in' && user ? (
            <Link to="/profile" className={styles.user}>
              <span className={styles.balance}>{user.balancePi} π</span>
              <span className={styles.username}>@{user.username}</span>
            </Link>
          ) : (
            <button
              className={styles.signIn}
              onClick={() => void signIn()}
              disabled={status === 'signing_in'}
              type="button"
            >
              {status === 'signing_in' ? '…' : t('auth.signIn')}
            </button>
          )}
        </div>
      </div>

      {/* The sign-in button lives here and nothing else rendered its failures,
          so a rejected authenticate() used to leave the button silently back at
          rest with no explanation anywhere on screen. */}
      {error && status !== 'signed_in' ? (
        <p className={styles.signInError} role="alert">
          {error}
        </p>
      ) : null}
    </header>
  );
}
