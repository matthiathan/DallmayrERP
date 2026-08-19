'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type Period = 'day' | 'week' | 'month' | 'six_months';
type Dataset = 'production' | 'simulation';
type Kind = 'all' | 'sale' | 'error';
type SortMode = 'newest' | 'error' | 'sales' | 'machine';
type Branch = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';

type ActivityRow = {
  activity_id: string;
  activity_type: 'sale' | 'error';
  occurred_at: string;
  activity_date: string;
  device_id: string;
  device_code: string | null;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  selection_code: string | null;
  product_name: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
  error_code: string | null;
  severity: string | null;
  detail: string | null;
  error_active: boolean;
  cleared_at: string | null;
};

type ActivityResponse = {
  period: Period;
  dataset: Dataset;
  date_from: string;
  date_to: string;
  total: number;
  limit: number;
  offset: number;
  summary: {
    sale_rows: number;
    units_sold: number;
    revenue_cents: number;
    error_events: number;
    active_errors: number;
  };
  rows: ActivityRow[];
};

const periodLabels: Record<Period, string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days',
  six_months: '6 months',
};

const branchLabels: Record<Branch, string> = {
  all: 'All branches',
  jhb: 'Johannesburg',
  cpt: 'Cape Town',
  kzn: 'KwaZulu-Natal',
  national: 'National',
};

const sortLabels: Record<SortMode, string> = {
  newest: 'Newest first',
  error: 'Errors first',
  sales: 'Highest sales first',
  machine: 'Machine A–Z',
};

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(numeric(cents) / 100);
}

function dateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function normalise(value: unknown): ActivityResponse {
  const source = (value ?? {}) as Partial<ActivityResponse>;
  const summary = source.summary ?? { sale_rows: 0, units_sold: 0, revenue_cents: 0, error_events: 0, active_errors: 0 };
  return {
    period: source.period ?? 'day',
    dataset: source.dataset ?? 'production',
    date_from: source.date_from ?? '',
    date_to: source.date_to ?? '',
    total: numeric(source.total),
    limit: numeric(source.limit) || 100,
    offset: numeric(source.offset),
    summary: {
      sale_rows: numeric(summary.sale_rows),
      units_sold: numeric(summary.units_sold),
      revenue_cents: numeric(summary.revenue_cents),
      error_events: numeric(summary.error_events),
      active_errors: numeric(summary.active_errors),
    },
    rows: (source.rows ?? []).map((row) => ({
      ...row,
      units_sold: numeric(row.units_sold),
      failed_vends: numeric(row.failed_vends),
      revenue_cents: numeric(row.revenue_cents),
      error_active: Boolean(row.error_active),
    })),
  };
}

