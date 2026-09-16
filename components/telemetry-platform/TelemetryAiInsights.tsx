'use client';

import { useState } from 'react';
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

export function TelemetryAiInsights() {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<InsightPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const { data: result, error: invokeError } = await client.functions.invoke('telemetry-ai-insights', {
        body: { period, refresh },
      });
      if (invokeError) throw invokeError;
      if (!result || typeof result !== 'object' || !Array.isArray(result.insights)) {
        throw new Error(result?.message ?? 'AI insights returned an unexpected response.');
      }
      setData(result as InsightPayload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not generate AI telemetry insights.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.panel} aria-label="AI telemetry insights" data-ai-telemetry-insights="v1">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Dallmayr AI</span>
          <h1>Telemetry insights</h1>
          <p>Operational analysis built only from telemetry available to your signed-in account.</p>
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
          <span>Generate insights to review fleet health, faults, connectivity, vending performance, data usage, and SIM balance risks without adding API calls to normal dashboard refreshes.</span>
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
    </section>
  );
}
