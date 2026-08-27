import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ordersApi, reviewsApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Order, OrderResponse, Quote } from '../api/types';
import { LeafletMap } from '../components/LeafletMap';
import { ReviewStars } from '../components/ReviewStars';
import { Modal } from '../components/Modal';
import { PaymentProgress } from '../components/PaymentProgress';
import { SkeletonList } from '../components/SkeletonCard';
import { useAuth } from '../hooks/useAuth';
import { usePayment } from '../hooks/usePayment';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { formatDateTime, timeLeft } from '../lib/format';
import styles from '../styles/Pages.module.css';
import detail from '../styles/OrderDetail.module.css';

export default function OrderDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { settings } = usePlatformSettings();
  const payment = usePayment();

  const [order, setOrder] = useState<Order | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [responses, setResponses] = useState<OrderResponse[]>([]);
  const [responseSort, setResponseSort] = useState<'date' | 'price' | 'rating'>('date');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Respond flow (master)
  const [respondOpen, setRespondOpen] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [connectInfo, setConnectInfo] = useState<{ connectPricePi: string; refundPolicyMinutes: number } | null>(
    null,
  );

  // Hire flow (client)
  const [hireTarget, setHireTarget] = useState<OrderResponse | null>(null);
  const [hireQuote, setHireQuote] = useState<Quote | null>(null);

  // Review flow
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [canReview, setCanReview] = useState(false);

  // Dispute
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const isOwner = Boolean(order && user && order.client?.id === user.id);
  const isAssignedMaster = Boolean(order && user && order.master?.id === user.id);

  const loadOrder = useCallback(async () => {
    try {
      const data = await ordersApi.get(id);
      setOrder(data.order);
      setQuote(data.quote);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  const loadResponses = useCallback(async () => {
    try {
      const page = await ordersApi.responses(id, { sort: responseSort, limit: 20 });
      setResponses(page.items);
    } catch {
      // 403 for anyone who is not the client — expected, not an error state.
      setResponses([]);
    }
  }, [id, responseSort]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    if (isOwner || isAssignedMaster) void loadResponses();
  }, [isOwner, isAssignedMaster, loadResponses]);

  useEffect(() => {
    if (!order || order.status !== 'COMPLETED' || !user) return;
    void reviewsApi
      .status(order.id)
      .then((status) => setCanReview(status.canReview))
      .catch(() => setCanReview(false));
  }, [order, user]);

  const autoRelease = useMemo(() => (order ? timeLeft(order.autoReleaseAt, t) : null), [order, t]);

  // ── Master: pay the connect fee and respond ────────────────────────────────

  const openRespond = async () => {
    setActionError(null);
    const price = offerPrice || order?.budgetPi || '';
    try {
      const info = await ordersApi.canRespond(id, String(price || settings?.minBudgetPi || '1'));
      setConnectInfo({ connectPricePi: info.connectPricePi, refundPolicyMinutes: info.refundPolicyMinutes });
      setOfferPrice((current) => current || order?.budgetPi || '');
      setRespondOpen(true);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    }
  };

  const submitResponse = async () => {
    if (!order) return;
    setActionError(null);

    const result = await payment.pay({
      amountPi: connectInfo?.connectPricePi ?? settings?.connectPricePi ?? '0.5',
      memo: `PiFix connect #${order.publicId}`,
      metadata: {
        purpose: 'CONNECT',
        orderId: order.id,
        pricePi: String(offerPrice),
        message: offerMessage.slice(0, 500),
      },
    });

    if (result?.status === 'COMPLETED') {
      setRespondOpen(false);
      payment.reset();
      await refreshUser();
      navigate('/dashboard');
    }
  };

  // ── Client: fund the escrow and hire ───────────────────────────────────────

  const openHire = async (response: OrderResponse) => {
    setActionError(null);
    try {
      const nextQuote = await ordersApi.quote(id, response.id);
      setHireQuote(nextQuote);
      setHireTarget(response);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    }
  };

  const confirmHire = async () => {
    if (!order || !hireTarget || !hireQuote) return;
    setActionError(null);

    const result = await payment.pay({
      amountPi: hireQuote.totalPi,
      memo: `PiFix job #${order.publicId}`,
      metadata: { purpose: 'ESCROW', orderId: order.id, responseId: hireTarget.id },
    });

    if (result?.status === 'COMPLETED') {
      setHireTarget(null);
      payment.reset();
      await Promise.all([loadOrder(), loadResponses(), refreshUser()]);
    }
  };

  // ── Simple state transitions ───────────────────────────────────────────────

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await Promise.all([loadOrder(), refreshUser()]);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    try {
      await reviewsApi.create({ orderId: order.id, rating, text: reviewText.trim() });
      setReviewOpen(false);
      setCanReview(false);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <SkeletonList count={3} />
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="page stack">
        <div className="alert alert--error">{error ?? t('errors.not_found')}</div>
        <Link to="/orders" className="btn btn--secondary">
          {t('common.back')}
        </Link>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className={detail.head}>
        <span className={detail.category}>
          {order.categoryIcon} {order.category ? t(`categories.${order.category}`) : ''}
        </span>
        <span className="badge badge--muted">#{order.publicId}</span>
      </div>

      <h1>{order.title}</h1>

      <div className={detail.badges}>
        <span className="badge">{t(`orderStatus.${order.status}`)}</span>
        {order.isUrgent ? <span className="badge badge--urgent">⚡ {t('order.urgent')}</span> : null}
        <span className="pi-amount">{order.budgetPi} π</span>
      </div>

      <p className={detail.description}>{order.description}</p>

      {order.photos.length > 0 ? (
        <div className={styles.photoStrip}>
          {order.photos.map((photo) => (
            <img key={photo} src={photo} alt="" loading="lazy" />
          ))}
        </div>
      ) : null}

      <div className="card stack">
        <div className="spread">
          <span className="muted">📍 {order.address}</span>
        </div>
        <LeafletMap
          center={{ lat: order.lat, lng: order.lng }}
          markers={[{ id: order.id, lat: order.lat, lng: order.lng, accent: true }]}
          height={200}
          zoom={14}
        />
      </div>

      <div className="card stack">
        <div className="spread">
          <span className="muted">{t('order.client')}</span>
          <span>
            @{order.client?.username}{' '}
            <ReviewStars value={order.client?.ratingAvg ?? 0} size="sm" count={order.client?.ratingCount} showValue />
          </span>
        </div>
        {order.master ? (
          <div className="spread">
            <span className="muted">{t('order.master')}</span>
            <Link to={`/masters/${encodeURIComponent(order.master.username)}`}>@{order.master.username}</Link>
          </div>
        ) : null}
        <div className="spread">
          <span className="muted">{t('order.published')}</span>
          <span>{formatDateTime(order.createdAt, i18n.resolvedLanguage)}</span>
        </div>
        {order.escrowStatus === 'FUNDED' && autoRelease ? (
          <div className="alert alert--warn">{t('order.autoReleaseIn', { time: autoRelease })}</div>
        ) : null}
        {order.status === 'DISPUTED' ? (
          <div className="alert alert--error">
            {t('order.disputed')} — {order.disputeReason}
          </div>
        ) : null}
      </div>

      {quote && order.status === 'OPEN' ? (
        <div className={styles.priceBreakdown}>
          <div className={styles.priceRow}>
            <span>{t('price.budget')}</span>
            <span>{quote.escrowAmountPi} π</span>
          </div>
          <div className={styles.priceRow}>
            <span>{t('price.serviceFee', { percent: settings?.clientFeePercent ?? '' })}</span>
            <span>{quote.clientFeePi} π</span>
          </div>
          {order.isUrgent ? (
            <div className={styles.priceRow}>
              <span>{t('price.express')}</span>
              <span>{quote.expressFeePi} π</span>
            </div>
          ) : null}
          <div className={`${styles.priceRow} ${styles.priceTotal}`}>
            <span>{t('price.total')}</span>
            <span className="pi-amount">{quote.totalPi} π</span>
          </div>
        </div>
      ) : null}

      {actionError ? <div className="alert alert--error">{actionError}</div> : null}

      {/* ── Actions ─────────────────────────────────────────────────────── */}

      {!isOwner && order.status === 'OPEN' && user ? (
        <button className="btn" onClick={() => void openRespond()}>
          {t('order.respond')} · {settings?.connectPricePi ?? ''} π
        </button>
      ) : null}

      {isOwner && order.status === 'OPEN' ? (
        <button className="btn btn--secondary" onClick={() => void runAction(() => ordersApi.cancel(order.id))} disabled={busy}>
          {t('order.cancel')}
        </button>
      ) : null}

      {isAssignedMaster && order.status === 'IN_PROGRESS' ? (
        <button className="btn" onClick={() => void runAction(() => ordersApi.markCompleted(order.id))} disabled={busy}>
          {t('order.markDone')}
        </button>
      ) : null}

      {isOwner && (order.status === 'AWAITING_CONFIRMATION' || order.status === 'IN_PROGRESS') ? (
        <button className="btn" onClick={() => void runAction(() => ordersApi.confirm(order.id))} disabled={busy}>
          {t('order.confirmAndPay')}
        </button>
      ) : null}

      {(isOwner || isAssignedMaster) && order.escrowStatus === 'FUNDED' && order.status !== 'DISPUTED' ? (
        <button className="btn btn--secondary" onClick={() => setDisputeOpen(true)} disabled={busy}>
          {t('order.openDispute')}
        </button>
      ) : null}

      {canReview ? (
        <button className="btn" onClick={() => setReviewOpen(true)}>
          {t('review.leave')}
        </button>
      ) : null}

      {/* ── Responses (client only) ─────────────────────────────────────── */}

      {isOwner ? (
        <>
          <div className={styles.sectionTitle}>
            <h2>{t('order.responsesTitle', { count: responses.length })}</h2>
            <select
              value={responseSort}
              onChange={(event) => setResponseSort(event.target.value as typeof responseSort)}
              style={{ width: 'auto', minHeight: 36, fontSize: 13 }}
            >
              <option value="date">{t('orders.sortDate')}</option>
              <option value="price">{t('orders.sortPrice')}</option>
              <option value="rating">{t('orders.sortRating')}</option>
            </select>
          </div>

          {responses.length === 0 ? (
            <p className="muted">{t('order.noResponses')}</p>
          ) : (
            <div className="stack">
              {responses.map((response) => (
                <div key={response.id} className={detail.response}>
                  <div className="spread">
                    <Link to={`/masters/${encodeURIComponent(response.master?.username ?? '')}`} className={detail.responseName}>
                      {response.masterName ?? response.master?.username}
                      {response.masterVerified ? <span className={detail.verified}>✓</span> : null}
                    </Link>
                    <span className="pi-amount">{response.pricePi} π</span>
                  </div>
                  <ReviewStars
                    value={response.master?.ratingAvg ?? 0}
                    size="sm"
                    showValue
                    count={response.master?.ratingCount}
                  />
                  <p className={detail.responseMessage}>{response.message}</p>
                  <span className="hint">
                    {t('master.jobsDone', { count: response.masterCompletedJobs })}
                  </span>
                  {order.status === 'OPEN' ? (
                    <button className="btn btn--sm" onClick={() => void openHire(response)}>
                      {t('order.hire')}
                    </button>
                  ) : response.status === 'SELECTED' ? (
                    <span className="badge">{t('order.selected')}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      <Modal
        open={respondOpen}
        title={t('order.respondTitle')}
        onClose={() => {
          setRespondOpen(false);
          payment.reset();
        }}
        dismissible={!payment.busy}
      >
        <div className="stack">
          <label>
            <span className="label">{t('order.yourPrice')}</span>
            <input
              type="number"
              inputMode="decimal"
              min={settings?.minBudgetPi ?? '1'}
              step="0.01"
              value={offerPrice}
              onChange={(event) => setOfferPrice(event.target.value)}
            />
          </label>

          <label>
            <span className="label">{t('order.yourMessage')}</span>
            <textarea
              value={offerMessage}
              onChange={(event) => setOfferMessage(event.target.value.slice(0, 500))}
              placeholder={t('order.messagePlaceholder')}
              maxLength={500}
            />
            <p className="hint">{offerMessage.length}/500</p>
          </label>

          <div className="alert alert--warn">
            {t('order.connectWarning', {
              price: connectInfo?.connectPricePi ?? settings?.connectPricePi ?? '',
              minutes: connectInfo?.refundPolicyMinutes ?? settings?.connectRefundWindowMinutes ?? 0,
            })}
          </div>

          <PaymentProgress stage={payment.stage} error={payment.error} errorCode={payment.errorCode} />

          <button
            className="btn"
            onClick={() => void submitResponse()}
            disabled={payment.busy || !offerPrice || Number(offerPrice) <= 0}
          >
            {t('order.payConnect', { price: connectInfo?.connectPricePi ?? settings?.connectPricePi ?? '' })}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(hireTarget)}
        title={t('order.hireTitle')}
        onClose={() => {
          setHireTarget(null);
          payment.reset();
        }}
        dismissible={!payment.busy}
      >
        {hireTarget && hireQuote ? (
          <div className="stack">
            <p>
              {t('order.hiring', { name: hireTarget.masterName ?? hireTarget.master?.username ?? '' })}
            </p>

            <div className={styles.priceBreakdown}>
              <div className={styles.priceRow}>
                <span>{t('price.masterPrice')}</span>
                <span>{hireQuote.escrowAmountPi} π</span>
              </div>
              <div className={styles.priceRow}>
                <span>{t('price.serviceFee', { percent: hireQuote.clientFeePercent ?? '' })}</span>
                <span>{hireQuote.clientFeePi} π</span>
              </div>
              {Number(hireQuote.expressFeePi) > 0 ? (
                <div className={styles.priceRow}>
                  <span>{t('price.express')}</span>
                  <span>{hireQuote.expressFeePi} π</span>
                </div>
              ) : null}
              <div className={`${styles.priceRow} ${styles.priceTotal}`}>
                <span>{t('price.total')}</span>
                <span className="pi-amount">{hireQuote.totalPi} π</span>
              </div>
            </div>

            <div className="alert alert--info">
              {t('order.escrowExplainer', { days: settings?.escrowTimeoutDays ?? 7 })}
            </div>

            <PaymentProgress stage={payment.stage} error={payment.error} errorCode={payment.errorCode} />

            <button className="btn" onClick={() => void confirmHire()} disabled={payment.busy}>
              {t('order.payEscrow', { amount: hireQuote.totalPi })}
            </button>
          </div>
        ) : null}
      </Modal>

      <Modal open={reviewOpen} title={t('review.title')} onClose={() => setReviewOpen(false)}>
        <div className="stack">
          <div className="center">
            <ReviewStars value={rating} onChange={setRating} size="lg" />
          </div>
          <label>
            <span className="label">{t('review.comment')}</span>
            <textarea
              value={reviewText}
              onChange={(event) => setReviewText(event.target.value.slice(0, 500))}
              maxLength={500}
              placeholder={t('review.commentPlaceholder')}
            />
            <p className="hint">{reviewText.length}/500</p>
          </label>
          <button className="btn" onClick={() => void submitReview()} disabled={busy}>
            {t('review.submit')}
          </button>
        </div>
      </Modal>

      <Modal open={disputeOpen} title={t('order.disputeTitle')} onClose={() => setDisputeOpen(false)}>
        <div className="stack">
          <p className="muted">{t('order.disputeHint')}</p>
          <textarea
            value={disputeReason}
            onChange={(event) => setDisputeReason(event.target.value.slice(0, 500))}
            maxLength={500}
            placeholder={t('order.disputePlaceholder')}
          />
          <button
            className="btn btn--danger"
            disabled={busy || disputeReason.trim().length < 10}
            onClick={() =>
              void runAction(async () => {
                await ordersApi.dispute(order.id, disputeReason.trim());
                setDisputeOpen(false);
              })
            }
          >
            {t('order.submitDispute')}
          </button>
        </div>
      </Modal>
    </main>
  );
}
