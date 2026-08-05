import styles from '../styles/BootScreen.module.css';

/** Shown while the SDK boots or a lazy route downloads. Never a white screen. */
export function BootScreen({ inline = false }: { inline?: boolean }): JSX.Element {
  return (
    <div className={inline ? styles.inline : styles.full} role="status" aria-live="polite">
      <div className={styles.logo}>
        <span className={styles.pi}>π</span>
        <span className={styles.name}>PiFix</span>
      </div>
      <div className={styles.spinner} />
    </div>
  );
}
