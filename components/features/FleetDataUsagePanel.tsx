'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './FleetDataUsagePanel.module.css';

type DataUsageSummary = {
  device_id: string;
  request_count: number;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  projected_monthly_application_bytes: number;
  projected_monthly_device_application_bytes: number | null;
  projected_monthly_modem_bytes: number | null;
};

type PrepaidBalanceSummary = {
  device_id: string;
  device_code: string;
  remaining_bytes: number | null;
  query_status: string;
  is_stale: boolean;
  alert_level: 'unknown' | 'stale' | 'failed' | 'unsupported' | 'parse_failed' | 'depleted' | 'critical' | 'low' | 'ok';
};

function bytes(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** unit);
  return `${scaled.toFixed(unit === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[unit]}`;
}

function usageValue(row: DataUsageSummary) {
  if (Number(row.modem_sample_count ?? 0) > 0) return Number(row.measured_modem_bytes ?? 0);
  if (Number(row.device_application_sample_count ?? 0) > 0) return Number(row.device_application_bytes ?? 0);
  return Number(row.application_bytes ?? 0);
}

function projectedValue(row: DataUsageSummary) {
  if (Number(row.modem_sample_count ?? 0) > 0) return Number(row.projected_monthly_modem_bytes ?? 0);
  if (Number(row.device_application_sample_count ?? 0) > 0) return Number(row.projected_monthly_device_application_bytes ?? 0);
  return Number(row.projected_monthly_application_bytes ?? 0);
}

export function FleetDataUsagePanel() {
  const [usage, setUsage] = useState<DataUsageSummary[]>([]);
  const [balances, setBalances] = useState<PrepaidBalanceSummary[]>([]);
  const [usageAvailable, setUsageAvailable] = useState(true);
  const [balanceAvailable, setBalanceAvailable] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const client = getSupabaseClient();
    const [usageResult, balanceResult] = await Promise.all([
      client.rpc('get_telemetry_data_usage', { p_days: 30 }),
      client.rpc('get_telemetry_prepaid_balances'),
    ]);

    setUsageAvailable(!usageResult.error);
    setBalanceAvailable(!balanceResult.error);
    setUsage(usageResult.error ? [] : (usageResult.data ?? []) as DataUsageSummary[]);
    setBalances(balanceResult.error ? [] : (balanceResult.data ?? []) as PrepaidBalanceSummary[]);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const timer = window.setInterval(() => load().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const metrics = useMemo(() => {
    const observed = usage.reduce((sum, row) => sum + usageValue(row), 0);
    const projected = usage.reduce((sum, row) => sum + projectedValue(row), 0);
    const modemReporting = usage.filter((row) => Number(row.modem_sample_count ?? 0) > 0).length;
    const applicationReporting = usage.filter((row) => Number(row.device_application_sample_count ?? 0) > 0).length;
    const requestCount = usage.reduce((sum, row) => sum + Number(row.request_count ?? 0), 0);

    const reportedBalances = balances.filter((row) => row.remaining_bytes !== null && row.remaining_bytes !== undefined);
    const prepaidRemaining = reportedBalances.reduce((sum, row) => sum + Number(row.remaining_bytes ?? 0), 0);
    const topUps = balances.filter((row) => ['low', 'critical', 'depleted'].includes(row.alert_level));
    const stale = balances.filter((row) => row.is_stale || row.alert_level === 'stale').length;
    const unsupported = balances.filter((row) => row.alert_level === 'unsupported' || row.query_status === 'unsupported_modem_firmware').length;

    return {
      observed,
      projected,
      modemReporting,
      applicationReporting,
      requestCount,
      prepaidRemaining,
      prepaidReporting: reportedBalances.length,
      topUps,
      stale,
      unsupported,
    };
  }, [balances, usage]);

  const modemCoverage = usage.length ? Math.round((metrics.modemReporting / usage.length) * 100) : 0;
  const prepaidCoverage = balances.length ? Math.round((metrics.prepaidReporting / balances.length) * 100) : 0;

  return (
    <section className={styles.panel} data-fleet-usage-panel="v1">
      <header className={styles.header}>
        <div>
          <span>Connectivity economics</span>
          <h2>Data usage & prepaid balance</h2>
        </div>
        <Link href="/telemetry/devices"><NavigationIcon kind="telemetry" />Device detail</Link>
      </header>

      <div className={styles.metricGrid}>
        <article className={`${styles.metric} ${styles.isBlue}`}>
          <div><span>30-day transfer</span><NavigationIcon kind="telemetry" /></div>
          <strong>{usageAvailable ? bytes(metrics.observed) : 'Unavailable'}</strong>
          <small>{usage.length.toLocaleString('en-ZA')} devices reporting</small>
        </article>
        <article className={`${styles.metric} ${styles.isViolet}`}>
          <div><span>Monthly projection</span><NavigationIcon kind="chart" /></div>
          <strong>{usageAvailable ? bytes(metrics.projected) : 'Unavailable'}</strong>
          <small>{metrics.requestCount.toLocaleString('en-ZA')} accepted uploads</small>
        </article>
        <article className={`${styles.metric} ${metrics.topUps.length ? styles.isAmber : styles.isGreen}`}>
          <div><span>Prepaid remaining</span><NavigationIcon kind="finance" /></div>
          <strong>{balanceAvailable && metrics.prepaidReporting ? bytes(metrics.prepaidRemaining) : balanceAvailable ? 'Awaiting balance' : 'Unavailable'}</strong>
          <small>{metrics.topUps.length ? `${metrics.topUps.length} device${metrics.topUps.length === 1 ? '' : 's'} need top-up` : 'No reported top-ups required'}</small>
        </article>
      </div>

      <div className={styles.healthGrid}>
        <article className={styles.healthCard}>
          <div className={styles.healthHeading}><span>Modem counter coverage</span><strong>{modemCoverage}%</strong></div>
          <div className={styles.track}><i style={{ width: `${modemCoverage}%` }} /></div>
          <small>{metrics.modemReporting} modem-measured · {metrics.applicationReporting} device application counters</small>
        </article>
        <article className={styles.healthCard}>
          <div className={styles.healthHeading}><span>SIM balance coverage</span><strong>{prepaidCoverage}%</strong></div>
          <div className={styles.track}><i style={{ width: `${prepaidCoverage}%` }} /></div>
          <small>{metrics.prepaidReporting} balances · {metrics.stale} stale · {metrics.unsupported} unsupported</small>
        </article>
        <article className={styles.topUpCard}>
          <div><span>Balance risk</span><strong>{metrics.topUps.length}</strong></div>
          <div className={styles.riskDots} aria-label={`${metrics.topUps.length} devices require data top-up`}>
            {Array.from({ length: Math.min(metrics.topUps.length, 8) }, (_, index) => <i key={index} />)}
            {metrics.topUps.length === 0 ? <span>Healthy</span> : null}
          </div>
        </article>
      </div>

      <footer className={styles.footer}>
        <span>Uses modem counters where available, then device/application counters as fallback.</span>
        <span>Updated {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
      </footer>
    </section>
  );
}
