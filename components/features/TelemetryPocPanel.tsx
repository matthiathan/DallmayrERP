'use client';

import { useCallback, useEffect, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type SimCounter = {
  selection?: string;
  product?: string;
  sold_total?: number;
  failed_total?: number;
  revenue_cents_total?: number;
};

type PocState = {
  device_id: string;
  device_code: string;
  hardware_uid: string | null;
  reported_machine_serial: string | null;
  machine_link_status: 'unlinked' | 'linked' | 'no_match' | 'ambiguous';
  machine_id: string | null;
  simulation_mode: boolean;
  simulated_counters: SimCounter[];
  last_simulation_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function linkTone(status: PocState['machine_link_status']) {
  if (status === 'linked') return 'success' as const;
  if (status === 'ambiguous') return 'warning' as const;
  if (status === 'no_match') return 'danger' as const;
  return undefined;
}

export function TelemetryPocPanel() {
  const [rows, setRows] = useState<PocState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_simulation_state');
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setRows(((data ?? []) as PocState[]).filter((row) => row.simulation_mode));
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load proof-of-concept telemetry.');
      setLoading(false);
    });
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [load]);

  if (!loading && rows.length === 0 && !error) return null;

  return (
    <section className="neo-card spatial-card">
      <div className="page-header">
        <div>
          <div className="badge">Safe proof of concept</div>
          <h2>Simulated live telemetry</h2>
          <p>These counters come from ESP32 simulation mode and are excluded from real daily sales aggregation.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => load()} type="button">Refresh</button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {loading && rows.length === 0 ? <HamsterLoader label="Loading POC telemetry" /> : null}

      {rows.map((row) => (
        <div className="neo-card" key={row.device_id} style={{ marginTop: 16 }}>
          <div className="page-header">
            <div>
              <h3>{row.device_code}</h3>
              <p>
                Hardware UID: {row.hardware_uid ?? 'Unknown'} · Reported machine S/N: {row.reported_machine_serial ?? 'Not supplied'}
              </p>
            </div>
            <div>
              <StatusBadge value={row.machine_link_status} tone={linkTone(row.machine_link_status)} />
              <div className="muted">Last update: {formatDate(row.last_simulation_at)}</div>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Selection</th>
                  <th>Product</th>
                  <th>Simulated sold</th>
                  <th>Failed</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(row.simulated_counters ?? []).map((counter, index) => (
                  <tr key={`${counter.selection ?? 'selection'}-${index}`}>
                    <td>{counter.selection ?? '—'}</td>
                    <td>{counter.product ?? '—'}</td>
                    <td>{Number(counter.sold_total ?? 0).toLocaleString('en-ZA')}</td>
                    <td>{Number(counter.failed_total ?? 0).toLocaleString('en-ZA')}</td>
                    <td>{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(counter.revenue_cents_total ?? 0) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
