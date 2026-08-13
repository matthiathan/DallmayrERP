'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole, UserDetails } from '@/types/dallmayrerp';

type AlertTone = 'critical' | 'warning' | 'info';

type AppAlert = {
  id: string;
  title: string;
  body: string;
  href: string;
  tone: AlertTone;
  occurredAt: string;
  source: string;
};

type ExceptionRow = {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  status: string;
  branch: string;
  source_href: string | null;
  last_seen_at: string;
};

type ServiceJobRow = {
  id: string;
  job_number: string;
  summary: string;
  priority: string;
  status: string;
  due_at: string | null;
  created_at: string;
};

type WorkItemRow = {
  id: string;
  work_number: string;
  title: string;
  work_type: string;
  priority: string;
  status: string;
  branch: string;
  due_at: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
};

type ContractRenewalRow = {
  branch: string;
  contract_number: string | null;
  customer_code: string | null;
  customer_name: string | null;
  agreement_type: string | null;
  salesman: string | null;
  end_date_text: string | null;
  days_to_expire: number | null;
  renewal_window: string;
  total_count: number;
};

type DesktopPermissionState = NotificationPermission | 'unsupported';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const POLL_INTERVAL_MS = 120_000;
const READ_KEY_PREFIX = 'dallmayr-mobile-alerts-read-v1';
const NOTIFIED_KEY_PREFIX = 'dallmayr-desktop-alerts-notified-v1';
const DESKTOP_ENABLED_KEY_PREFIX = 'dallmayr-desktop-notifications-enabled-v1';
const exceptionRoles = new Set(['admin', 'operations', 'executive', 'warehouse_staff', 'finance']);
const fieldRoles = new Set(['technician', 'road_technician']);
const contractRoles = new Set(['admin', 'executive', 'operations', 'sales', 'marketing']);
const severityOrder: Record<string, number> = { critical: 0, high: 1, warning: 2, info: 3 };
const openWorkStatuses = ['new', 'triaged', 'assigned', 'in_progress', 'blocked', 'waiting_approval'];

