import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ordersApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { ImageUploader } from '../components/ImageUploader';
import { LeafletMap } from '../components/LeafletMap';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/Pages.module.css';

const DESCRIPTION_MAX = 1000;
const TITLE_MAX = 120;

export default function CreateOrder(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories, settings } = usePlatformSettings();
  const { user } = useAuth();
  const geo = useGeolocation();

  const [categorySlug, setCategorySlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [address, setAddress] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minBudget = settings?.minBudgetPi ?? '1';

  const total = useMemo(() => {
    if (!settings || !budget) return null;
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const fee = (amount * Number(settings.clientFeePercent)) / 100;
    const express = isUrgent ? Number(settings.expressFeePi) : 0;
    return {
      budget: amount.toFixed(2),
      fee: fee.toFixed(2),
      express: express.toFixed(2),
      total: (amount + fee + express).toFixed(2),
    };
  }, [budget, isUrgent, settings]);

  const locate = async () => {
    const coords = await geo.request();
    if (coords) setPoint({ lat: coords.lat, lng: coords.lng });
  };

  /**
   * Six separate conditions gate publishing, and a greyed-out button showed
   * none of them — the form simply dead-ended with no way to tell which field
   * was at fault. The map point is the usual culprit: it has no visible input,
   * so someone who filled every field still cannot publish and cannot see why.
   */
  const missing = useMemo(() => {
    const items: string[] = [];
    // `count`, not a plain number: it is what makes i18next pick the right
    // plural form. Russian needs three ("1 символ", "4 символа", "10 символов").
    const chars = (count: number) => t('createOrder.needChars', { count });

    if (!categorySlug) items.push(t('createOrder.category'));
    if (title.trim().length < 4) items.push(`${t('createOrder.jobTitle')} — ${chars(4)}`);
    if (description.trim().length < 10) items.push(`${t('createOrder.description')} — ${chars(10)}`);
    if (!(Number(budget) >= Number(minBudget))) {
      items.push(`${t('createOrder.budget')} — ${t('createOrder.needMin', { min: minBudget })}`);
    }
    if (address.trim().length < 3) items.push(`${t('createOrder.address')} — ${chars(3)}`);
    if (point === null) items.push(t('createOrder.pickPoint'));

    return items;
  }, [categorySlug, title, description, budget, minBudget, address, point, t]);

  const canSubmit = missing.length === 0 && !submitting;

  const submit = async () => {
    if (!point) {
      setError(t('createOrder.pickPoint'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const order = await ordersApi.create({
        categorySlug,
        title: title.trim(),
        description: description.trim(),
        budgetPi: String(budget),
        address: address.trim(),
        lat: point.lat,
        lng: point.lng,
        isUrgent,
        photos,
      });
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(t(`errors.${caught.code}`, { defaultValue: caught.message }));
      } else {
        setError(t('errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page stack">
      <h1>{t('createOrder.title')}</h1>

      {user && !user.kycVerified ? (
        <div className="alert alert--warn">{t('createOrder.kycHint')}</div>
      ) : null}

      <div className="card stack">
        <span className="label">{t('createOrder.category')}</span>
        <div className={styles.categoryGrid}>
          {categories.map((category) => (
            <button
              key={category.slug}
              type="button"
              className={
                categorySlug === category.slug
                  ? `${styles.categoryTile} ${styles.categoryTileActive}`
                  : styles.categoryTile
              }
              onClick={() => setCategorySlug(category.slug)}
            >
              <span className={styles.categoryIcon} aria-hidden="true">
                {category.icon}
              </span>
              {t(`categories.${category.slug}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="card">
        <span className="label">{t('createOrder.jobTitle')}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, TITLE_MAX))}
          placeholder={t('createOrder.jobTitlePlaceholder')}
          maxLength={TITLE_MAX}
        />
        <p className="hint">
          {title.length}/{TITLE_MAX}
        </p>
      </label>

      <label className="card">
        <span className="label">{t('createOrder.description')}</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}
          placeholder={t('createOrder.descriptionPlaceholder')}
          maxLength={DESCRIPTION_MAX}
        />
        <p className="hint">
          {description.length}/{DESCRIPTION_MAX}
        </p>
      </label>

      <label className="card">
        <span className="label">{t('createOrder.budget')}</span>
        <input
          type="number"
          inputMode="decimal"
          min={minBudget}
          step="0.01"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          placeholder={minBudget}
        />
        <p className="hint">{t('createOrder.budgetHint', { min: minBudget })}</p>
      </label>

      <div className="card stack">
        <div className={styles.toggleRow}>
          <div>
            <span className="label" style={{ marginBottom: 2 }}>
              ⚡ {t('createOrder.urgent')}
            </span>
            <span className="hint">
              {t('createOrder.urgentHint', { fee: settings?.expressFeePi ?? '0' })}
            </span>
          </div>
          <button
            type="button"
            className={isUrgent ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            onClick={() => setIsUrgent((current) => !current)}
            role="switch"
            aria-checked={isUrgent}
            aria-label={t('createOrder.urgent')}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
      </div>

      <div className="card stack">
        <label>
          <span className="label">{t('createOrder.address')}</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value.slice(0, 300))}
            placeholder={t('createOrder.addressPlaceholder')}
          />
        </label>

        <button type="button" className="btn btn--secondary" onClick={() => void locate()} disabled={geo.loading}>
          {geo.loading ? t('geo.locating') : t('geo.useMyLocation')}
        </button>

        {geo.errorCode ? <p className="hint">{t(`geo.${geo.errorCode}`)} — {t('geo.manualFallback')}</p> : null}

        <LeafletMap
          center={point ?? geo.coords}
          markers={point ? [{ id: 'picked', lat: point.lat, lng: point.lng, accent: true }] : []}
          onPick={setPoint}
          height={230}
          zoom={15}
        />

        {point ? (
          <p className="hint">
            📍 {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </p>
        ) : (
          <p className="hint">{t('createOrder.pickPoint')}</p>
        )}
      </div>

      <div className="card">
        <ImageUploader
          folder="orders"
          value={photos}
          onChange={setPhotos}
          max={3}
          label={t('createOrder.photos')}
          hint={t('createOrder.photosHint')}
        />
      </div>

      {total ? (
        <div className={styles.priceBreakdown}>
          <div className={styles.priceRow}>
            <span>{t('price.budget')}</span>
            <span>{total.budget} π</span>
          </div>
          <div className={styles.priceRow}>
            <span>{t('price.serviceFee', { percent: settings?.clientFeePercent })}</span>
            <span>{total.fee} π</span>
          </div>
          {isUrgent ? (
            <div className={styles.priceRow}>
              <span>{t('price.express')}</span>
              <span>{total.express} π</span>
            </div>
          ) : null}
          <div className={`${styles.priceRow} ${styles.priceTotal}`}>
            <span>{t('price.youPayLater')}</span>
            <span className="pi-amount">{total.total} π</span>
          </div>
          <p className="hint">{t('createOrder.payLaterHint')}</p>
        </div>
      ) : null}

      {error ? <div className="alert alert--error">{error}</div> : null}

      {missing.length > 0 ? (
        <div className={styles.missing}>
          <span className="label">{t('createOrder.missing')}</span>
          <ul>
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button className="btn" onClick={() => void submit()} disabled={!canSubmit}>
        {submitting ? t('common.loading') : t('createOrder.publish')}
      </button>
    </main>
  );
}
