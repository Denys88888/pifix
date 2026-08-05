import styles from '../styles/Skeleton.module.css';

/** Placeholder used while a list loads — never an empty white screen. */
export function SkeletonCard(): JSX.Element {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.row}>
        <div className={`${styles.shimmer} ${styles.avatar}`} />
        <div className={styles.grow}>
          <div className={`${styles.shimmer} ${styles.line}`} style={{ width: '68%' }} />
          <div className={`${styles.shimmer} ${styles.lineSm}`} style={{ width: '42%' }} />
        </div>
      </div>
      <div className={`${styles.shimmer} ${styles.line}`} style={{ width: '92%' }} />
      <div className={`${styles.shimmer} ${styles.lineSm}`} style={{ width: '55%' }} />
    </div>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }): JSX.Element {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
