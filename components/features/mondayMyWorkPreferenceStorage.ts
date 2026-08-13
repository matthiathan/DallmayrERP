import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';

export type WorkspaceMode = 'list' | 'board' | 'calendar' | 'dashboard';
export type QueueScope = 'my' | 'overdue' | 'approvals' | 'unassigned' | 'all';
export type GroupMode = 'urgency' | 'source' | 'status';
export type Density = 'comfortable' | 'compact';
export type WorkSource = 'work' | 'service' | 'delivery' | 'purchase' | 'stock' | 'asset';

export type WorkspacePreferences = {
  mode: WorkspaceMode;
  groupBy: GroupMode;
  density: Density;
  hiddenSources: WorkSource[];
};

export const workSources: WorkSource[] = ['work', 'service', 'delivery', 'purchase', 'stock', 'asset'];

export const preferenceDefaults: WorkspacePreferences = {
  mode: 'list',
  groupBy: 'urgency',
  density: 'comfortable',
  hiddenSources: [],
};

export function isWorkspaceMode(value: string | null): value is WorkspaceMode {
  return value === 'list' || value === 'board' || value === 'calendar' || value === 'dashboard';
}

export function isQueueScope(value: string | null): value is QueueScope {
  return value === 'my' || value === 'overdue' || value === 'approvals' || value === 'unassigned' || value === 'all';
}

function preferenceKey(userId: string) {
  return `dallmayr-my-work-v1:${userId}`;
}

export function readMondayMyWorkPreferences(userId: string): WorkspacePreferences {
  const raw = safeLocalStorageGet(preferenceKey(userId));
  if (!raw) return preferenceDefaults;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    const parsedMode = parsed.mode ?? null;
    return {
      mode: isWorkspaceMode(parsedMode) ? parsedMode : preferenceDefaults.mode,
      groupBy: parsed.groupBy === 'source' || parsed.groupBy === 'status' || parsed.groupBy === 'urgency' ? parsed.groupBy : preferenceDefaults.groupBy,
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      hiddenSources: Array.isArray(parsed.hiddenSources)
        ? parsed.hiddenSources.filter((value): value is WorkSource => workSources.includes(value as WorkSource))
        : [],
    };
  } catch {
    return preferenceDefaults;
  }
}

export function writeMondayMyWorkPreferences(userId: string, preferences: WorkspacePreferences) {
  safeLocalStorageSet(preferenceKey(userId), JSON.stringify(preferences));
}
