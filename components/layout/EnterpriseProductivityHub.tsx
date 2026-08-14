'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { canAccessPath } from '@/lib/auth/permissions';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  favoriteHrefForLocation,
  MAX_FAVORITES,
  type FavoriteEntry,
} from '@/lib/navigation/favorites';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  enterpriseShortcutsForRole,
  mergeRecentHistory,
  shortcutHrefForEvent,
  type NotificationPreferences,
  type RecentHistoryItem,
} from '@/lib/productivity/enterpriseFinish';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import type { BusinessRole } from '@/types/dallmayrerp';

const RECENT_HISTORY_KEY = 'dallmayrerp-recent-history-v1';
const NOTIFICATION_PREFERENCES_KEY = 'dallmayrerp-notification-preferences-v1';
const QUICK_ACCESS_DIALOG_ID = 'quick-access-dialog';
const QUICK_ACCESS_DIALOG_TITLE_ID = 'quick-access-dialog-title';
const QUICK_ACCESS_DIALOG_DESCRIPTION_ID = 'quick-access-dialog-description';
type NotificationBooleanKey = 'assignments' | 'approvals' | 'serviceExceptions' | 'deliveryExceptions' | 'stockRisk' | 'systemNotices';
const NOTIFICATION_TOGGLES: Array<[NotificationBooleanKey, string]> = [
  ['assignments', 'Assignments'],
  ['approvals', 'Approvals'],
  ['serviceExceptions', 'Service exceptions'],
  ['deliveryExceptions', 'Delivery exceptions'],
  ['stockRisk', 'Stock risk'],
  ['systemNotices', 'System notices'],
];

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
  favorites,
  onToggleFavorite,
}: {
  role: BusinessRole;
  pathname: string;
  activeTitle: string;
  favorites: FavoriteEntry[];
  onToggleFavorite: (href: string, label?: string) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentHref = favoriteHrefForLocation(pathname, search);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentHistoryItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const shortcuts = useMemo(() => enterpriseShortcutsForRole(role), [role]);

  useEffect(() => {
    setRecent(readRecentHistory());
    setNotifications(readNotificationPreferences());
  }, []);

  useEffect(() => {
    const next = mergeRecentHistory(readRecentHistory(), {
      href: currentHref,
      label: recentLabel(activeTitle),
      visitedAt: new Date().toISOString(),
    });
    safeLocalStorageSet(RECENT_HISTORY_KEY, JSON.stringify(next));
    setRecent(next);
  }, [activeTitle, currentHref]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key === '?' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (open) return;
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        onToggleFavorite(currentHref, recentLabel(activeTitle));
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
  }, [activeTitle, currentHref, onToggleFavorite, open, role, router]);

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
    const permission = await Notification.requestPermission();
    updateNotifications({ browserNotifications: permission === 'granted' });
  }

  const isPinned = favorites.some((entry) => entry.href === currentHref);
  const pinLimitReached = !isPinned && favorites.length >= MAX_FAVORITES;
  const allowedRecent = recent.filter((item) => canAccessPath(role, item.href.split('?')[0] || '/'));

  return (
    <>
      <button
        aria-controls={QUICK_ACCESS_DIALOG_ID}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="button secondary"
        onClick={() => setOpen(true)}
        title="Quick access and keyboard shortcuts (?)"
        type="button"
      >
        Quick access
      </button>

      <AccessibleDialog
        describedBy={QUICK_ACCESS_DIALOG_DESCRIPTION_ID}
        id={QUICK_ACCESS_DIALOG_ID}
        labelledBy={QUICK_ACCESS_DIALOG_TITLE_ID}
        onClose={() => setOpen(false)}
        open={open}
        className="quick-access-dialog"
      >
        <div className="page-header quick-access-dialog-header">
          <div>
            <h2 id={QUICK_ACCESS_DIALOG_TITLE_ID}>Quick access</h2>
            <p id={QUICK_ACCESS_DIALOG_DESCRIPTION_ID}>Pinned pages, recent records, shortcuts and notification controls.</p>
          </div>
          <div className="action-row quick-access-dialog-actions">
            <button
              className="button secondary"
              disabled={pinLimitReached}
              onClick={() => onToggleFavorite(currentHref, recentLabel(activeTitle))}
              title={pinLimitReached ? `You can pin up to ${MAX_FAVORITES} pages` : undefined}
              type="button"
            >
              {isPinned ? 'Unpin current page' : 'Pin current page'}
            </button>
            <button className="button secondary" data-dialog-initial-focus onClick={() => setOpen(false)} type="button">Close</button>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card spatial-card">
            <h3>Recent history</h3>
            <p>Cross-record history is stored on this device and de-duplicated by exact record URL.</p>
            <div className="quick-access-list">
              {allowedRecent.length ? allowedRecent.slice(0, 10).map((item) => (
                <Link href={item.href} key={item.href} onClick={() => setOpen(false)} className="button secondary quick-access-history-link">
                  <span>{item.label}</span><small>{new Date(item.visitedAt).toLocaleString()}</small>
                </Link>
              )) : <p>No recent records yet.</p>}
            </div>
          </div>

          <div className="card spatial-card">
            <h3>Keyboard shortcuts</h3>
            <div className="quick-access-list">
              {shortcuts.map((shortcut) => (
                <div className="quick-access-shortcut-row" key={shortcut.key}>
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
            {NOTIFICATION_TOGGLES.map(([key, label]) => (
              <label className="quick-access-toggle" key={key}>
                <input checked={notifications[key]} onChange={(event) => updateNotifications({ [key]: event.target.checked })} type="checkbox" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-3 quick-access-preference-grid">
            <label>Digest
              <select value={notifications.digest} onChange={(event) => updateNotifications({ digest: event.target.value as NotificationPreferences['digest'] })}>
                <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
              </select>
            </label>
            <label>Quiet hours start<input type="time" value={notifications.quietHoursStart} onChange={(event) => updateNotifications({ quietHoursStart: event.target.value })} /></label>
            <label>Quiet hours end<input type="time" value={notifications.quietHoursEnd} onChange={(event) => updateNotifications({ quietHoursEnd: event.target.value })} /></label>
          </div>
          <div className="action-row quick-access-preference-actions">
            <button className="button secondary" onClick={enableBrowserNotifications} type="button">{notifications.browserNotifications ? 'Browser notifications enabled' : 'Enable browser notifications'}</button>
          </div>
        </div>
      </AccessibleDialog>
    </>
  );
}
