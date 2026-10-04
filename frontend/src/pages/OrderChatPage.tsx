import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ordersApi } from '../api/endpoints';
import type { Order } from '../api/types';
import { ApiError } from '../api/client';
import { OrderChat } from '../components/OrderChat';
import { SkeletonList } from '../components/SkeletonCard';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import chatStyles from '../styles/OrderChat.module.css';

/**
 * The chat of one order on a page of its own, messenger-style: the thread
 * fills the screen and the composer stays at the bottom. Reached from the
 * Chats tab, from the button at the top of the order and from notifications.
 */
export default function OrderChatPage(): JSX.Element {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { byOrder, markOrderRead } = useNotifications();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ordersApi
      .get(id)
      .then((data) => setOrder(data.order))
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic')),
      );
  }, [id, t]);

  // Looking at the chat is reading it — also when a message lands while open.
  const fresh = byOrder[id] ?? 0;
  useEffect(() => {
    if (fresh > 0) void markOrderRead(id);
  }, [id, fresh, markOrderRead]);

  if (error) {
    return (
      <main className="page stack">
        <div className="alert alert--error">{error}</div>
      </main>
    );
  }
  if (!order) {
    return (
      <main className="page">
        <SkeletonList count={3} />
      </main>
    );
  }

  const iAmClient = order.client?.id === user?.id;
  const other = iAmClient ? order.master : order.client;

  return (
    <main className={chatStyles.chatPage}>
      <Link to={`/orders/${order.id}`} className="card" style={{ padding: '10px 14px', flex: 'none' }}>
        <div className="spread">
          <strong>
            {iAmClient ? t('chat.withMaster') : t('chat.withClient')} @{other?.username ?? '—'}
          </strong>
          <span className="hint">#{order.publicId}</span>
        </div>
        <div className="hint" style={{ overflowWrap: 'anywhere' }}>
          {order.title} · {t(`orderStatus.${order.status}`)}
        </div>
      </Link>
      <OrderChat
        fullScreen
        load={(after) => ordersApi.messages(order.id, after)}
        send={(text, photos) => ordersApi.sendMessage(order.id, text, photos)}
      />
    </main>
  );
}
