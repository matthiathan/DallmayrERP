'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import {
  InteractiveDonutChart,
  InteractiveHorizontalBars,
  type InteractiveChartDatum,
  type InteractiveDonutDatum,
} from '@/components/ui/InteractiveCharts';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './FleetAlertPulse.module.css';

type FaultRecord = {
  id: string;
  machine_id: string | null;
  fault_code: string;
  severity: string;
  detail: string | null;
  last_seen_at: string;
};

type DeviceState = {
  device_id: string;
  machine_id: string | null;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};

type DashboardPayload = {
  active_faults?: FaultRecord[];
  device_states?: DeviceState[];
};

function tone(value: string) {
  const severity = value.toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning' || severity === 'medium') return 'warning';
  if (severity === 'connectivity') return 'connectivity';
  return 'fault';
}

function connectionState(device: DeviceState) {
  const contact = device.last_heartbeat_at ?? device.last_seen_at;
  if (!contact) return 'offline';
  const age = Date.now() - new Date(contact).getTime();
  if (age <= 30 * 60 * 1000) return 'online';
  if (age <= 24 * 60 * 60 * 1000) return 'delayed';
  return 'offline';
}

function Kpi({ label, value, icon, status = 'neutral' }: {
  label: string;
  value: number;
  icon: Parameters<typeof NavigationIcon>[0]['kind'];
  status?: 'critical' | 'warning' | 'success' | 'neutral';
}) {
  return (
    <article className={`${styles.kpi} ${styles[`is_${status}`]}`}>
      <div><span>{label}</span><i><NavigationIcon kind={icon} /></i></div>
      <strong>{value.toLocaleString('en-ZA')}</strong>
    </article>
  );
}

export function FleetAlertPulse() {
  const [data, setData] = useState<DashboardPayload>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: payload, error } = await getSupabaseClient().rpc('get_telemetry_dashboard', {
      p_period: 'today',
      p_branch: 'all',
    });
    if (!error) {
      setData((payload ?? {}) as DashboardPayload);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
    const timer = window.setInterval(() => load().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const faults = data.active_faults ?? [];
  const devices = data.device_states ?? [];
  const severityCounts = faults.reduce((counts, fault) => {
    const key = tone(fault.severity);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const affectedMachines = new Set(faults.map((fault) => fault.machine_id).filter(Boolean)).size;
  const connectivityImpact = devices.filter((device) => connectionState(device) !== 'online').length;

  const severityData = useMemo<InteractiveChartDatum[]>(() => [
    { key: 'critical', label: 'Critical', value: severityCounts.critical ?? 0 },
    { key: 'fault', label: 'Faults', value: severityCounts.fault ?? 0 },
    { key: 'warning', label: 'Warnings', value: severityCounts.warning ?? 0 },
    { key: 'connectivity', label: 'Connectivity', value: severityCounts.connectivity ?? 0 },
  ].filter((row) => row.value > 0), [severityCounts.connectivity, severityCounts.critical, severityCounts.fault, severityCounts.warning]);

  const categoryData = useMemo<InteractiveDonutDatum[]>(() => {
    const categories = faults.reduce((counts, fault) => {
      const category = fault.fault_code.split(/[-_ ]/)[0] || 'Other';
      counts.set(category, (counts.get(category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
    return Array.from(categories.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([label, value]) => ({ key: label, label, value }));
  }, [faults]);

  return (
    <section className={styles.pulse} data-alert-pulse="v1" aria-label="Live alert pressure">
      <header className={styles.header}>
        <div>
          <span><i /> LIVE ALERT PRESSURE</span>
          <h2>Fleet exceptions at a glance</h2>
        </div>
        <small>{loading ? 'Loading…' : `Updated ${lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}`}</small>
      </header>

      <div className={styles.kpiGrid}>
        <Kpi icon="bell" label="Active alerts" status={faults.length ? 'critical' : 'success'} value={faults.length} />
        <Kpi icon="bell" label="Critical" status={(severityCounts.critical ?? 0) ? 'critical' : 'success'} value={severityCounts.critical ?? 0} />
        <Kpi icon="tool" label="Machines affected" status={affectedMachines ? 'warning' : 'success'} value={affectedMachines} />
        <Kpi icon="telemetry" label="Connectivity impact" status={connectivityImpact ? 'warning' : 'success'} value={connectivityImpact} />
      </div>

      <div className={styles.visualGrid}>
        <article className={styles.visualCard}>
          <header><span>Severity</span><strong>{faults.length.toLocaleString('en-ZA')}</strong></header>
          {severityData.length ? <InteractiveHorizontalBars ariaLabel="Active alerts by severity" data={severityData} valueLabel="alerts" /> : <div className={styles.clear}><NavigationIcon kind="bell" /><strong>Clear</strong><span>No active faults</span></div>}
        </article>
        <article className={styles.visualCard}>
          <header><span>Fault families</span><strong>{categoryData.length.toLocaleString('en-ZA')}</strong></header>
          {categoryData.length ? <InteractiveDonutChart ariaLabel="Active alerts by fault family" data={categoryData} valueLabel="alerts" /> : <div className={styles.clear}><NavigationIcon kind="chart" /><strong>Clear</strong><span>No fault categories</span></div>}
        </article>
      </div>
    </section>
  );
}
