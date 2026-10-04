import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { chatsApi } from '../api/endpoints';
import type { ChatSummary } from '../api/types';
import { formatDateTime } from '../lib/format';
import { SkeletonList } from '../components/SkeletonCard';
import { useNotifications } from '../hooks/useNotifications';
import styles from '../styles/Chats.module.css';

/** Every conversation in one place — one per order with a hired master. */
export default function Chats(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { messages: unreadTotal } = useNotifications();
  const [items, setItems] = useState<ChatSummary[] | null>(null);

  // Re-read whenever the unread total changes, so a new message moves its chat
  // to the top without a manual refresh.
  useEffect(() => {
    void chatsApi
      .list()
      .then(setItems)
      .catch(() => setItems([]));
  }, [unreadTotal]);

  const preview = (chat: ChatSummary): string => {
    if (!chat.last) return t('chat.noMessagesYet');
    if (chat.last.role === 'ADMIN') return `${t('chat.admin')}: ${chat.last.text.startsWith('@resolution:') ? t('dispute.decision') : chat.last.text}`;
    const text = chat.last.text || `📷 ${t('chat.photo')}`;
    return chat.last.mine ? `${t('chat.you')}: ${text}` : text;
  };

  return (
    <main className="page stack">
      <h1 style={{ margin: 0 }}>{t('chat.listTitle')}</h1>

      {items === null ? <SkeletonList count={4} /> : null}
      {items?.length === 0 ? <p className="muted">{t('chat.listEmpty')}</p> : null}

      {items?.map((chat) => (
        <Link key={chat.orderId} to={`/orders/${chat.orderId}/chat`} className={styles.item}>
          <span className={styles.avatar} aria-hidden="true">
            {(chat.with ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className={styles.body}>
            <span className={styles.top}>
              <strong className={styles.name}>@{chat.with ?? '—'}</strong>
              <span className={styles.time}>{formatDateTime(chat.at, i18n.resolvedLanguage)}</span>
            </span>
            <span className={styles.order}>
              {t(chat.withRole === 'master' ? 'chat.roleMaster' : 'chat.roleClient')} · #{chat.publicId} · {chat.title}
            </span>
            <span className={`${styles.preview} ${chat.unread > 0 ? styles.unreadText : ''}`}>{preview(chat)}</span>
          </span>
          {chat.unread > 0 ? <span className={styles.count}>{chat.unread}</span> : null}
        </Link>
      ))}
    </main>
  );
}
