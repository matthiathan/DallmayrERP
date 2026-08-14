'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
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
import {
  recentHistoryDisplayLabel,
  recentRecordTarget,
  type RecentRecordTarget,
} from '@/lib/productivity/recentHistoryLabels';
import { getSupabaseClient } from '@/lib/supabase/client';
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

function cleanLabelPart(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function primaryAndSecondary(primary: string | null | undefined, secondary: string | null | undefined, separator = ' — ') {
  const first = cleanLabelPart(primary);
  const second = cleanLabelPart(secondary);
  if (first && second && first !== second) return `${first}${separator}${second}`;
  return first ?? second;
}

async function resolveRecentRecordLabel(target: RecentRecordTarget): Promise<string | null> {
  const client = getSupabaseClient();

  if (target.kind === 'service-job') {
    const { data, error } = await client.from('service_jobs').select('job_number').eq('id', target.id).limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { job_number?: string | null } | undefined;
    return cleanLabelPart(row?.job_number);
  }

  if (target.kind === 'delivery-order') {
    const { data, error } = await client.from('delivery_orders').select('order_number, customer_name').eq('id', target.id).limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { order_number?: string | null; customer_name?: string | null } | undefined;
    return primaryAndSecondary(row?.order_number, row?.customer_name);
  }

  if (target.kind === 'customer') {
    const { data, error } = await client.from('customers').select('customer_name, customer_code').eq('id', target.id).limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { customer_name?: string | null; customer_code?: string | null } | undefined;
    const name = cleanLabelPart(row?.customer_name);
    const code = cleanLabelPart(row?.customer_code);
    return name && code ? `${name} (${code})` : name ?? code;
  }

  if (target.kind === 'machine') {
    const { data, error } = await client.from('machines').select('machine_name, serial_number, machine_barcode').eq('id', target.id).limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { machine_name?: string | null; serial_number?: string | null; machine_barcode?: string | null } | undefined;
    const name = cleanLabelPart(row?.machine_name);
    const serial = cleanLabelPart(row?.serial_number);
    const barcode = cleanLabelPart(row?.machine_barcode);
    if (name && serial) return `${name} · SN ${serial}`;
    return name ?? serial ?? barcode;
  }

  if (target.kind === 'work-item') {
    const { data, error } = await client.from('work_items').select('work_number, title').eq('id', target.id).limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { work_number?: string | null; title?: string | null } | undefined;
    return primaryAndSecondary(row?.work_number, row?.title);
  }

  const { data, error } = await client.from('stock_items').select('stock_name, item_barcode').eq('id', target.id).limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { stock_name?: string | null; item_barcode?: string | null } | undefined;
  return primaryAndSecondary(row?.stock_name, row?.item_barcode, ' · ');
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
  const [resolvedRecord, setResolvedRecord] = useState<{ href: string; label: string } | null>(null);
  const shortcuts = useMemo(() => enterpriseShortcutsForRole(role), [role]);
  const resolvedRecordLabel = resolvedRecord?.href === currentHref ? resolvedRecord.label : null;
  const currentDisplayLabel = recentHistoryDisplayLabel(activeTitle, resolvedRecordLabel);

  useEffect(() => {
    setRecent(readRecentHistory());
    setNotifications(readNotificationPreferences());
  }, []);

  useEffect(() => {
    const target = recentRecordTarget(pathname, search);
    if (!target) {
      setResolvedRecord(null);
      return;
    }

    let cancelled = false;
    void resolveRecentRecordLabel(target).then((label) => {
      if (cancelled || !label) return;
      setResolvedRecord({ href: currentHref, label });
    });
    return () => {
      cancelled = true;
    };
  }, [currentHref, pathname, search]);

  useEffect(() => {
    const next = mergeRecentHistory(readRecentHistory(), {
      href: currentHref,
      label: currentDisplayLabel,
      visitedAt: new Date().toISOString(),
    });
    safeLocalStorageSet(RECENT_HISTORY_KEY, JSON.stringify(next));
    setRecent(next);
  }, [currentDisplayLabel, currentHref]);

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
        onToggleFavorite(currentHref, currentDisplayLabel);
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
  }, [currentDisplayLabel, currentHref, onToggleFavorite, open, role, router]);

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
              onClick={() => onToggleFavorite(currentHref, currentDisplayLabel)}
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
