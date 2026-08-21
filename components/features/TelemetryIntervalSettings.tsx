'use client';

import { useCallback, useEffect, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';

type PolicyCode = 'live' | 'daily' | 'monthly';

type TelemetryPolicy = {
  id: string;
  policy_code: PolicyCode;
  name: string;
  mode: PolicyCode;
  counter_interval_minutes: number;
  heartbeat_interval_minutes: number;
  config_refresh_minutes: number;
  updated_at: string;
};

const order: PolicyCode[] = ['live', 'daily', 'monthly'];

function intervalLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

export function TelemetryIntervalSettings() {
  const [policies, setPolicies] = useState<TelemetryPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<PolicyCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_policy_intervals');
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as TelemetryPolicy[];
    rows.sort((a, b) => order.indexOf(a.policy_code) - order.indexOf(b.policy_code));
    setPolicies(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPolicies().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry intervals.');
      setLoading(false);
    });
  }, [loadPolicies]);

  function updatePolicy(code: PolicyCode, field: keyof Pick<TelemetryPolicy, 'counter_interval_minutes' | 'heartbeat_interval_minutes' | 'config_refresh_minutes'>, value: number) {
    setPolicies((current) => current.map((policy) => policy.policy_code === code
      ? { ...policy, [field]: Math.max(1, Math.floor(value || 1)) }
      : policy));
  }

  async function savePolicy(policy: TelemetryPolicy) {
    setSavingCode(policy.policy_code);
    setError(null);
    setMessage(null);
    const { data, error: saveError } = await getSupabaseClient().rpc('set_telemetry_policy_intervals', {
      p_policy_code: policy.policy_code,
      p_counter_interval_minutes: policy.counter_interval_minutes,
      p_heartbeat_interval_minutes: policy.heartbeat_interval_minutes,
      p_config_refresh_minutes: policy.config_refresh_minutes,
    });
    setSavingCode(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    const saved = data as TelemetryPolicy;
    setPolicies((current) => current.map((row) => row.policy_code === saved.policy_code ? saved : row));
    setMessage(`${saved.name} intervals were saved. Devices will receive them on their next configuration refresh.`);
  }

  return (
    <section className="fleet-route-page telemetry-interval-settings">
      <header className="fleet-page-heading">
        <div>
          <h1>Telemetry intervals</h1>
          <p>Set the database intervals used by devices and by the website to determine telemetry health.</p>
        </div>
        <button className="fleet-button secondary" disabled={loading} onClick={() => loadPolicies()} type="button">Refresh</button>
      </header>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Interval update failed.</strong><span>{error}</span></div> : null}
      {message ? <div className="fleet-banner is-success" role="status"><strong>Intervals updated.</strong><span>{message}</span></div> : null}

      <section className="fleet-panel">
        <div className="device-fleet-usage-heading">
          <div><span>Database policy</span><h2>Reporting-mode intervals</h2></div>
          <small>Online status allows two heartbeat intervals before a device is marked offline.</small>
        </div>

        {loading && policies.length === 0 ? <HamsterLoader label="Loading telemetry intervals" /> : (
          <div className="fleet-table-scroll">
            <table className="fleet-machine-table">
              <thead><tr><th>Mode</th><th>Counter upload</th><th>Heartbeat</th><th>Config refresh</th><th>Website offline after</th><th>Action</th></tr></thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.policy_code}>
                    <td><strong>{policy.name}</strong><span>{policy.policy_code}</span></td>
                    <td><input aria-label={`${policy.name} counter interval minutes`} min={1} onChange={(event) => updatePolicy(policy.policy_code, 'counter_interval_minutes', Number(event.target.value))} type="number" value={policy.counter_interval_minutes} /><span>{intervalLabel(policy.counter_interval_minutes)}</span></td>
                    <td><input aria-label={`${policy.name} heartbeat interval minutes`} min={1} onChange={(event) => updatePolicy(policy.policy_code, 'heartbeat_interval_minutes', Number(event.target.value))} type="number" value={policy.heartbeat_interval_minutes} /><span>{intervalLabel(policy.heartbeat_interval_minutes)}</span></td>
                    <td><input aria-label={`${policy.name} config refresh interval minutes`} max={1440} min={1} onChange={(event) => updatePolicy(policy.policy_code, 'config_refresh_minutes', Number(event.target.value))} type="number" value={policy.config_refresh_minutes} /><span>{intervalLabel(policy.config_refresh_minutes)}</span></td>
                    <td><strong>{intervalLabel(policy.heartbeat_interval_minutes * 2)}</strong><span>2 missed heartbeat windows</span></td>
                    <td><button className="fleet-button" disabled={savingCode !== null} onClick={() => savePolicy(policy)} type="button">{savingCode === policy.policy_code ? 'Saving…' : 'Save'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fleet-panel">
        <h2>How these intervals are used</h2>
        <p><strong>Counter upload</strong> controls normal sales/counter reporting. <strong>Heartbeat</strong> controls device presence. <strong>Config refresh</strong> controls how often a connected device checks for policy changes. The website reads the effective heartbeat interval from the same database policy instead of using a fixed 30-minute timeout.</p>
      </section>
    </section>
  );
}
