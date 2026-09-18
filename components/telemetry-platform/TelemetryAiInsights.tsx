'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryAiInsights.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';
type InsightSeverity = 'critical' | 'warning' | 'info' | 'opportunity';
type Insight = {
  severity: InsightSeverity;
  category: 'fleet_health' | 'faults' | 'connectivity' | 'sales' | 'data_usage' | 'sim_balance';
  title: string;
  evidence: string;
  recommended_action: string;
  machine_id: string | null;
  device_id: string | null;
};
type InsightPayload = {
  status: 'healthy' | 'watch' | 'action';
  summary: string;
  insights: Insight[];
  cached: boolean;
  generated_at: string;
  model?: string;
};
type GenerationLogRow = {
  id: string;
  scope_key: string;
  analysis_scope: 'fleet' | 'machine';
  machine_id: string | null;
  period: Period;
  model: string;
  event_type: 'success' | 'failure' | 'cache_hit';
  error_code: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_write_ok: boolean | null;
  complete_machine_sales: boolean | null;
  created_at: string;
};

const periods: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'six_months', label: 'Last 6 months' },
];

function categoryLabel(value: Insight['category']) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function generatedLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Generated recently';
  return `Generated ${date.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function activityTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}

function tokenCount(row: GenerationLogRow) {
  return (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
}

async function requestErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json() as { message?: unknown };
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
    } catch {
      // Fall through to the SDK error message if the response is not JSON.
    }
  }
  return error instanceof Error ? error.message : 'Could not generate AI telemetry insights.';
}

export function TelemetryAiInsights({ machineId }: { machineId?: string }) {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<InsightPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminActivity, setAdminActivity] = useState<GenerationLogRow[] | null>(null);
  const [adminActivityError, setAdminActivityError] = useState<string | null>(null);
  const machineScope = Boolean(machineId);

  const loadAdminActivity = useCallback(async () => {
    if (machineScope) return;
    try {
      const client = getSupabaseClient();
      const { data: currentRole, error: roleError } = await client.rpc('current_app_role');
      if (roleError || String(currentRole ?? '').toLowerCase() !== 'admin') {
        setAdminActivity(null);
        return;
      }

      const { data: rows, error: activityError } = await client
        .from('telemetry_ai_generation_log')
        .select('id,scope_key,analysis_scope,machine_id,period,model,event_type,error_code,duration_ms,input_tokens,output_tokens,cache_write_ok,complete_machine_sales,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (activityError) throw activityError;
      setAdminActivity((rows ?? []) as GenerationLogRow[]);
      setAdminActivityError(null);
    } catch (activityLoadError) {
      setAdminActivity([]);
      setAdminActivityError(activityLoadError instanceof Error ? activityLoadError.message : 'Could not load AI service activity.');
    }
  }, [machineScope]);

  useEffect(() => {
    void loadAdminActivity();
  }, [loadAdminActivity]);

  const adminStats = useMemo(() => {
    if (adminActivity === null) return null;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = adminActivity.filter((row) => new Date(row.created_at).getTime() >= cutoff);
    return {
      generations: recent.filter((row) => row.event_type === 'success').length,
      cacheHits: recent.filter((row) => row.event_type === 'cache_hit').length,
      failures: recent.filter((row) => row.event_type === 'failure').length,
      tokens: recent.reduce((sum, row) => sum + tokenCount(row), 0),
    };
  }, [adminActivity]);

  const generate = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const { data: result, error: invokeError } = await client.functions.invoke('telemetry-ai-insights', {
        body: { period, refresh, machine_id: machineId ?? null },
      });
      if (invokeError) throw new Error(await requestErrorMessage(invokeError));
      if (!result || typeof result !== 'object' || !Array.isArray(result.insights)) {
        throw new Error(result?.message ?? 'AI insights returned an unexpected response.');
      }
      setData(result as InsightPayload);
      if (!machineScope) void loadAdminActivity();
    } catch (requestError) {
      setError(await requestErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.panel} aria-label={machineScope ? 'AI machine telemetry insights' : 'AI fleet telemetry insights'} data-ai-telemetry-insights="v2">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Dallmayr AI</span>
          <h1>{machineScope ? 'Machine insights' : 'Telemetry insights'}</h1>
          <p>{machineScope ? 'AI analysis restricted to this machine and its linked telemetry devices.' : 'Operational analysis built only from telemetry available to your signed-in account.'}</p>
        </div>
        <div className={styles.actions}>
          <label>
            <span>Analysis period</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} disabled={loading}>
              {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={loading} onClick={() => generate(Boolean(data))}>
            {loading ? 'Analysing telemetry…' : data ? 'Refresh AI insights' : 'Generate AI insights'}
          </button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert"><strong>AI insight unavailable.</strong><span>{error}</span></div> : null}

      {!data && !loading ? (
        <div className={styles.empty}>
          <strong>AI analysis runs only when requested.</strong>
          <span>{machineScope ? 'Generate insights to review this machine’s connectivity, active faults, telemetry usage, SIM state, and the sales evidence currently available.' : 'Generate insights to review fleet health, faults, connectivity, vending performance, data usage, and SIM balance risks without adding API calls to normal dashboard refreshes.'}</span>
        </div>
      ) : null}

      {data ? (
        <div className={styles.content}>
          <div className={styles.summary}>
            <div>
              <span className={`${styles.status} ${styles[data.status]}`}>{data.status === 'action' ? 'Action required' : data.status === 'watch' ? 'Watch' : 'Healthy'}</span>
              <p>{data.summary}</p>
            </div>
            <small>{generatedLabel(data.generated_at)}{data.cached ? ' · cached result' : ''}</small>
          </div>

          <div className={styles.grid}>
            {data.insights.map((insight, index) => (
              <article className={`${styles.card} ${styles[insight.severity]}`} key={`${insight.category}-${insight.title}-${index}`}>
                <header><span>{categoryLabel(insight.category)}</span><strong>{insight.severity}</strong></header>
                <h2>{insight.title}</h2>
                <div className={styles.detail}><span>Evidence</span><p>{insight.evidence}</p></div>
                <div className={styles.detail}><span>Recommended action</span><p>{insight.recommended_action}</p></div>
                {insight.machine_id || insight.device_id ? <footer>{insight.machine_id ? `Machine ${insight.machine_id}` : ''}{insight.machine_id && insight.device_id ? ' · ' : ''}{insight.device_id ? `Device ${insight.device_id}` : ''}</footer> : null}
              </article>
            ))}
          </div>

          <p className={styles.advisory}>AI recommendations are advisory. Confirm faults and machine state in DallmayrERP before taking operational action.</p>
        </div>
      ) : null}

      {!machineScope && adminActivity !== null ? (
        <section className={styles.adminStatus} aria-label="AI service activity">
          <header className={styles.adminStatusHeader}>
            <div>
              <span>Administrator only</span>
              <h2>AI service activity</h2>
            </div>
            <button type="button" onClick={() => void loadAdminActivity()}>Refresh activity</button>
          </header>

          {adminActivityError ? <div className={styles.adminStatusError} role="alert">{adminActivityError}</div> : null}

          {adminStats ? (
            <div className={styles.adminMetrics}>
              <article><span>Generations · 24h</span><strong>{adminStats.generations}</strong></article>
              <article><span>Tokens · 24h</span><strong>{adminStats.tokens.toLocaleString('en-ZA')}</strong></article>
              <article><span>Cache hits · 24h</span><strong>{adminStats.cacheHits}</strong></article>
              <article className={adminStats.failures > 0 ? styles.failureMetric : ''}><span>Failures · 24h</span><strong>{adminStats.failures}</strong></article>
            </div>
          ) : null}

          {adminActivity.length ? (
            <div className={styles.activityTableWrap}>
              <table className={styles.activityTable}>
                <thead><tr><th>Time</th><th>Scope</th><th>Period</th><th>Model</th><th>Tokens</th><th>Result</th></tr></thead>
                <tbody>
                  {adminActivity.slice(0, 8).map((row) => (
                    <tr key={row.id}>
                      <td>{activityTime(row.created_at)}</td>
                      <td>{row.analysis_scope === 'machine' ? 'Machine' : 'Fleet'}</td>
                      <td>{periods.find((item) => item.value === row.period)?.label ?? row.period}</td>
                      <td>{row.model}</td>
                      <td>{tokenCount(row).toLocaleString('en-ZA')}</td>
                      <td><span className={`${styles.eventBadge} ${row.event_type === 'failure' ? styles.eventFailure : row.event_type === 'success' ? styles.eventSuccess : styles.eventCache}`}>{row.event_type === 'cache_hit' ? 'Cache hit' : row.event_type === 'success' ? 'Generated' : 'Failed'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={styles.noActivity}>No AI generations have been recorded yet.</p>}
        </section>
      ) : null}
    </section>
  );
}
