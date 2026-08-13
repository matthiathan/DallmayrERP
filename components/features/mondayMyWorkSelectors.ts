import { isPast, type NormalizedMyWorkItem } from '@/components/features/mondayMyWorkNormalization';
import type { GroupMode } from '@/components/features/mondayMyWorkPreferenceStorage';

const urgencyOrder = ['Attention', 'Today', 'This week', 'Later', 'Unscheduled'];

export function localDateKey(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function startOfLocalDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function startOfWeek(date = new Date()) {
  const value = startOfLocalDay(date);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value;
}

export function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function priorityRank(priority: string) {
  if (priority === 'critical') return 0;
  if (priority === 'high') return 1;
  if (priority === 'medium') return 2;
  return 3;
}

export function urgencyKey(item: NormalizedMyWorkItem) {
  if (item.approvalPending || (item.isOpen && isPast(item.dueAt))) return 'Attention';
  if (!item.dueAt) return 'Unscheduled';

  const today = startOfLocalDay();
  const due = startOfLocalDay(new Date(item.dueAt));
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days > 0 && days <= 7) return 'This week';
  if (days > 7) return 'Later';
  return 'Attention';
}

export function groupMyWorkItems(items: NormalizedMyWorkItem[], groupBy: GroupMode) {
  const map = new Map<string, NormalizedMyWorkItem[]>();
  items.forEach((item) => {
    const key = groupBy === 'source'
      ? item.sourceLabel
      : groupBy === 'status'
        ? item.status.replace(/_/g, ' ')
        : urgencyKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  });

  return Array.from(map.entries()).sort(([left], [right]) => {
    if (groupBy === 'urgency') return urgencyOrder.indexOf(left) - urgencyOrder.indexOf(right);
    return left.localeCompare(right);
  });
}

export function getMyWorkDashboardCounts(items: NormalizedMyWorkItem[]) {
  return {
    mine: items.filter((item) => item.isMine && item.isOpen).length,
    overdue: items.filter((item) => item.isOpen && isPast(item.dueAt)).length,
    approvals: items.filter((item) => item.approvalPending).length,
    unassigned: items.filter((item) => item.isUnassigned).length,
    nextSeven: items.filter((item) => {
      if (!item.dueAt || !item.isOpen) return false;
      const due = startOfLocalDay(new Date(item.dueAt));
      const today = startOfLocalDay();
      const diff = (due.getTime() - today.getTime()) / 86_400_000;
      return diff >= 0 && diff <= 7;
    }).length,
  };
}

export function getMyWorkCalendar(items: NormalizedMyWorkItem[], calendarStart: Date) {
  const calendarEnd = addDays(calendarStart, 7);
  const calendarDays = Array.from({ length: 7 }, (_, index) => addDays(calendarStart, index));
  const calendarItems = items.filter((item) => {
    if (!item.dueAt) return false;
    const due = new Date(item.dueAt);
    return due >= calendarStart && due < calendarEnd;
  });

  return { calendarDays, calendarItems };
}

export function getMyWorkAttentionItems(items: NormalizedMyWorkItem[]) {
  return items
    .filter((item) => item.approvalPending || item.isUnassigned || (item.isOpen && isPast(item.dueAt)))
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
    .slice(0, 10);
}
