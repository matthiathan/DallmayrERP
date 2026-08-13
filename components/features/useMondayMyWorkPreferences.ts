'use client';

import { useEffect, useState } from 'react';
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

function isWorkspaceMode(value: string | null): value is WorkspaceMode {
  return value === 'list' || value === 'board' || value === 'calendar' || value === 'dashboard';
}

function isQueueScope(value: string | null): value is QueueScope {
  return value === 'my' || value === 'overdue' || value === 'approvals' || value === 'unassigned' || value === 'all';
}

function preferenceKey(userId: string) {
  return `dallmayr-my-work-v1:${userId}`;
}

function readPreferences(userId: string): WorkspacePreferences {
  const raw = safeLocalStorageGet(preferenceKey(userId));
  if (!raw) return preferenceDefaults;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      mode: isWorkspaceMode(parsed.mode ?? null) ? parsed.mode : preferenceDefaults.mode,
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

export function useMondayMyWorkPreferences(userId: string | undefined) {
  const [scope, setScope] = useState<QueueScope>('my');
  const [preferences, setPreferences] = useState<WorkspacePreferences>(preferenceDefaults);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const stored = readPreferences(userId);
    const params = new URL(window.location.href).searchParams;
    const urlMode = params.get('view');
    const urlScope = params.get('scope');
    setPreferences({
      ...stored,
      mode: isWorkspaceMode(urlMode) ? urlMode : stored.mode,
    });
    setScope(isQueueScope(urlScope) ? urlScope : 'my');
    setHydrated(true);
  }, [userId]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    safeLocalStorageSet(preferenceKey(userId), JSON.stringify(preferences));
    const url = new URL(window.location.href);
    url.searchParams.set('view', preferences.mode);
    url.searchParams.set('scope', scope);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [hydrated, preferences, scope, userId]);

  return {
    preferences,
    scope,
    setPreferences,
    setScope,
  };
}
