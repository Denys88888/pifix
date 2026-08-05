import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Order } from '../api/types';
import { formatRelative } from '../lib/format';
import styles from '../styles/OrderCard.module.css';

interface Props {
  order: Order;
  /** Hides the "N responses" line for masters browsing the board. */
  showResponses?: boolean;
}

const STATUS_TONE: Record<Order['status'], string> = {
  OPEN: 'open',
  IN_PROGRESS: 'progress',
  AWAITING_CONFIRMATION: 'progress',
  COMPLETED: 'done',
  CANCELLED: 'muted',
  DISPUTED: 'danger',
};

export function OrderCard({ order, showResponses = true }: Props): JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <Link to={`/orders/${order.id}`} className={styles.card}>
      <div className={styles.top}>
        <span className={styles.category}>
          <span aria-hidden="true">{order.categoryIcon ?? '🛠️'}</span>
          {order.category ? t(`categories.${order.category}`) : ''}
        </span>
        <span className={`${styles.status} ${styles[STATUS_TONE[order.status]]}`}>
          {t(`orderStatus.${order.status}`)}
        </span>
      </div>

      <h3 className={styles.title}>{order.title}</h3>
      <p className={styles.description}>{order.description}</p>

      <div className={styles.meta}>
        <span className="pi-amount">{order.budgetPi} π</span>
        {order.isUrgent ? <span className="badge badge--urgent">⚡ {t('order.urgent')}</span> : null}
        {typeof order.distanceKm === 'number' && Number.isFinite(order.distanceKm) ? (
          <span className="badge badge--muted">{order.distanceKm} {t('common.km')}</span>
        ) : null}
      </div>

      <div className={styles.bottom}>
        <span className={styles.address} title={order.address}>
          📍 {order.address}
        </span>
        <span className={styles.time}>{formatRelative(order.createdAt, i18n.resolvedLanguage, t)}</span>
      </div>

      {showResponses && typeof order.responseCount === 'number' ? (
        <div className={styles.responses}>
          {t('order.responsesCount', { count: order.responseCount })}
        </div>
      ) : null}
    </Link>
  );
}
