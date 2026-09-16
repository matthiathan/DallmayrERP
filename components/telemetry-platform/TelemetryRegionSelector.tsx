'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TelemetryRegion } from '@/types/dallmayrerp';
import styles from './TelemetryRegionSelector.module.css';

const REGIONS: Array<{ value: TelemetryRegion; label: string; helper: string }> = [
  { value: 'south_africa', label: 'South Africa', helper: 'Johannesburg, Cape Town, KZN and other South African branches' },
  { value: 'dubai', label: 'Dubai', helper: 'Dubai telemetry fleet' },
  { value: 'europe', label: 'Europe', helper: 'European telemetry fleet' },
];

type RegionAssignment = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  branch: string;
  telemetry_region: TelemetryRegion | null;
  is_active: boolean;
};

type RegionSummaryRow = {
  region: TelemetryRegion;
  machines: number;
  devices: number;
  users: number;
};

type RegionSummary = { regions?: RegionSummaryRow[] };

export function telemetryRegionLabel(region: TelemetryRegion | null | undefined) {
  return REGIONS.find((item) => item.value === region)?.label ?? 'Select region';
}

function normaliseAssignments(value: unknown): RegionAssignment[] {
  return Array.isArray(value) ? value as RegionAssignment[] : [];
}

export function TelemetryRegionSelector() {
  const { businessUser, userDetails, refreshProfile } = useAuth();
  const [managerOpen, setManagerOpen] = useState(false);
  const [assignments, setAssignments] = useState<RegionAssignment[]>([]);
  const [summary, setSummary] = useState<RegionSummaryRow[]>([]);
  const [loadingManager, setLoadingManager] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = userDetails?.role === 'admin' || userDetails?.role === 'operations';
  const region = userDetails?.telemetry_region ?? null;

  const reloadManager = useCallback(async () => {
    if (!canManage) return;
    setLoadingManager(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const [assignmentResult, summaryResult] = await Promise.all([
        client.rpc('get_telemetry_region_assignments'),
        client.rpc('get_telemetry_region_summary'),
      ]);
      if (assignmentResult.error) throw assignmentResult.error;
      if (summaryResult.error) throw summaryResult.error;
      setAssignments(normaliseAssignments(assignmentResult.data));
      const summaryData = (summaryResult.data ?? {}) as RegionSummary;
      setSummary(Array.isArray(summaryData.regions) ? summaryData.regions : []);
    } catch (managerError) {
      setError(managerError instanceof Error ? managerError.message : 'Could not load telemetry region assignments.');
    } finally {
      setLoadingManager(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (managerOpen) reloadManager().catch(() => undefined);
  }, [managerOpen, reloadManager]);

  const setMyRegion = async (nextRegion: TelemetryRegion) => {
    if (nextRegion === region) return;
    setSavingKey('self');
    setError(null);
    try {
      const { error: saveError } = await getSupabaseClient().rpc('set_my_telemetry_region', { p_region: nextRegion });
      if (saveError) throw saveError;
      await refreshProfile();
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not change telemetry region.');
      setSavingKey(null);
    }
  };

  const setUserRegion = async (userId: string, nextRegion: TelemetryRegion) => {
    setSavingKey(userId);
    setError(null);
    try {
      const { error: saveError } = await getSupabaseClient().rpc('set_user_telemetry_region', {
        p_user_id: userId,
        p_region: nextRegion,
      });
      if (saveError) throw saveError;
      await reloadManager();
      if (businessUser?.id === userId) {
        await refreshProfile();
        window.location.reload();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not assign telemetry region.');
    } finally {
      setSavingKey(null);
    }
  };

  if (!userDetails) {
    return <div className={styles.chip}><NavigationIcon kind="pin" /><span>Region unavailable</span></div>;
  }

  return (
    <>
      <div className={styles.selectorGroup}>
        {canManage ? (
          <label className={styles.selectChip}>
            <NavigationIcon kind="pin" />
            <span className={styles.srOnly}>Telemetry region</span>
            <select
              aria-label="Current telemetry region"
              disabled={savingKey === 'self'}
              onChange={(event) => setMyRegion(event.target.value as TelemetryRegion)}
              value={region ?? ''}
            >
              {!region ? <option value="" disabled>Select region</option> : null}
              {REGIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        ) : (
          <div className={styles.chip}><NavigationIcon kind="pin" /><span>{telemetryRegionLabel(region)}</span></div>
        )}
        {canManage ? <button className={styles.manageButton} onClick={() => setManagerOpen(true)} type="button">Manage regions</button> : null}
      </div>

      {managerOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManagerOpen(false); }}>
          <section aria-labelledby="region-manager-title" aria-modal="true" className={styles.dialog} role="dialog">
            <header className={styles.dialogHeader}>
              <div><span>Telemetry access</span><h2 id="region-manager-title">Region assignments</h2></div>
              <button aria-label="Close region assignments" onClick={() => setManagerOpen(false)} type="button">×</button>
            </header>

            <div className={styles.summaryGrid}>
              {REGIONS.map((regionItem) => {
                const row = summary.find((item) => item.region === regionItem.value);
                return <article key={regionItem.value}><strong>{regionItem.label}</strong><span>{Number(row?.machines ?? 0).toLocaleString('en-ZA')} machines</span><small>{Number(row?.devices ?? 0).toLocaleString('en-ZA')} devices · {Number(row?.users ?? 0).toLocaleString('en-ZA')} users</small></article>;
              })}
            </div>

            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            {loadingManager && !assignments.length ? <div className={styles.loading}>Loading region assignments…</div> : null}

            <div className={styles.assignmentList}>
              {assignments.map((assignment) => {
                const displayName = [assignment.first_name, assignment.last_name].filter(Boolean).join(' ').trim() || assignment.email;
                return (
                  <article className={styles.assignmentRow} key={assignment.user_id}>
                    <div><strong>{displayName}</strong><span>{assignment.email}</span><small>{assignment.role.replaceAll('_', ' ')} · {assignment.branch.toUpperCase()}{assignment.is_active ? '' : ' · inactive'}</small></div>
                    <label>
                      <span className={styles.srOnly}>{displayName} telemetry region</span>
                      <select
                        disabled={savingKey === assignment.user_id || !assignment.is_active}
                        onChange={(event) => setUserRegion(assignment.user_id, event.target.value as TelemetryRegion)}
                        value={assignment.telemetry_region ?? ''}
                      >
                        {!assignment.telemetry_region ? <option value="" disabled>Unassigned</option> : null}
                        {REGIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function TelemetryRegionRequired() {
  const { userDetails, refreshProfile } = useAuth();
  const [saving, setSaving] = useState<TelemetryRegion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (region: TelemetryRegion) => {
    setSaving(region);
    setError(null);
    try {
      const { error: saveError } = await getSupabaseClient().rpc('set_my_telemetry_region', { p_region: region });
      if (saveError) throw saveError;
      await refreshProfile();
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save telemetry region.');
      setSaving(null);
    }
  };

  return (
    <section className={styles.required} aria-labelledby="telemetry-region-required-title">
      <span>Telemetry access</span>
      <h1 id="telemetry-region-required-title">Choose your operating region</h1>
      <p>Your telemetry region determines which machines, devices, faults, vending data, maps, Test Center sessions and AI insights you can access. For normal users this choice is locked after selection.</p>
      <div className={styles.regionCards}>
        {REGIONS.map((region) => (
          <button disabled={Boolean(saving) || !userDetails} key={region.value} onClick={() => choose(region.value)} type="button">
            <strong>{region.label}</strong><span>{region.helper}</span><small>{saving === region.value ? 'Saving…' : 'Use this region'}</small>
          </button>
        ))}
      </div>
      {!userDetails ? <div className={styles.error}>Your DallmayrERP account profile is not provisioned yet. An Administrator must provision it before a telemetry region can be selected.</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
