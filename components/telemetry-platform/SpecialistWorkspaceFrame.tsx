import type { ReactNode } from 'react';
import styles from './SpecialistWorkspaceFrame.module.css';

export function SpecialistWorkspaceFrame({
  title,
  description,
  badge = 'Live telemetry',
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.frame} data-specialist-workspace="televend-v3">
      <header className={styles.header}>
        <div><h1>{title}</h1><p>{description}</p></div>
        <span className={styles.headerBadge}><i />{badge}</span>
      </header>
      <div className={styles.content}>{children}</div>
    </section>
  );
}