function readStoredIds(prefix: string, userId: string) {
  try {
    const raw = safeLocalStorageGet(`${prefix}:${userId}`);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function writeStoredIds(prefix: string, userId: string, ids: Set<string>) {
  safeLocalStorageSet(`${prefix}:${userId}`, JSON.stringify(Array.from(ids).slice(-250)));
}

function readIds(userId: string) {
  return readStoredIds(READ_KEY_PREFIX, userId);
}

function writeIds(userId: string, ids: Set<string>) {
  writeStoredIds(READ_KEY_PREFIX, userId, ids);
}

function readDesktopEnabled(userId: string) {
  return safeLocalStorageGet(`${DESKTOP_ENABLED_KEY_PREFIX}:${userId}`) === 'true';
}

function writeDesktopEnabled(userId: string, enabled: boolean) {
  safeLocalStorageSet(`${DESKTOP_ENABLED_KEY_PREFIX}:${userId}`, String(enabled));
}

function formatRelative(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dueLabel(value: string | null) {
  if (!value) return 'No due time';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Due time unavailable';
  const difference = timestamp - Date.now();
  const hours = Math.round(Math.abs(difference) / 3_600_000);
  if (difference < 0) return hours < 24 ? `${hours}h overdue` : `${Math.round(hours / 24)}d overdue`;
  return hours < 24 ? `Due in ${Math.max(1, hours)}h` : `Due in ${Math.round(hours / 24)}d`;
}

function alertBranch(userDetails: UserDetails, role: BusinessRole) {
  return userDetails.branch === 'national' || role === 'admin' || role === 'executive' ? 'all' : userDetails.branch;
}

function contractHref(role: BusinessRole) {
  if (role === 'sales') return '/sales';
  if (role === 'executive') return '/executive/contracts';
  return '/marketing/contract-renewals';
}

function appHref(href: string | null | undefined, fallback = '/') {
  if (!href) return fallback;

  try {
    const url = new URL(href, 'https://dallmayr.local');
    if (url.origin !== 'https://dallmayr.local') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function alertTimestamp(...values: Array<string | null | undefined>) {
  return values.find((value) => value && Number.isFinite(new Date(value).getTime())) ?? new Date().toISOString();
}

function alertTargetHref(href: string) {
  const safeHref = appHref(href);
  if (typeof window === 'undefined') return safeHref;
  return new URL(safeHref, window.location.origin).href;
}

function standaloneMode() {
  const mobileNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || mobileNavigator.standalone === true;
}

export function MobileAppExperience() {
  const pathname = usePathname();
  const { businessUser, userDetails } = useAuth();
  const userId = businessUser?.id ?? '';
  const role = userDetails?.role;
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [desktopPermission, setDesktopPermission] = useState<DesktopPermissionState>('unsupported');
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [error, setError] = useState('');
  const [triggerTarget, setTriggerTarget] = useState<Element | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const unreadCount = useMemo(() => alerts.filter((item) => !read.has(item.id)).length, [alerts, read]);

  useEffect(() => {
    function syncTarget() {
      setTriggerTarget(document.querySelector('#desktop-alerts-target'));
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function openInbox() {
      setOpen(true);
    }

    window.addEventListener('dallmayr-open-alerts', openInbox);
    return () => window.removeEventListener('dallmayr-open-alerts', openInbox);
  }, []);

  const loadAlerts = useCallback(async () => {
    if (!userId || !userDetails || !role || !navigator.onLine) return;
    setLoading(true);
    setError('');
    const client = getSupabaseClient();
    const next: AppAlert[] = [];

    try {
      const { data: workItems, error: workError } = await client
        .from('work_items')
        .select('id, work_number, title, work_type, priority, status, branch, due_at, sla_due_at, created_at, updated_at')
        .eq('assigned_to', userId)
        .in('status', openWorkStatuses)
        .order('updated_at', { ascending: false })
        .limit(40);
      if (workError) throw workError;

      ((workItems ?? []) as WorkItemRow[]).forEach((item) => {
        const targetAt = item.sla_due_at ?? item.due_at;
        const targetTime = targetAt ? new Date(targetAt).getTime() : Number.POSITIVE_INFINITY;
        const overdue = Number.isFinite(targetTime) && targetTime < Date.now();
        const priority = item.priority.toLowerCase();
        const highPriority = ['high', 'urgent', 'critical'].includes(priority);
        const newWork = item.status === 'new' || item.status === 'assigned';

        next.push({
          id: `work:${item.id}:${item.status}:${item.updated_at}`,
          title: `${item.work_number} - ${newWork ? 'New assigned task' : item.status.replace(/_/g, ' ')}`,
          body: `${item.title}. ${dueLabel(targetAt)}.`,
          href: `/work/${item.id}`,
          tone: overdue ? 'critical' : highPriority ? 'warning' : 'info',
          occurredAt: alertTimestamp(item.updated_at, item.created_at),
          source: `${item.work_type.replace(/_/g, ' ')} - ${item.branch.toUpperCase()}`,
        });
      });

      if (fieldRoles.has(role)) {
        const { data, error: jobError } = await client
          .from('service_jobs')
          .select('id, job_number, summary, priority, status, due_at, created_at')
          .eq('assigned_to', userId)
          .in('status', ['assigned', 'in_progress'])
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(40);
        if (jobError) throw jobError;

        const jobRoute = role === 'road_technician' ? '/road-tech' : '/technician';
        ((data ?? []) as ServiceJobRow[]).forEach((job) => {
          const dueTime = job.due_at ? new Date(job.due_at).getTime() : Number.POSITIVE_INFINITY;
          const overdue = Number.isFinite(dueTime) && dueTime < Date.now();
          const priority = job.priority.toLowerCase();
          const highPriority = ['high', 'urgent', 'critical'].includes(priority);
          next.push({
            id: `job:${job.id}:${job.status}:${job.due_at ?? 'none'}`,
            title: `${job.job_number} · ${overdue ? 'Overdue' : highPriority ? 'Priority job' : job.status.replace(/_/g, ' ')}`,
            body: `${job.summary}. ${dueLabel(job.due_at)}.`,
            href: `${jobRoute}?job=${encodeURIComponent(job.job_number)}`,
            tone: overdue ? 'critical' : highPriority ? 'warning' : 'info',
            occurredAt: job.due_at ?? job.created_at,
            source: 'Assigned work',
          });
        });
      }

      if (contractRoles.has(role)) {
        const branch = alertBranch(userDetails, role);
        const { data, error: contractError } = await client.rpc('search_contract_renewals', {
          p_search: null,
          p_branch: branch,
          p_salesman: 'all',
          p_window: 'overdue',
          p_offset: 0,
          p_limit: 8,
        });
        if (contractError) throw contractError;

        const rows = (data ?? []) as ContractRenewalRow[];
        const total = Number(rows[0]?.total_count ?? rows.length);
        const first = rows[0];

        if (total > 0) {
          next.push({
            id: `contracts:overdue:${branch}:${total}:${first?.contract_number ?? first?.customer_code ?? first?.customer_name ?? 'unknown'}`,
            title: `${total.toLocaleString('en-ZA')} expired contract${total === 1 ? '' : 's'} need review`,
            body: first
              ? `${first.customer_name ?? 'A customer'}${first.contract_number ? ` - ${first.contract_number}` : ''}${first.end_date_text ? ` expired ${first.end_date_text}` : ' is past renewal date'}.`
              : 'Open the renewal workspace to review expired customer agreements.',
            href: contractHref(role),
            tone: 'critical',
            occurredAt: new Date().toISOString(),
            source: 'Contract renewals',
          });
        }
      }

      if (exceptionRoles.has(role)) {
        const { error: syncError } = await client.rpc('sync_operational_exceptions');
        if (syncError) throw syncError;

        const allBranches = userDetails.branch === 'national' || role === 'admin' || role === 'executive';
        const { data, error: exceptionError } = await client.rpc('list_exception_cases', {
          p_branch: allBranches ? 'all' : userDetails.branch,
          p_search: null,
        });
        if (exceptionError) throw exceptionError;

        ((data ?? []) as ExceptionRow[])
          .filter((item) => item.status !== 'resolved' && item.status !== 'snoozed')
          .sort((left, right) => (severityOrder[left.severity] ?? 9) - (severityOrder[right.severity] ?? 9))
          .slice(0, 40)
          .forEach((item) => {
            next.push({
              id: `exception:${item.id}:${item.status}:${item.last_seen_at}`,
              title: item.title,
              body: `${item.detail ?? 'Operational exception requires review.'} · ${item.branch.toUpperCase()}`,
              href: appHref(item.source_href, `/operations/exceptions?case=${encodeURIComponent(item.id)}`),
              tone: ['critical', 'high'].includes(item.severity) ? 'critical' : item.severity === 'warning' ? 'warning' : 'info',
              occurredAt: item.last_seen_at,
              source: `Exception · ${item.status.replace(/_/g, ' ')}`,
            });
          });
      }

      next.sort((left, right) => {
        const toneOrder: Record<AlertTone, number> = { critical: 0, warning: 1, info: 2 };
        const toneDifference = toneOrder[left.tone] - toneOrder[right.tone];
        if (toneDifference) return toneDifference;
        return new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
      });
      setAlerts(next.slice(0, 50));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Notifications could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }, [role, userDetails, userId]);

  useEffect(() => {
    if (!userId) {
      setRead(new Set<string>());
      setAlerts([]);
      setDesktopEnabled(false);
      setDesktopPermission('unsupported');
      notifiedRef.current = new Set<string>();
      return;
    }

    const permission: DesktopPermissionState = 'Notification' in window ? Notification.permission : 'unsupported';
    const enabled = permission === 'granted' && readDesktopEnabled(userId);

    setRead(readIds(userId));
    setDesktopPermission(permission);
    setDesktopEnabled(enabled);
    notifiedRef.current = readStoredIds(NOTIFIED_KEY_PREFIX, userId);
    void loadAlerts();
  }, [loadAlerts, userId]);

  useEffect(() => {
    if (!userId || open || !desktopEnabled || desktopPermission !== 'granted' || !('Notification' in window)) return;

    const candidates = alerts
      .filter((item) => !read.has(item.id) && !notifiedRef.current.has(item.id))
      .slice(0, 4);

    if (!candidates.length) return;

    const nextNotified = new Set(notifiedRef.current);

    candidates.forEach((item) => {
      const options: NotificationOptions = {
        body: item.body,
        badge: '/icons/dallmayr-app.svg',
        data: { href: alertTargetHref(item.href) },
        icon: '/icons/dallmayr-app.svg',
        requireInteraction: item.tone === 'critical',
        tag: item.id,
      };

      if (registration?.showNotification) {
        void registration.showNotification(item.title, options);
      } else {
        const notification = new Notification(item.title, options);
        notification.onclick = () => {
          window.focus();
          window.location.assign(item.href);
          notification.close();
        };
      }

      nextNotified.add(item.id);
    });

    notifiedRef.current = nextNotified;
    writeStoredIds(NOTIFIED_KEY_PREFIX, userId, nextNotified);
  }, [alerts, desktopEnabled, desktopPermission, open, read, registration, userId]);

  useEffect(() => {
    if (!userId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' || desktopEnabled) void loadAlerts();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadAlerts();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [desktopEnabled, loadAlerts, userId]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void loadAlerts();
    };
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadAlerts]);

  useEffect(() => {
    setInstalled(standaloneMode());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    let controllerChanged = false;
    let nextRegistration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const handleWorkerStateChange = () => {
      if (!cancelled && installingWorker?.state === 'installed' && navigator.serviceWorker.controller) {
        setUpdateReady(true);
      }
    };
    const handleUpdateFound = () => {
      installingWorker?.removeEventListener('statechange', handleWorkerStateChange);
      installingWorker = nextRegistration?.installing ?? null;
      installingWorker?.addEventListener('statechange', handleWorkerStateChange);
    };
    const handleControllerChange = () => {
      if (controllerChanged) return;
      controllerChanged = true;
      window.location.reload();
    };

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registered) => {
      if (cancelled) return;
      nextRegistration = registered;
      setRegistration(registered);
      if (registered.waiting) setUpdateReady(true);
      registered.addEventListener('updatefound', handleUpdateFound);
    }).catch(() => {
      if (!cancelled) setError('Installable-app support could not be initialized.');
    });

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => {
      cancelled = true;
      installingWorker?.removeEventListener('statechange', handleWorkerStateChange);
      nextRegistration?.removeEventListener('updatefound', handleUpdateFound);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  function markRead(id: string) {
    if (!userId) return;
    setRead((current) => {
      const next = new Set(current);
      next.add(id);
      writeIds(userId, next);
      return next;
    });
  }

  function markAllRead() {
    if (!userId) return;
    const next = new Set(read);
    alerts.forEach((item) => next.add(item.id));
    writeIds(userId, next);
    setRead(next);
  }

  async function enableDesktopNotifications() {
    if (!userId) return;

    if (!('Notification' in window)) {
      setDesktopPermission('unsupported');
      setDesktopEnabled(false);
      setError('Desktop notifications are not supported by this browser.');
      return;
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    setDesktopPermission(permission);

    if (permission !== 'granted') {
      writeDesktopEnabled(userId, false);
      setDesktopEnabled(false);
      setError(permission === 'denied'
        ? 'Desktop notifications are blocked. Enable notifications for this site in your browser settings.'
        : 'Desktop notifications were not enabled.');
      return;
    }

    writeDesktopEnabled(userId, true);
    setDesktopEnabled(true);
    setError('');

    const notificationOptions: NotificationOptions = {
      body: 'You will be notified about expired contracts, new assigned tasks and urgent operational alerts while DallmayrERP is open.',
      badge: '/icons/dallmayr-app.svg',
      data: { href: alertTargetHref('/work') },
      icon: '/icons/dallmayr-app.svg',
      tag: 'dallmayrerp-desktop-enabled',
    };

    if (registration?.showNotification) {
      await registration.showNotification('DallmayrERP desktop alerts enabled', notificationOptions);
    } else {
      new Notification('DallmayrERP desktop alerts enabled', notificationOptions);
    }
  }

  function disableDesktopNotifications() {
    if (!userId) return;
    writeDesktopEnabled(userId, false);
    setDesktopEnabled(false);
  }

  async function installApplication() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  }

  function applyUpdate() {
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }

  if (!userId || !userDetails) return null;

  const showInstall = !installed && Boolean(installPrompt);
  const showIosHelp = !installed && !installPrompt && ios;
  const desktopSupported = desktopPermission !== 'unsupported';
  const desktopBlocked = desktopPermission === 'denied';
  const desktopStatus = !desktopSupported
    ? 'Unsupported'
    : desktopEnabled
      ? 'On'
      : desktopBlocked
        ? 'Blocked'
        : 'Off';

  const unreadAlerts = alerts.filter((item) => !read.has(item.id));
  const earlierAlerts = alerts.filter((item) => read.has(item.id));
  const trigger = triggerTarget ? createPortal(
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Open Inbox${unreadCount ? `, ${unreadCount} unread` : ''}`}
      className={`notification-inbox-trigger ${unreadCount ? 'has-unread' : ''}`}
      onClick={() => setOpen(true)}
      type="button"
    >
      <span aria-hidden="true">♢</span>
      <span className="sr-only">Inbox</span>
      {unreadCount ? <em>{unreadCount > 99 ? '99+' : unreadCount}</em> : null}
    </button>,
    triggerTarget,
  ) : null;

  function renderAlertGroup(title: string, items: AppAlert[]) {
    if (!items.length) return null;
    return (
      <section className="notification-inbox-group">
        <div className="notification-inbox-group-heading"><strong>{title}</strong><span>{items.length}</span></div>
        <div className="notification-inbox-list">
          {items.map((item) => {
            const unread = !read.has(item.id);
            return (
              <Link
                className={`notification-card tone-${item.tone} ${unread ? 'is-unread' : ''}`}
                href={item.href}
                key={item.id}
                onClick={() => markRead(item.id)}
              >
                <span aria-hidden="true" className="notification-card-dot" />
                <div className="notification-card-content">
                  <div className="notification-card-heading"><span>{item.source}</span><time>{formatRelative(item.occurredAt)}</time></div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>{unread ? 'New · Open record' : 'Open record'}</small>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <>
      {trigger}
      {open ? <button aria-label="Close Inbox" className="notification-inbox-backdrop" onClick={() => setOpen(false)} type="button" /> : null}
      {open ? (
        <div aria-labelledby="notification-inbox-title" aria-modal="true" className="notification-inbox-panel" ref={panelRef} role="dialog">
          <header className="notification-inbox-header">
            <div>
              <span>Inbox</span>
              <h2 id="notification-inbox-title">Notifications</h2>
              <p>{online ? 'Live operational updates for your role.' : 'Showing the latest notifications saved on this device.'}</p>
            </div>
            <button aria-label="Close Inbox" className="notification-inbox-close" onClick={() => setOpen(false)} ref={closeRef} type="button">×</button>
          </header>

          <div className="notification-inbox-status">
            <div className={online ? 'is-online' : 'is-offline'}><span /> <strong>{online ? 'Online' : 'Offline'}</strong></div>
            <div><strong>{installed ? 'Installed app' : 'Browser mode'}</strong></div>
            <div><strong>Desktop alerts</strong><span>{desktopStatus}</span></div>
            {updateReady ? <button onClick={applyUpdate} type="button">Update ready</button> : null}
          </div>

          <div className="notification-inbox-toolbar">
            <div><strong>{unreadCount} unread</strong><span>{alerts.length} current notifications</span></div>
            <div>
              {desktopEnabled ? (
                <button onClick={disableDesktopNotifications} type="button">Pause desktop alerts</button>
              ) : (
                <button disabled={!desktopSupported || desktopBlocked} onClick={() => void enableDesktopNotifications()} type="button">Enable desktop alerts</button>
              )}
              <button disabled={loading || !online} onClick={() => void loadAlerts()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
              <button disabled={!unreadCount} onClick={markAllRead} type="button">Mark all read</button>
            </div>
          </div>

          {error ? <div className="notification-inbox-error" role="alert">{error}</div> : null}
          {!error && alerts.length === 0 ? (
            <div className="notification-inbox-empty"><span aria-hidden="true">✓</span><strong>You are up to date</strong><p>Expired contracts, assigned tasks and operational exceptions will appear here.</p></div>
          ) : null}

          <div className="notification-inbox-content">
            {renderAlertGroup('Unread', unreadAlerts)}
            {renderAlertGroup('Earlier', earlierAlerts)}
          </div>

          {showInstall || showIosHelp ? (
            <section className="notification-install-card">
              <div><span>Install DallmayrERP</span><strong>Open it like a dedicated application</strong></div>
              {showInstall ? <button className="button" onClick={installApplication} type="button">Install application</button> : null}
              {showIosHelp ? <p>On iPhone or iPad, use Share and choose Add to Home Screen.</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
