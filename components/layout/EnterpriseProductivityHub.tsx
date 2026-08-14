'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { canAccessPath } from '@/lib/auth/permissions';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  enterpriseShortcutsForRole,
  mergeRecentHistory,
  shortcutHrefForEvent,
  type NotificationPreferences,
  type RecentHistoryItem,
} from '@/lib/productivity/enterpriseFinish';
import type { BusinessRole } from '@/types/dallmayrerp';

const RECENT_HISTORY_KEY = 'dallmayrerp-recent-history-v1';
const NOTIFICATION_PREFERENCES_KEY = 'dallmayrerp-notification-preferences-v1';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function readRecentHistory() {
  const raw = safeLocalStorageGet(RECENT_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentHistoryItem => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as RecentHistoryItem).href === 'string'
      && typeof (item as RecentHistoryItem).label === 'string'
      && typeof (item as RecentHistoryItem).visitedAt === 'string'
    )).slice(0, 12);
  } catch {
    return [];
  }
}

function readNotificationPreferences(): NotificationPreferences {
  const raw = safeLocalStorageGet(NOTIFICATION_PREFERENCES_KEY);
  if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(JSON.parse(raw) as Partial<NotificationPreferences>) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

function recentLabel(activeTitle: string) {
  if (typeof window === 'undefined') return activeTitle;
  const query = new URLSearchParams(window.location.search);
  const record = query.get('job') ?? query.get('order') ?? query.get('machine') ?? query.get('customer');
  if (record) return `${activeTitle} · ${record}`;
  const segments = window.location.pathname.split('/').filter(Boolean);
  const finalSegment = segments.at(-1);
  if (segments.length >= 2 && finalSegment && !['workspace', 'customers', 'work', 'assets', 'stock'].includes(finalSegment)) {
    try {
      return `${activeTitle} · ${decodeURIComponent(finalSegment)}`;
    } catch {
      return activeTitle;
    }
  }
  return activeTitle;
}

export function EnterpriseProductivityHub({
  role,
  pathname,
  activeTitle,
  favoriteHrefs,
  onToggleFavorite,
}: {
  role: BusinessRole;
  pathname: string;
  activeTitle: string;
  favoriteHrefs: string[];
  onToggleFavorite: (href: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentHistoryItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const shortcuts = useMemo(() => enterpriseShortcutsForRole(role), [role]);

  useEffect(() => {
    setRecent(readRecentHistory());
    setNotifications(readNotificationPreferences());
  }, []);

  useEffect(() => {
    const href = `${window.location.pathname}${window.location.search}`;
    const next = mergeRecentHistory(readRecentHistory(), {
      href,
      label: recentLabel(activeTitle),
      visitedAt: new Date().toISOString(),
    });
    safeLocalStorageSet(RECENT_HISTORY_KEY, JSON.stringify(next));
    setRecent(next);
  }, [activeTitle, pathname]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key === '?' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        onToggleFavorite(pathname);
        return;
      }
      const href = shortcutHrefForEvent(role, event);
      if (href && canAccessPath(role, href)) {
        event.preventDefault();
        router.push(href);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleFavorite, pathname, role, router]);

  function updateNotifications(patch: Partial<NotificationPreferences>) {
    setNotifications((current) => {
      const next = { ...current, ...patch };
      safeLocalStorageSet(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('dallmayrerp:notification-preferences', { detail: next }));
      return next;
    });
  }

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) return;
    const permission = await window.Notification.requestPermission();
    updateNotifications({ browserNotifications: permission === 'granted' });
  }

  const isPinned = favoriteHrefs.includes(pathname);
  const allowedRecent = recent.filter((item) => canAccessPath(role, item.href.split('?')[0] || '/'));

  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)} title="Quick access and keyboard shortcuts (?)" type="button">
        Quick access
      </button>
      {open ? (
        <div
          aria-label="Quick access, history and notification preferences"
          aria-modal="true"
          role="dialog"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.58)', display: 'grid', placeItems: 'center', padding: 20 }}
          onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}
        >
          <section className="neo-card spatial-card" style={{ width: 'min(920px, 96vw)', maxHeight: '88vh', overflow: 'auto', display: 'grid', gap: 18 }}>
            <div className="page-header" style={{ margin: 0 }}>
              <div><h2>Quick access</h2><p>Pinned pages, recent records, shortcuts and notification controls.</p></div>
              <div className="action-row">
                <button className="button secondary" onClick={() => onToggleFavorite(pathname)} type="button">{isPinned ? 'Unpin current page' : 'Pin current page'}</button>
                <button className="button secondary" onClick={() => setOpen(false)} type="button">Close</button>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="card spatial-card">
                <h3>Recent history</h3>
                <p>Cross-record history is stored on this device and de-duplicated by exact record URL.</p>
                <div style={{ display: 'grid', gap: 8 }}>
                  {allowedRecent.length ? allowedRecent.slice(0, 10).map((item) => (
                    <Link href={item.href} key={item.href} onClick={() => setOpen(false)} className="button secondary" style={{ justifyContent: 'space-between' }}>
                      <span>{item.label}</span><small>{new Date(item.visitedAt).toLocaleString()}</small>
                    </Link>
                  )) : <p>No recent records yet.</p>}
                </div>
              </div>

              <div className="card spatial-card">
                <h3>Keyboard shortcuts</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {shortcuts.map((shortcut) => (
                    <div key={shortcut.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <span>{shortcut.label}</span><kbd>{shortcut.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card spatial-card">
              <h3>Notification preferences</h3>
              <p>Choose which ERP signals should surface as personal alerts. Server-side permission checks remain authoritative.</p>
              <div className="grid grid-3">
                {([
                  ['assignments', 'Assignments'],
                  ['approvals', 'Approvals'],
                  ['serviceExceptions', 'Service exceptions'],
                  ['deliveryExceptions', 'Delivery exceptions'],
                  ['stockRisk', 'Stock risk'],
                  ['systemNotices', 'System notices'],
                ] as Array<[keyof NotificationPreferences, string]>).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input checked={Boolean(notifications[key])} onChange={(event) => updateNotifications({ [key]: event.target.checked })} type="checkbox" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="grid grid-3" style={{ marginTop: 14 }}>
                <label>Digest
                  <select value={notifications.digest} onChange={(event) => updateNotifications({ digest: event.target.value as NotificationPreferences['digest'] })}>
                    <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                  </select>
                </label>
                <label>Quiet hours start<input type="time" value={notifications.quietHoursStart} onChange={(event) => updateNotifications({ quietHoursStart: event.target.value })} /></label>
                <label>Quiet hours end<input type="time" value={notifications.quietHoursEnd} onChange={(event) => updateNotifications({ quietHoursEnd: event.target.value })} /></label>
              </div>
              <div className="action-row" style={{ marginTop: 14 }}>
                <button className="button secondary" onClick={enableBrowserNotifications} type="button">{notifications.browserNotifications ? 'Browser notifications enabled' : 'Enable browser notifications'}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
