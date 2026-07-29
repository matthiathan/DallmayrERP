'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';

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

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const POLL_INTERVAL_MS = 120_000;
const READ_KEY_PREFIX = 'dallmayr-mobile-alerts-read-v1';
const exceptionRoles = new Set(['admin', 'operations', 'executive', 'warehouse_staff', 'finance']);
const fieldRoles = new Set(['technician', 'road_technician']);
const severityOrder: Record<string, number> = { critical: 0, high: 1, warning: 2, info: 3 };

function readIds(userId: string) {
  try {
    const raw = window.localStorage.getItem(`${READ_KEY_PREFIX}:${userId}`);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function writeIds(userId: string, ids: Set<string>) {
  window.localStorage.setItem(`${READ_KEY_PREFIX}:${userId}`, JSON.stringify(Array.from(ids).slice(-250)));
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

function standaloneMode() {
  const mobileNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || mobileNavigator.standalone === true;
}

export function MobileAppExperience() {
  const pathname = usePathname();
  const { businessUser, userDetails } = useAuth();
  const userId = businessUser?.id ?? '';
  const role = userDetails?.role ?? '';
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const unreadCount = useMemo(() => alerts.filter((item) => !read.has(item.id)).length, [alerts, read]);

  const loadAlerts = useCallback(async () => {
    if (!userId || !userDetails || !navigator.onLine) return;
    setLoading(true);
    setError('');
    const client = getSupabaseClient();
    const next: AppAlert[] = [];

    try {
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

      if (exceptionRoles.has(role)) {
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
              href: `/operations/exceptions?case=${encodeURIComponent(item.id)}`,
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
      return;
    }
    setRead(readIds(userId));
    void loadAlerts();
  }, [loadAlerts, userId]);

  useEffect(() => {
    if (!userId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadAlerts();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadAlerts();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadAlerts, userId]);

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
    let controllerChanged = false;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((nextRegistration) => {
      setRegistration(nextRegistration);
      if (nextRegistration.waiting) setUpdateReady(true);
      nextRegistration.addEventListener('updatefound', () => {
        const worker = nextRegistration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
        });
      });
    }).catch(() => setError('Installable-app support could not be initialized.'));

    const handleControllerChange = () => {
      if (controllerChanged) return;
      controllerChanged = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
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

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Open notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        className={`mobile-app-alert-trigger ${unreadCount ? 'has-unread' : ''}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true">♢</span>
        <strong>Alerts</strong>
        {unreadCount ? <em>{unreadCount > 99 ? '99+' : unreadCount}</em> : null}
      </button>

      {open ? <button aria-label="Close notifications" className="mobile-app-alert-backdrop" onClick={() => setOpen(false)} type="button" /> : null}

      {open ? (
        <div aria-labelledby="mobile-alert-title" aria-modal="true" className="mobile-app-alert-sheet" ref={panelRef} role="dialog">
          <header>
            <div>
              <span>Mobile inbox</span>
              <h2 id="mobile-alert-title">Notifications</h2>
              <p>{online ? 'Live operational updates for your role.' : 'Showing the last notifications loaded on this device.'}</p>
            </div>
            <button aria-label="Close notifications" className="mobile-app-alert-close" onClick={() => setOpen(false)} ref={closeRef} type="button">×</button>
          </header>

          <div className="mobile-app-status-strip">
            <div className={online ? 'is-online' : 'is-offline'}><span /> <strong>{online ? 'Online' : 'Offline'}</strong></div>
            <div><strong>{installed ? 'Installed app' : 'Browser mode'}</strong></div>
            {updateReady ? <button onClick={applyUpdate} type="button">Update ready</button> : null}
          </div>

          {showInstall || showIosHelp ? (
            <section className="mobile-install-card">
              <div><span>Install DallmayrERP</span><strong>Open it like a mobile application</strong></div>
              {showInstall ? <button className="button" onClick={installApplication} type="button">Install application</button> : null}
              {showIosHelp ? <p>On iPhone or iPad, use Share and choose Add to Home Screen.</p> : null}
            </section>
          ) : null}

          <div className="mobile-alert-toolbar">
            <div><strong>{unreadCount} unread</strong><span>{alerts.length} current alerts</span></div>
            <div>
              <button disabled={loading || !online} onClick={() => void loadAlerts()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
              <button disabled={!unreadCount} onClick={markAllRead} type="button">Mark all read</button>
            </div>
          </div>

          {error ? <div className="mobile-alert-error" role="alert">{error}</div> : null}
          {!error && alerts.length === 0 ? (
            <div className="mobile-alert-empty"><strong>No urgent updates</strong><p>New assigned jobs and operational exceptions will appear here.</p></div>
          ) : null}

          <div className="mobile-alert-list">
            {alerts.map((item) => {
              const unread = !read.has(item.id);
              return (
                <Link
                  className={`mobile-alert-card tone-${item.tone} ${unread ? 'is-unread' : ''}`}
                  href={item.href}
                  key={item.id}
                  onClick={() => markRead(item.id)}
                >
                  <div className="mobile-alert-card-heading"><span>{item.source}</span><time>{formatRelative(item.occurredAt)}</time></div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>{unread ? 'New · Open record' : 'Open record'}</small>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
