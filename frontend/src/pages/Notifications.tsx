import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notificationsApi } from '../api/endpoints';
import type { AppNotification } from '../api/types';
import { useNotifications } from '../hooks/useNotifications';
import { formatDateTime } from '../lib/format';
import { SkeletonList } from '../components/SkeletonCard';
import styles from '../styles/Notifications.module.css';

const ICONS: Record<string, string> = {
  response_new: '🙋',
  hired: '🤝',
  message: '💬',
  dispute_opened: '⚠️',
  dispute_resolved: '⚖️',
  job_done: '✅',
  job_confirmed: '💰',
  auto_released: '⏰',
  payout_sent: '💸',
  order_cancelled: '🚫',
};

/** Everything that happened on the pioneer's orders, newest first. */
export default function Notifications(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { markAllRead, unread } = useNotifications();
  const [items, setItems] = useState<AppNotification[] | null>(null);

  useEffect(() => {
    void notificationsApi
      .list()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const text = (item: AppNotification): string => {
    const data = { ...item.data, count: item.count, publicId: item.order?.publicId ?? item.data.publicId ?? '' };
    if (item.type === 'message') {
      const key = item.data.from === 'admin' ? 'notifications.type.message_admin' : 'notifications.type.message';
      return t(key, data);
    }
    if (item.type === 'dispute_resolved') {
      return t('notifications.type.dispute_resolved', {
        ...data,
        decision: t(`dispute.resolution.${item.data.action ?? ''}`, { defaultValue: '' }),
      });
    }
    return t(`notifications.type.${item.type}`, { ...data, defaultValue: item.type });
  };

  return (
    <main className="page stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>{t('notifications.title')}</h1>
        {unread > 0 ? (
          <button
            className="btn btn--sm btn--secondary"
            onClick={() => {
              void markAllRead();
              setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? current);
            }}
          >
            {t('notifications.readAll')}
          </button>
        ) : null}
      </div>

      {items === null ? <SkeletonList count={4} /> : null}
      {items?.length === 0 ? <p className="muted">{t('notifications.empty')}</p> : null}

      {items?.map((item) => {
        const body = (
          <div className={`${styles.item} ${item.read ? '' : styles.unread}`}>
            <span className={styles.icon} aria-hidden="true">
              {ICONS[item.type] ?? '🔔'}
            </span>
            <span className={styles.body}>
              <span className={styles.text}>{text(item)}</span>
              <span className={styles.meta}>
                {item.order ? `#${item.order.publicId} · ${item.order.title} · ` : ''}
                {formatDateTime(item.at, i18n.resolvedLanguage)}
              </span>
            </span>
            {item.read ? null : <span className={styles.dot} aria-label={t('notifications.new')} />}
          </div>
        );
        return item.order ? (
          <Link key={item.id} to={item.type === 'message' ? `/orders/${item.order.id}/chat` : `/orders/${item.order.id}`}>
            {body}
          </Link>
        ) : (
          <Link key={item.id} to="/profile">
            {body}
          </Link>
        );
      })}
    </main>
  );
}
