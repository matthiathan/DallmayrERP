'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './LiveDataStatus.module.css';

type LiveDataStatusProps = {
  refreshIntervalMs: number;
  staleAfterMs?: number;
};

function observedTimestamp(text: string, now: number) {
  const matches = Array.from(text.matchAll(/(?:updated|last refreshed)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/gi));
  const match = matches.at(-1);
  if (!match) return null;
  const date = new Date(now);
  date.setHours(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 0);
  if (date.getTime() - now > 5 * 60_000) date.setDate(date.getDate() - 1);
  return date.getTime();
}

function ageLabel(ageMs: number) {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function LiveDataStatus({ refreshIntervalMs, staleAfterMs = Math.max(refreshIntervalMs * 3, 90_000) }: LiveDataStatusProps) {
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = document.getElementById('main-content') ?? document.body;
    const inspect = () => {
      const text = root.textContent ?? '';
      const timestamp = observedTimestamp(text, Date.now());
      setLastUpdate(timestamp);
      setRefreshing(/refreshing(?:…|\.\.\.)/i.test(text));
    };
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const state = refreshing ? 'refreshing' : lastUpdate === null ? 'waiting' : now - lastUpdate > staleAfterMs ? 'stale' : 'live';
  const label = useMemo(() => {
    if (state === 'refreshing') return 'Refreshing…';
    if (state === 'waiting') return 'Waiting for update';
    const updated = `Updated ${ageLabel(now - (lastUpdate ?? now))}`;
    return state === 'stale' ? `Stale · ${updated}` : `Live · ${updated}`;
  }, [lastUpdate, now, state]);

  return (
    <div className={`${styles.status} ${styles[state]}`} data-live-data-state={state} role="status">
      <i aria-hidden="true" />
      <span>{label}</span>
      <small>Auto-refresh {Math.round(refreshIntervalMs / 1000)}s</small>
    </div>
  );
}