export function TelemetryActivityLog() {
  const [period, setPeriod] = useState<Period>('day');
  const [dataset, setDataset] = useState<Dataset>('production');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<SortMode>('newest');
  const [branch, setBranch] = useState<Branch>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const direction = sort === 'machine' ? 'asc' : 'desc';

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const { data: result, error: loadError } = await getSupabaseClient().rpc('get_telemetry_activity', {
      p_period: period,
      p_branch: branch,
      p_dataset: dataset,
      p_kind: kind,
      p_search: search,
      p_sort: sort,
      p_direction: direction,
      p_limit: pageSize,
      p_offset: offset,
    });
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setData(normalise(result));
    setLastUpdated(new Date());
    setLoading(false);
  }, [branch, dataset, direction, kind, offset, pageSize, period, search, sort]);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry activity.');
      setLoading(false);
    });
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      load(true).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [branch, dataset, kind, pageSize, period, search, sort]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  const range = useMemo(() => {
    if (!data || data.total === 0) return '0 of 0';
    const first = data.offset + 1;
    const last = Math.min(data.offset + data.rows.length, data.total);
    return `${first.toLocaleString('en-ZA')}–${last.toLocaleString('en-ZA')} of ${data.total.toLocaleString('en-ZA')}`;
  }, [data]);

  const canPrevious = offset > 0;
  const canNext = Boolean(data && offset + data.rows.length < data.total);

  return (
    <section className="neo-card spatial-card">
      <div className="page-header">
        <div>
          <div className="badge">Sales &amp; errors</div>
          <h2>Telemetry activity log</h2>
          <p>Browse every stored sales aggregate and machine fault event for the selected period. Sorting is applied on the server before pagination, so it covers the complete result set rather than only the visible page.</p>
        </div>
        <div>
          <button className="button secondary" type="button" disabled={loading} onClick={() => load()}>Refresh</button>
          <div className="muted">Updated: {lastUpdated ? dateTime(lastUpdated.toISOString()) : 'Never'}</div>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
        <label>
          <span>Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            {(Object.keys(periodLabels) as Period[]).map((value) => <option key={value} value={value}>{periodLabels[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Dataset</span>
          <select value={dataset} onChange={(event) => setDataset(event.target.value as Dataset)}>
            <option value="production">Production telemetry</option>
            <option value="simulation">POC simulation</option>
          </select>
        </label>
        <label>
          <span>Show</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            <option value="all">All sales &amp; errors</option>
            <option value="sale">Sales only</option>
            <option value="error">Errors only</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            {(Object.keys(sortLabels) as SortMode[]).map((value) => <option key={value} value={value}>{sortLabels[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
            {(Object.keys(branchLabels) as Branch[]).map((value) => <option key={value} value={value}>{branchLabels[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Rows</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
          </select>
        </label>
      </div>

      <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          aria-label="Search telemetry activity"
          placeholder="Search machine, S/N, device, item, error code or detail"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          style={{ minWidth: 320, flex: '1 1 320px' }}
        />
        <button className="button secondary" type="submit">Search</button>
        {search ? <button className="button secondary" type="button" onClick={() => { setSearchInput(''); setSearch(''); }}>Clear</button> : null}
      </form>

      {loading && !data ? <HamsterLoader label="Loading sales and errors" /> : null}

      {data ? (
        <>
          <div className="grid grid-3 spatial-kpi-grid">
            <KpiCard label="Sales units" value={data.summary.units_sold} helper={`${data.date_from} to ${data.date_to}`} />
            <KpiCard label="Revenue" value={money(data.summary.revenue_cents)} helper={`${data.summary.sale_rows.toLocaleString('en-ZA')} stored sales row(s)`} />
            <KpiCard label="Error events" value={data.summary.error_events} helper={`${data.summary.active_errors.toLocaleString('en-ZA')} active`} />
          </div>

          {dataset === 'simulation' ? <div className="success">POC sales remain isolated from production. Safe simulation mode does not write real machine fault events.</div> : null}

          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Time</th>
                  <th>Machine</th>
                  <th>S/N</th>
                  <th>Device</th>
                  <th>Item / selection</th>
                  <th>Sales</th>
                  <th>Failed</th>
                  <th>Revenue</th>
                  <th>Error</th>
                  <th>Status / severity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.activity_id}>
                    <td><StatusBadge value={row.activity_type === 'error' ? 'error' : 'sale'} tone={row.activity_type === 'error' ? 'danger' : 'success'} /></td>
                    <td>{dateTime(row.occurred_at)}</td>
                    <td><strong>{row.machine_name ?? row.serial_number ?? 'Unassigned'}</strong><div className="muted">{row.branch}</div></td>
                    <td>{row.serial_number ?? '—'}</td>
                    <td>{row.device_code ?? '—'}</td>
                    <td>{row.activity_type === 'sale' ? <>{row.product_name ?? row.selection_code ?? 'Unknown'}<div className="muted">{row.selection_code ?? ''}</div></> : '—'}</td>
                    <td>{row.activity_type === 'sale' ? row.units_sold.toLocaleString('en-ZA') : '—'}</td>
                    <td>{row.activity_type === 'sale' ? row.failed_vends.toLocaleString('en-ZA') : '—'}</td>
                    <td>{row.activity_type === 'sale' ? money(row.revenue_cents) : '—'}</td>
                    <td>{row.error_code ?? '—'}</td>
                    <td>
                      {row.activity_type === 'error' ? (
                        <><StatusBadge value={row.error_active ? 'active' : 'cleared'} tone={row.error_active ? 'danger' : 'success'} /><div className="muted">{row.severity ?? 'unknown severity'}</div></>
                      ) : '—'}
                    </td>
                    <td>{row.detail ?? '—'}{row.cleared_at ? <div className="muted">Cleared: {dateTime(row.cleared_at)}</div> : null}</td>
                  </tr>
                ))}
                {!loading && data.rows.length === 0 ? <tr><td colSpan={12}>No telemetry activity matches these filters.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div className="muted">Showing {range}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button secondary" type="button" disabled={!canPrevious || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Previous</button>
              <button className="button secondary" type="button" disabled={!canNext || loading} onClick={() => setOffset((value) => value + pageSize)}>Next</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
