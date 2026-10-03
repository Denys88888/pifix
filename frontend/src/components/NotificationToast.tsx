import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import styles from '../styles/NotificationToast.module.css';

/** A short banner when something new arrives while the app is open. */
export function NotificationToast(): JSX.Element | null {
  const { t } = useTranslation();
  const { toast, dismissToast } = useNotifications();
  if (!toast) return null;
  return (
    <div className={styles.toast} role="status">
      <Link to="/notifications" onClick={dismissToast} className={styles.link}>
        🔔 {t('notifications.toast')}
      </Link>
      <button className={styles.close} onClick={dismissToast} aria-label={t('common.close')} type="button">
        ×
      </button>
    </div>
  );
}
