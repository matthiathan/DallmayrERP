'use client';

import { useState } from 'react';
import { TelemetryTestCenter } from './TelemetryTestCenter';
import styles from './TestCenterWorkspaceOrganizer.module.css';

type TestCenterView = 'console' | 'events' | 'commands' | 'history';

const TEST_CENTER_VIEWS: Array<{ id: TestCenterView; label: string; helper: string }> = [
  { id: 'console', label: 'Console', helper: 'Live serial and protocol stream' },
  { id: 'events', label: 'Important Events', helper: 'Vend, fault and identity highlights' },
  { id: 'commands', label: 'Commands', helper: 'Safe remote diagnostics and status' },
  { id: 'history', label: 'Session History', helper: 'Archived diagnostic sessions' },
];

export function TestCenterWorkspaceOrganizer() {
  const [view, setView] = useState<TestCenterView>('console');

  return (
    <section className={styles.workspace} data-test-center-view={view}>
      <nav aria-label="Test Center sections" className={styles.tabs} role="tablist">
        {TEST_CENTER_VIEWS.map((item) => (
          <button
            aria-selected={view === item.id}
            className={`${styles.tab} ${view === item.id ? styles.active : ''}`}
            key={item.id}
            onClick={() => setView(item.id)}
            role="tab"
            type="button"
          >
            <strong>{item.label}</strong>
            <span>{item.helper}</span>
          </button>
        ))}
      </nav>

      {view === 'events' ? (
        <div className={styles.viewNote} role="note">
          <strong>Important events only</strong>
          <span>Showing vend, fault and machine-identity lines from the captured session.</span>
        </div>
      ) : null}

      <div className={styles.centerHost}>
        <TelemetryTestCenter />
      </div>
    </section>
  );
}
