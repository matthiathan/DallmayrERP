'use client';

import { useState } from 'react';
import styles from './rfid-scanner.module.css';

export default function RfidScannerPage() {
  const [message, setMessage] = useState('The desktop bridge now handles the RFID reader automatically.');

  function openDesktopReader() {
    setMessage('Opening Dallmayr RFID Reader…');
    window.location.href = 'dallmayr-rfid://open';

    window.setTimeout(() => {
      setMessage('If the reader did not open, install or start the Dallmayr RFID Reader desktop app, then try again.');
    }, 1800);
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Dallmayr RFID Scanner</div>
            <h1>RFID card reader</h1>
            <p>USB scanning is now handled by the Dallmayr RFID Reader desktop bridge. Web Serial is no longer used.</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.primaryButton} onClick={openDesktopReader} type="button">
              Open RFID Reader
            </button>
          </div>
        </header>

        <div className={styles.statusBar} role="status" aria-live="polite">
          <span className={styles.statusDot} />
          <span>{message}</span>
        </div>

        <section className={styles.stats} aria-label="RFID workflow">
          <article className={styles.statCard}>
            <span>Connection</span>
            <strong className={styles.readerState}>Automatic</strong>
          </article>
          <article className={styles.statCard}>
            <span>USB access</span>
            <strong className={styles.readerState}>Desktop bridge</strong>
          </article>
          <article className={styles.statCard}>
            <span>Serial speed</span>
            <strong className={styles.mono}>115200</strong>
          </article>
          <article className={styles.statCard}>
            <span>Operator action</span>
            <strong className={styles.readerState}>Plug in & scan</strong>
          </article>
        </section>

        <section className={styles.cardTools}>
          <article className={styles.toolPanel}>
            <h2>Normal operation</h2>
            <p>After the one-time desktop installation, connect the ESP32 reader by USB. The bridge finds the CP2102 automatically, verifies the Dallmayr firmware with PING, and opens the scanner when the reader is available.</p>
            <div className={styles.memoryValue}>
              <span>Operator workflow</span>
              <strong>Plug in reader → scan card</strong>
            </div>
          </article>

          <article className={styles.toolPanel}>
            <h2>Firmware updates</h2>
            <p>Before uploading new ESP32 firmware in Arduino IDE, enable Firmware update mode in the desktop bridge. That releases the COM port and pauses automatic reader discovery.</p>
            <div className={styles.memoryValue}>
              <span>Programming workflow</span>
              <strong>Firmware update mode → upload → resume reader</strong>
            </div>
          </article>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.tableHeading}>
            <div>
              <h2>Latest RFID system</h2>
              <p>The previous browser-based Connect reader flow has been retired.</p>
            </div>
            <span className={styles.readyBadge}>Desktop Bridge</span>
          </div>
          <div className={styles.emptyState}>
            <strong>No browser serial permissions required</strong>
            <span>The desktop app handles scanning, card memory read/write, scan history and CSV export locally.</span>
            <button className={styles.primaryButton} onClick={openDesktopReader} type="button">Open Dallmayr RFID Reader</button>
          </div>
        </section>

        <p className={styles.footerNote}>
          The RFID page no longer attempts to claim COM ports directly from Microsoft Edge or Chrome.
        </p>
      </section>
    </main>
  );
}
