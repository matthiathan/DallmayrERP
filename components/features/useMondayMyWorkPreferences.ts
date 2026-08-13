'use client';

import { useEffect, useState } from 'react';
import {
  isQueueScope,
  isWorkspaceMode,
  preferenceDefaults,
  readMondayMyWorkPreferences,
  writeMondayMyWorkPreferences,
  type QueueScope,
  type WorkspacePreferences,
} from '@/components/features/mondayMyWorkPreferenceStorage';

export {
  preferenceDefaults,
  workSources,
  type Density,
  type GroupMode,
  type QueueScope,
  type WorkspaceMode,
  type WorkspacePreferences,
  type WorkSource,
} from '@/components/features/mondayMyWorkPreferenceStorage';

export function useMondayMyWorkPreferences(userId: string | undefined) {
  const [scope, setScope] = useState<QueueScope>('my');
  const [preferences, setPreferences] = useState<WorkspacePreferences>(preferenceDefaults);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const stored = readMondayMyWorkPreferences(userId);
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
    writeMondayMyWorkPreferences(userId, preferences);
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
