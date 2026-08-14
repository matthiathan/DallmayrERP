import type { BusinessRole } from '@/types/dallmayrerp';

export type ExecutiveKpiKey =
  | 'customers'
  | 'contracts'
  | 'assets'
  | 'service'
  | 'closures'
  | 'deliveries'
  | 'documents'
  | 'stockScans';

export const EXECUTIVE_KPI_CATALOG: Array<{ key: ExecutiveKpiKey; label: string; description: string }> = [
  { key: 'customers', label: 'Customers', description: 'Active customer master records across branches.' },
  { key: 'contracts', label: 'Contracts', description: 'Current contract records across branches.' },
  { key: 'assets', label: 'Machines / Assets', description: 'Registered machine and fixed-asset records.' },
  { key: 'service', label: 'Service Logs', description: 'Captured service activity.' },
  { key: 'closures', label: 'Task Closures', description: 'Completed operational task evidence.' },
  { key: 'deliveries', label: 'Delivery Orders', description: 'Delivery workflow records.' },
  { key: 'documents', label: 'Documents', description: 'Managed ERP documents.' },
  { key: 'stockScans', label: 'Stock Scans', description: 'Captured stock scanning activity.' },
];

export const DEFAULT_EXECUTIVE_KPIS: ExecutiveKpiKey[] = ['customers', 'contracts', 'assets', 'closures', 'deliveries', 'documents'];

export type NotificationPreferences = {
  assignments: boolean;
  approvals: boolean;
  serviceExceptions: boolean;
  deliveryExceptions: boolean;
  stockRisk: boolean;
  systemNotices: boolean;
  browserNotifications: boolean;
  digest: 'off' | 'daily' | 'weekly';
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assignments: true,
  approvals: true,
  serviceExceptions: true,
  deliveryExceptions: true,
  stockRisk: true,
  systemNotices: true,
  browserNotifications: false,
  digest: 'daily',
  quietHoursStart: '18:00',
  quietHoursEnd: '06:00',
};

export type RecentHistoryItem = {
  href: string;
  label: string;
  visitedAt: string;
};

export function mergeRecentHistory(
  current: RecentHistoryItem[],
  item: RecentHistoryItem,
  limit = 12,
): RecentHistoryItem[] {
  const href = item.href.trim();
  if (!href) return current.slice(0, limit);
  return [item, ...current.filter((entry) => entry.href !== href)].slice(0, Math.max(1, limit));
}

export type ReportSchedule = {
  id: string;
  reportKey: 'executive-management-pack' | 'branch-performance' | 'service-performance' | 'warehouse-risk';
  name: string;
  cadence: 'weekly' | 'monthly';
  weekday: number;
  dayOfMonth: number;
  hour: number;
  minute: number;
  format: 'pdf' | 'csv';
  enabled: boolean;
  createdAt: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function nextReportRun(schedule: ReportSchedule, now = new Date()): Date | null {
  if (!schedule.enabled) return null;
  const hour = clamp(schedule.hour, 0, 23);
  const minute = clamp(schedule.minute, 0, 59);

  if (schedule.cadence === 'weekly') {
    const targetWeekday = clamp(schedule.weekday, 0, 6);
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    let offset = (targetWeekday - candidate.getDay() + 7) % 7;
    if (offset === 0 && candidate <= now) offset = 7;
    candidate.setDate(candidate.getDate() + offset);
    return candidate;
  }

  const candidate = new Date(now.getFullYear(), now.getMonth(), 1, hour, minute, 0, 0);
  const setMonthlyDay = (date: Date) => {
    const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(clamp(schedule.dayOfMonth, 1, maxDay));
  };
  setMonthlyDay(candidate);
  if (candidate <= now) {
    candidate.setMonth(candidate.getMonth() + 1, 1);
    setMonthlyDay(candidate);
  }
  return candidate;
}

export type EnterpriseShortcut = {
  key: string;
  label: string;
  href?: string;
};

const shortcutCandidates: Array<EnterpriseShortcut & { roles?: BusinessRole[] }> = [
  { key: 'Alt+Shift+H', label: 'Today', href: '/workspace' },
  { key: 'Alt+Shift+W', label: 'My Work', href: '/work' },
  { key: 'Alt+Shift+C', label: 'Customers', href: '/customers' },
  { key: 'Alt+Shift+S', label: 'Service jobs', href: '/operations/service-jobs', roles: ['admin', 'operations'] },
  { key: 'Alt+Shift+R', label: 'Executive reports', href: '/executive/reports', roles: ['admin', 'executive'] },
  { key: 'Alt+Shift+P', label: 'Pin / unpin current page' },
  { key: '?', label: 'Open shortcut and quick-access panel' },
];

export function enterpriseShortcutsForRole(role: BusinessRole): EnterpriseShortcut[] {
  return shortcutCandidates
    .filter((shortcut) => !shortcut.roles || shortcut.roles.includes(role))
    .map((shortcut) => ({
      key: shortcut.key,
      label: shortcut.label,
      ...(shortcut.href ? { href: shortcut.href } : {}),
    }));
}

export function shortcutHrefForEvent(
  role: BusinessRole,
  event: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
): string | null {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  const shortcut = enterpriseShortcutsForRole(role).find((item) => item.href && item.key.toLowerCase() === `alt+shift+${key}`);
  return shortcut?.href ?? null;
}

export function normaliseExecutiveKpis(value: unknown): ExecutiveKpiKey[] {
  if (!Array.isArray(value)) return DEFAULT_EXECUTIVE_KPIS;
  const allowed = new Set(EXECUTIVE_KPI_CATALOG.map((item) => item.key));
  const result = value.filter((item): item is ExecutiveKpiKey => typeof item === 'string' && allowed.has(item as ExecutiveKpiKey));
  return Array.from(new Set(result)).slice(0, 6).length ? Array.from(new Set(result)).slice(0, 6) : DEFAULT_EXECUTIVE_KPIS;
}
