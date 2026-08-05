import type { ReactNode } from 'react';
import styles from '../styles/EmptyState.module.css';

export function EmptyState({
  icon = '🗂️',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className={styles.wrap}>
      <div className={styles.icon} aria-hidden="true">
        {icon}
      </div>
      <h3 className={styles.title}>{title}</h3>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {action}
    </div>
  );
}
