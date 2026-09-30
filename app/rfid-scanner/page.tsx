'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import styles from './rfid-scanner.module.css';

type ScanRecord = {
  id: string;
  scannedAt: string;
  uid: string;
  idDec: string;
  reverseDec: string;
  cardType: string;
};

type ReaderEvent = {
  type?: string;
  uid?: string;
  idDec?: string;
  idReverseDec?: string;
  cardType?: string;
  data?: string;
  blockHex?: string;
  message?: string;
  success?: boolean;
  device?: string;
  version?: string;
};

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

type SerialLike = {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

const STORAGE_KEY = 'dallmayr-rfid-scanner-v6';
const BAUD_RATE = 115200;

function getSerial(): SerialLike | null {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as Navigator & { serial?: SerialLike }).serial ?? null);
}

function makeRecord(event: ReaderEvent): ScanRecord | null {
  if (event.type !== 'scan') return null;
  if (!event.idDec || !event.idReverseDec) return null;

  // IDs intentionally stay strings. Never convert them to Number(), otherwise
  // a leading zero in reverse DEC would be lost.
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    scannedAt: new Date().toISOString(),
    uid: String(event.uid ?? ''),
    idDec: String(event.idDec),
    reverseDec: String(event.idReverseDec),
    cardType: String(event.cardType ?? ''),
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
  const [storageReady, setStorageReady] = useState(false);
  const [serialSupported, setSerialSupported] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState('Connect the RFID reader to begin.');
  const [storedData, setStoredData] = useState('');
  const [blockHex, setBlockHex] = useState('');
  const [writeData, setWriteData] = useState('');

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readLoopRef = useRef<Promise<void> | null>(null);
  const lineBufferRef = useRef('');
  const disconnectingRef = useRef(false);

  useEffect(() => {
    try {
      const stored = safeLocalStorageGet(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ScanRecord[];
        if (Array.isArray(parsed)) setScans(parsed);
      }
    } catch {
      // Ignore invalid saved scan data.
    }
    setStorageReady(true);
    setSerialSupported(Boolean(getSerial()));
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    safeLocalStorageSet(STORAGE_KEY, JSON.stringify(scans));
  }, [storageReady, scans]);

  const handleReaderEvent = useCallback((event: ReaderEvent) => {
    const record = makeRecord(event);
    if (record) {
      setScans((current) => [...current, record]);
      setLastMessage(`Scanned ${record.reverseDec}`);
      return;
    }

    if (event.type === 'ready') {
      const suffix = event.version ? ` v${event.version}` : '';
      setLastMessage(`${event.device || 'RFID reader'}${suffix} is ready.`);
      return;
    }

    if (event.type === 'read_result') {
      if (event.success === false) {
        setLastMessage(event.message || 'Card read failed.');
      } else {
        setStoredData(String(event.data ?? ''));
        setBlockHex(String(event.blockHex ?? ''));
        setLastMessage(event.message || 'Card memory read successfully.');
      }
      return;
    }

    if (event.type === 'write_result') {
      if (event.success === false) {
        setLastMessage(event.message || 'Card write failed.');
      } else {
        setStoredData(String(event.data ?? ''));
        setBlockHex(String(event.blockHex ?? ''));
        setLastMessage(event.message || 'Card write completed and verified.');
      }
      return;
    }

    if (event.message) setLastMessage(String(event.message));
  }, []);

  const startReadLoop = useCallback((port: SerialPortLike) => {
    if (!port.readable) return;

    const reader = port.readable.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();

    const loop = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;

          lineBufferRef.current += decoder.decode(value, { stream: true });
          const lines = lineBufferRef.current.split(/\r?\n/);
          lineBufferRef.current = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              handleReaderEvent(JSON.parse(line) as ReaderEvent);
            } catch {
              // Ignore non-JSON boot noise so one malformed line cannot stop scanning.
            }
          }
        }
      } catch (error) {
        if (!disconnectingRef.current) {
          setLastMessage(error instanceof Error ? `Reader connection lost: ${error.message}` : 'Reader connection lost.');
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Reader may already be released.
        }
        if (readerRef.current === reader) readerRef.current = null;
        if (!disconnectingRef.current) {
          setConnected(false);
          portRef.current = null;
        }
      }
    })();

    readLoopRef.current = loop;
  }, [handleReaderEvent]);

  const openPort = useCallback(async (port: SerialPortLike) => {
    if (connected || connecting) return;
    setConnecting(true);
    setLastMessage('Connecting to RFID reader…');

    try {
      await port.open({ baudRate: BAUD_RATE });
      portRef.current = port;
      lineBufferRef.current = '';
      disconnectingRef.current = false;
      setConnected(true);
      setLastMessage('RFID reader connected. Present a card.');
      startReadLoop(port);
    } catch (error) {
      portRef.current = null;
      setConnected(false);
      setLastMessage(error instanceof Error ? `Could not connect: ${error.message}` : 'Could not connect to the RFID reader.');
    } finally {
      setConnecting(false);
    }
  }, [connected, connecting, startReadLoop]);

  const disconnect = useCallback(async () => {
    const port = portRef.current;
    if (!port) return;

    disconnectingRef.current = true;
    setLastMessage('Disconnecting RFID reader…');

    try {
      await readerRef.current?.cancel();
    } catch {
      // Safe to continue closing the serial port.
    }

    try {
      await readLoopRef.current;
    } catch {
      // Read loop reports its own errors.
    }

    try {
      await port.close();
    } catch {
      // Port may already have been removed from USB.
    }

    readerRef.current = null;
    readLoopRef.current = null;
    portRef.current = null;
    disconnectingRef.current = false;
    setConnected(false);
    setLastMessage('RFID reader disconnected.');
  }, []);

  useEffect(() => {
    const serial = getSerial();
    if (!serial) return;

    let cancelled = false;
    void serial.getPorts().then((ports) => {
      if (!cancelled && ports.length === 1) void openPort(ports[0]);
    }).catch(() => undefined);

    const onDisconnect = () => {
      if (!disconnectingRef.current) {
        setConnected(false);
        portRef.current = null;
        setLastMessage('RFID reader unplugged. Reconnect it and press Connect reader if needed.');
      }
    };

    serial.addEventListener?.('disconnect', onDisconnect as EventListener);
    return () => {
      cancelled = true;
      serial.removeEventListener?.('disconnect', onDisconnect as EventListener);
    };
  }, [openPort]);

  useEffect(() => () => {
    if (readerRef.current) void readerRef.current.cancel().catch(() => undefined);
  }, []);

  async function requestReader() {
    const serial = getSerial();
    if (!serial) {
      setSerialSupported(false);
      setLastMessage('Web Serial is not available. Open this page in Microsoft Edge or Google Chrome on Windows.');
      return;
    }

    try {
      const port = await serial.requestPort();
      await openPort(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.toLowerCase().includes('cancel')) setLastMessage('No RFID reader was selected.');
    }
  }

  async function sendCommand(command: string) {
    const port = portRef.current;
    if (!port?.writable) {
      setLastMessage('Connect the RFID reader first.');
      return false;
    }

    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${command}\n`));
      return true;
    } catch (error) {
      setLastMessage(error instanceof Error ? `Could not send command: ${error.message}` : 'Could not send command to reader.');
      return false;
    } finally {
      writer.releaseLock();
    }
  }

  async function readCardMemory() {
    if (await sendCommand('READ')) setLastMessage('Read requested. Present the MIFARE Classic card to the reader.');
  }

  async function writeCardMemory() {
    const text = writeData.trim();
    if (!text) {
      setLastMessage('Enter data before pressing Write card.');
      return;
    }
    if (text.length > 16) {
      setLastMessage('Card data is limited to 16 characters.');
      return;
    }
    if (!/^[\x20-\x7E]+$/.test(text) || text.includes('|')) {
      setLastMessage('Use up to 16 printable characters and do not include the | character.');
      return;
    }
    if (await sendCommand(`WRITE|${text}`)) setLastMessage('Write requested. Present the MIFARE Classic card to the reader.');
  }

  async function cancelCardAction() {
    if (await sendCommand('CANCEL')) setLastMessage('Pending card operation cancelled.');
  }

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
      ['Number', 'Scanned', 'UID', 'ID (dec)', 'ID (reverse dec)', 'Card type'].map(csvCell).join(','),
      ...scans.map((scan, index) => [
        String(index + 1),
        scan.scannedAt,
        scan.uid,
        scan.idDec,
        scan.reverseDec,
        scan.cardType,
      ].map(csvCell).join(',')),
    ];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`RFID-Scans-${stamp}.csv`, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
  }

  async function copyValue(value: string) {
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
            <h1>USB card reader</h1>
            <p>The ESP32 connects directly over USB. No Wi-Fi hotspot is required.</p>
          </div>
          <div className={styles.actions}>
            {connected ? (
              <button className={styles.secondaryButton} onClick={() => void disconnect()} type="button">Disconnect reader</button>
            ) : (
              <button className={styles.primaryButton} disabled={connecting || !serialSupported} onClick={() => void requestReader()} type="button">
                {connecting ? 'Connecting…' : 'Connect reader'}
              </button>
            )}
            <button className={styles.secondaryButton} disabled={!scans.length} onClick={exportCsv} type="button">Download CSV</button>
            <button className={styles.dangerButton} disabled={!scans.length} onClick={clearScans} type="button">Clear list</button>
          </div>
        </header>

        {!serialSupported && (
          <div className={styles.warningBox}>
            Web Serial is not available in this browser. Use the desktop version of Microsoft Edge or Google Chrome.
          </div>
        )}

        <div className={styles.statusBar} role="status" aria-live="polite">
          <span className={connected ? styles.statusDot : styles.statusDotOffline} />
          <span>{lastMessage}</span>
        </div>

        <section className={styles.stats} aria-label="Scan summary">
          <article className={styles.statCard}><span>Reader</span><strong className={styles.readerState}>{connected ? 'Connected' : 'Offline'}</strong></article>
          <article className={styles.statCard}><span>Total scans</span><strong>{scans.length}</strong></article>
          <article className={styles.statCard}><span>Unique cards</span><strong>{uniqueCards}</strong></article>
          <article className={styles.statCard}><span>Latest ID (reverse dec)</span><strong className={styles.mono}>{latest?.reverseDec ?? '—'}</strong></article>
        </section>

        <section className={styles.cardTools}>
          <div className={styles.toolPanel}>
            <div>
              <h2>Read card memory</h2>
              <p>Reads MIFARE Classic block 4 without changing the card.</p>
            </div>
            <button className={styles.secondaryButton} disabled={!connected} onClick={() => void readCardMemory()} type="button">Read card</button>
            <div className={styles.memoryValue}><span>Stored text</span><strong className={styles.mono}>{storedData || '—'}</strong></div>
            <div className={styles.memoryValue}><span>Block 4 hex</span><strong className={styles.mono}>{blockHex || '—'}</strong></div>
          </div>

          <div className={styles.toolPanel}>
            <div>
              <h2>Write card memory</h2>
              <p>Writes and verifies up to 16 printable characters in MIFARE Classic block 4.</p>
            </div>
            <input
              className={styles.textInput}
              disabled={!connected}
              maxLength={16}
              onChange={(event) => setWriteData(event.target.value)}
              placeholder="e.g. EMP001234567"
              value={writeData}
            />
            <div className={styles.toolActions}>
              <button className={styles.primaryButton} disabled={!connected || !writeData.trim()} onClick={() => void writeCardMemory()} type="button">Write card</button>
              <button className={styles.secondaryButton} disabled={!connected} onClick={() => void cancelCardAction()} type="button">Cancel</button>
            </div>
          </div>
        </section>

        <section className={styles.tableCard} aria-label="Scanned RFID cards">
          <div className={styles.tableHeading}>
            <div>
              <h2>Scanned cards</h2>
              <p>ID fields are kept as text from the ESP32 to the browser, so leading zeroes are retained.</p>
            </div>
            <span className={connected ? styles.readyBadge : styles.offlineBadge}>{connected ? 'Ready to scan' : 'Reader offline'}</span>
          </div>

          {scans.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>#</th><th>Scanned</th><th>UID</th><th>ID (dec)</th><th>ID (reverse dec)</th><th>Card type</th><th aria-label="Actions" /></tr></thead>
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
                        <td><button className={styles.copyButton} onClick={() => void copyValue(scan.reverseDec)} type="button">Copy</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>{connected ? 'Ready for the first card' : 'Connect the RFID reader'}</strong>
              <span>{connected ? 'Present a card to the MFRC522 reader.' : 'Press Connect reader and choose the CP2102 serial port.'}</span>
            </div>
          )}
        </section>

        <p className={styles.footerNote}>
          On the first visit, Edge asks permission to use the CP2102 serial port. After permission has been granted, this page attempts to reconnect automatically on later visits. Scan history remains in this browser until you clear it.
        </p>
      </section>
    </main>
  );
}
