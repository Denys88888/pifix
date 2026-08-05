import { useState } from 'react';
import styles from '../styles/ReviewStars.module.css';

interface Props {
  value: number;
  /** Omit to render a read-only rating. */
  onChange?: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  count?: number;
}

export function ReviewStars({ value, onChange, size = 'md', showValue = false, count }: Props): JSX.Element {
  const [hover, setHover] = useState(0);
  const interactive = typeof onChange === 'function';
  const shown = hover || value;

  return (
    <span className={`${styles.wrap} ${styles[size]}`}>
      {[1, 2, 3, 4, 5].map((star) =>
        interactive ? (
          <button
            key={star}
            type="button"
            className={star <= shown ? styles.starOn : styles.starOff}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${star}`}
            aria-pressed={star <= value}
          >
            ★
          </button>
        ) : (
          <span key={star} className={star <= Math.round(shown) ? styles.starOn : styles.starOff}>
            ★
          </span>
        ),
      )}
      {showValue ? (
        <span className={styles.value}>
          {value > 0 ? value.toFixed(1) : '—'}
          {typeof count === 'number' ? <span className={styles.count}> ({count})</span> : null}
        </span>
      ) : null}
    </span>
  );
}
