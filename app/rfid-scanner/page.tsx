'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './rfid-scanner.module.css';

type ScanRecord = {
  id: string;
  scannedAt: string;
  uid: string;
  idDec: string;
  reverseDec: string;
  cardType: string;
};

const STORAGE_KEY = 'dallmayr-rfid-scanner-v5';
const BUFFER_TIMEOUT_MS = 1800;

function normalizeReverseDec(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(10, '0').slice(-10);
}

function parseScanLine(line: string): Omit<ScanRecord, 'id' | 'scannedAt'> | null {
  const parts = line.trim().split('|');
  if (parts.length !== 5 || parts[0] !== 'RFID') return null;

  const reverseDec = normalizeReverseDec(parts[3]);
  if (!reverseDec) return null;

  return {
    uid: parts[1].trim(),
    idDec: parts[2].trim(),
    reverseDec,
    cardType: parts[4].trim(),
  };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function RfidScannerPage() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [lastMessage, setLastMessage] = useState('Waiting for RFID reader input…');
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ScanRecord[];
        if (Array.isArray(parsed)) setScans(parsed);
      }
    } catch {
      // Ignore invalid or unavailable browser storage.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
    } catch {
      // Scanning still works when storage is unavailable.
    }
  }, [ready, scans]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const now = Date.now();
      if (now - lastKeyAtRef.current > BUFFER_TIMEOUT_MS) bufferRef.current = '';
      lastKeyAtRef.current = now;

      if (event.key === 'Enter') {
        const line = bufferRef.current;
        bufferRef.current = '';
        const parsed = parseScanLine(line);
        if (!parsed) return;

        event.preventDefault();
        const record: ScanRecord = {
          ...parsed,
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
          scannedAt: new Date().toISOString(),
        };
        setScans((current) => [...current, record]);
        setLastMessage(`Scanned ${record.reverseDec}`);
        return;
      }

      if (event.key === 'Backspace') {
        bufferRef.current = bufferRef.current.slice(0, -1);
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
        if (bufferRef.current.length > 180) bufferRef.current = bufferRef.current.slice(-180);
      }
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const uniqueCards = useMemo(
    () => new Set(scans.map((scan) => scan.reverseDec)).size,
    [scans],
  );

  const latest = scans.length ? scans[scans.length - 1] : null;

  function clearScans() {
    if (!window.confirm('Clear all saved RFID scans from this browser?')) return;
    setScans([]);
    setLastMessage('Scan list cleared. Ready for the next card.');
  }

  function exportCsv() {
    const lines = [
      ['Number', 'Scanned', 'UID', 'ID (dec)', 'Reverse DEC', 'Card type'].map(csvCell).join(','),
      ...scans.map((scan, index) => [
        String(index + 1),
        scan.scannedAt,
        scan.uid,
        scan.idDec,
        `="${scan.reverseDec}"`,
        scan.cardType,
      ].map(csvCell).join(',')),
    ];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`RFID-Scans-${stamp}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
  }

  async function copyReverseDec(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setLastMessage(`Copied ${value}`);
    } catch {
      setLastMessage('Could not copy to the clipboard.');
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Dallmayr RFID Scanner</div>
            <h1>Card scanning</h1>
            <p>No installation required. Keep this page open and scan cards with the USB reader.</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} disabled={!scans.length} onClick={exportCsv} type="button">
              Export for Excel
            </button>
            <button className={styles.dangerButton} disabled={!scans.length} onClick={clearScans} type="button">
              Clear list
            </button>
          </div>
        </header>

        <div className={styles.statusBar} role="status" aria-live="polite">
          <span className={styles.statusDot} />
          <span>{lastMessage}</span>
        </div>

        <section className={styles.stats} aria-label="Scan summary">
          <article className={styles.statCard}>
            <span>Total scans</span>
            <strong>{scans.length}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Unique cards</span>
            <strong>{uniqueCards}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Latest reverse DEC</span>
            <strong className={styles.mono}>{latest?.reverseDec ?? '—'}</strong>
          </article>
        </section>

        <section className={styles.tableCard} aria-label="Scanned RFID cards">
          <div className={styles.tableHeading}>
            <div>
              <h2>Scanned cards</h2>
              <p>Reverse DEC is forced to 10 digits and retained with leading zeroes.</p>
            </div>
            <span className={styles.readyBadge}>{ready ? 'Ready to scan' : 'Starting…'}</span>
          </div>

          {scans.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Scanned</th>
                    <th>UID</th>
                    <th>ID (dec)</th>
                    <th>Reverse DEC</th>
                    <th>Card type</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {[...scans].reverse().map((scan, reverseIndex) => {
                    const originalNumber = scans.length - reverseIndex;
                    return (
                      <tr key={scan.id}>
                        <td>{originalNumber}</td>
                        <td>{new Date(scan.scannedAt).toLocaleString()}</td>
                        <td className={styles.mono}>{scan.uid}</td>
                        <td className={styles.mono}>{scan.idDec}</td>
                        <td className={`${styles.mono} ${styles.reverseDec}`}>{scan.reverseDec}</td>
                        <td>{scan.cardType}</td>
                        <td>
                          <button className={styles.copyButton} onClick={() => copyReverseDec(scan.reverseDec)} type="button">
                            Copy
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>Ready for the first card</strong>
              <span>Present a MIFARE Classic card to the reader.</span>
            </div>
          )}
        </section>

        <p className={styles.footerNote}>
          Scan history is stored only in this browser until you clear it. Export produces a CSV that opens directly in Excel and preserves the 10-digit Reverse DEC field.
        </p>
      </section>
    </main>
  );
}
