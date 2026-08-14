'use client';

import styles from './ApplicationFailureScreen.module.css';

type FailureTone = 'warning' | 'danger';

type ApplicationFailureScreenProps = {
  eyebrow: string;
  title: string;
  description: string;
  reference: string;
  onRetry?: () => void;
  announceAsAlert?: boolean;
  tone?: FailureTone;
};

export function ApplicationFailureScreen({
  eyebrow,
  title,
  description,
  reference,
  onRetry,
  announceAsAlert = false,
  tone = 'danger',
}: ApplicationFailureScreenProps) {
  function handleRetry() {
    if (onRetry) {
      onRetry();
      return;
    }

    window.location.reload();
  }

  return (
    <main className={styles.viewport} aria-labelledby="application-failure-title">
      <section className={styles.card}>
        <div className={styles.topline} aria-hidden="true" />
        <div className={styles.content}>
          <div className={styles.brand} aria-label="Dallmayr ERP">
            <span>Dallmayr</span>
            <strong>ERP</strong>
          </div>

          <div
            className={styles.message}
            aria-live={announceAsAlert ? 'assertive' : 'polite'}
            role={announceAsAlert ? 'alert' : 'status'}
          >
            <div
              className={`${styles.icon} ${tone === 'danger' ? styles.iconDanger : styles.iconWarning}`}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 3.25 21 19H3L12 3.25Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 8.25v5.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                <circle cx="12" cy="16.75" r="1" fill="currentColor" />
              </svg>
            </div>

            <div>
              <span className={styles.eyebrow}>{eyebrow}</span>
              <h1 id="application-failure-title">{title}</h1>
              <p className={styles.description}>{description}</p>
            </div>
          </div>

          <div className={styles.actions} aria-label="Recovery actions">
            <button className={`${styles.action} ${styles.primaryAction}`} type="button" onClick={handleRetry}>
              Retry
            </button>
            <a className={`${styles.action} ${styles.secondaryAction}`} href="/">
              Return to Dashboard
            </a>
          </div>

          <div className={styles.support}>
            <div>
              <span>Support reference</span>
              <code>{reference}</code>
            </div>
            <p>If the problem continues, provide this reference to ERP support.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
