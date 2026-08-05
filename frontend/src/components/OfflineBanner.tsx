import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../hooks/usePolling';
import styles from '../styles/OfflineBanner.module.css';

export function OfflineBanner(): JSX.Element | null {
  const online = useOnlineStatus();
  const { t } = useTranslation();

  if (online) return null;

  return (
    <div className={styles.banner} role="alert">
      <span aria-hidden="true">⚠️</span> {t('common.offline')}
    </div>
  );
}
