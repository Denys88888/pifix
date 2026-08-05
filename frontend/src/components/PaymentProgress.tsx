import { useTranslation } from 'react-i18next';
import type { PaymentStage } from '../hooks/usePayment';
import styles from '../styles/PaymentProgress.module.css';

const STEPS: PaymentStage[] = ['creating', 'approving', 'completing', 'confirming'];

/**
 * Payments in Pi Browser take 10–40 s and hop between the app and the Pi
 * wallet UI. Showing exactly which leg is running is what stops people from
 * force-closing the WebView mid-transaction.
 */
export function PaymentProgress({
  stage,
  error,
  errorCode,
}: {
  stage: PaymentStage;
  error?: string | null;
  errorCode?: string | null;
}): JSX.Element | null {
  const { t } = useTranslation();

  if (stage === 'idle') return null;

  if (stage === 'error' || stage === 'cancelled') {
    const key = errorCode ? `errors.${errorCode}` : 'errors.payment_failed';
    const translated = t(key, { defaultValue: '' });
    return (
      <div className="alert alert--error">
        {translated || error || t('errors.payment_failed')}
      </div>
    );
  }

  if (stage === 'done') {
    return <div className="alert alert--info">{t('payment.done')}</div>;
  }

  const currentIndex = STEPS.indexOf(stage);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.head}>
        <span className={styles.spinner} />
        <span className={styles.label}>{t(`payment.${stage}`)}</span>
      </div>
      <div className={styles.steps}>
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={index <= currentIndex ? `${styles.step} ${styles.stepOn}` : styles.step}
          />
        ))}
      </div>
      <p className={styles.hint}>{t('payment.doNotClose')}</p>
    </div>
  );
}
