'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, DonutChart, LineChart, StatStrip } from '@/components/ui/MiniCharts';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  DEFAULT_EXECUTIVE_KPIS,
  EXECUTIVE_KPI_CATALOG,
  nextReportRun,
  normaliseExecutiveKpis,
  type ExecutiveKpiKey,
  type ReportSchedule,
} from '@/lib/productivity/enterpriseFinish';
import { getSupabaseClient } from '@/lib/supabase/client';

type Branch = 'jhb' | 'cpt' | 'kzn' | 'national';

type Metrics = {
  customers: Record<Branch, number>;
  contracts: Record<Branch, number>;
  service: Record<Branch, number>;
  taskClosures: Record<Branch, number>;
  orders: Record<Branch, number>;
  stockScans: Record<Branch, number>;
  assets: number;
  documents: number;
};

type ActivityRow = { created_at?: string | null };

const KPI_STORAGE_KEY = 'dallmayrerp-executive-kpis-v1';
const SCHEDULE_STORAGE_KEY = 'dallmayrerp-report-schedules-v1';

const emptyMetrics: Metrics = {
  customers: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  contracts: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  service: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  taskClosures: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  orders: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  stockScans: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  assets: 0,
  documents: 0,
};

async function tableCount(table: string) {
  const { count } = await getSupabaseClient().from(table).select('*', { count: 'exact', head: true });
  return count ?? 0;
}

async function branchCount(table: string, branch: Branch, column = 'branch') {
  const { count } = await getSupabaseClient().from(table).select('*', { count: 'exact', head: true }).eq(column, branch);
  return count ?? 0;
}

function monthBuckets(now = new Date()) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      value: 0,
    };
  });
}

async function recentCreatedRows(table: string, fromIso: string): Promise<ActivityRow[]> {
  const { data, error } = await getSupabaseClient().from(table).select('created_at').gte('created_at', fromIso).limit(10000);
  if (error || !Array.isArray(data)) return [];
  return data as ActivityRow[];
}

function readSchedules(): ReportSchedule[] {
  const raw = safeLocalStorageGet(SCHEDULE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is ReportSchedule => Boolean(item) && typeof item === 'object' && typeof (item as ReportSchedule).id === 'string') : [];
  } catch {
    return [];
  }
}

export function ExecutiveReportingPanel() {
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [activityTrend, setActivityTrend] = useState(() => monthBuckets());
  const [selectedKpis, setSelectedKpis] = useState<ExecutiveKpiKey[]>(DEFAULT_EXECUTIVE_KPIS);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduleName, setScheduleName] = useState('Monthly executive management pack');
  const [scheduleCadence, setScheduleCadence] = useState<ReportSchedule['cadence']>('monthly');
  const [scheduleFormat, setScheduleFormat] = useState<ReportSchedule['format']>('pdf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    try {
      const [
        jhbCustomers, cptCustomers, kznCustomers,
        jhbContracts, cptContracts, kznContracts,
        jhbService, kznService,
        jhbClosures, cptClosures, kznClosures, nationalClosures,
        jhbOrders, cptOrders, kznOrders, nationalOrders,
        jhbScans, cptScans, kznScans, nationalScans,
        assets, docs,
      ] = await Promise.all([
        tableCount('customer_master_jhb'), tableCount('customer_master_cpt'), tableCount('customer_master_kzn'),
        tableCount('contract_agreement_jhb'), tableCount('contract_agreement_cpt'), tableCount('contract_agreement_kzn'),
        tableCount('service_call_log_jhb'), tableCount('service_call_log_kzn'),
        branchCount('task_closures', 'jhb'), branchCount('task_closures', 'cpt'), branchCount('task_closures', 'kzn'), branchCount('task_closures', 'national'),
        branchCount('delivery_orders', 'jhb'), branchCount('delivery_orders', 'cpt'), branchCount('delivery_orders', 'kzn'), branchCount('delivery_orders', 'national'),
        branchCount('stock_scan_events', 'jhb'), branchCount('stock_scan_events', 'cpt'), branchCount('stock_scan_events', 'kzn'), branchCount('stock_scan_events', 'national'),
        tableCount('fixed_assets'), tableCount('app_documents'),
      ]);

      setMetrics({
        customers: { jhb: jhbCustomers, cpt: cptCustomers, kzn: kznCustomers, national: 0 },
        contracts: { jhb: jhbContracts, cpt: cptContracts, kzn: kznContracts, national: 0 },
        service: { jhb: jhbService, cpt: 0, kzn: kznService, national: 0 },
        taskClosures: { jhb: jhbClosures, cpt: cptClosures, kzn: kznClosures, national: nationalClosures },
        orders: { jhb: jhbOrders, cpt: cptOrders, kzn: kznOrders, national: nationalOrders },
        stockScans: { jhb: jhbScans, cpt: cptScans, kzn: kznScans, national: nationalScans },
        assets,
        documents: docs,
      });

      const buckets = monthBuckets();
      const start = new Date();
      start.setMonth(start.getMonth() - 5, 1);
      start.setHours(0, 0, 0, 0);
      const rows = (await Promise.all([
        recentCreatedRows('task_closures', start.toISOString()),
        recentCreatedRows('delivery_orders', start.toISOString()),
        recentCreatedRows('stock_scan_events', start.toISOString()),
      ])).flat();
      const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
      rows.forEach((row) => {
        if (!row.created_at) return;
        const date = new Date(row.created_at);
        if (Number.isNaN(date.getTime())) return;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const bucket = byKey.get(key);
        if (bucket) bucket.value += 1;
      });
      setActivityTrend([...buckets]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load executive reporting metrics.');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMetrics();
    const savedKpis = safeLocalStorageGet(KPI_STORAGE_KEY);
    if (savedKpis) {
      try { setSelectedKpis(normaliseExecutiveKpis(JSON.parse(savedKpis))); } catch { setSelectedKpis(DEFAULT_EXECUTIVE_KPIS); }
    }
    setSchedules(readSchedules());
  }, []);

  const kpiValues = useMemo<Record<ExecutiveKpiKey, number>>(() => ({
    customers: metrics.customers.jhb + metrics.customers.cpt + metrics.customers.kzn,
    contracts: metrics.contracts.jhb + metrics.contracts.cpt + metrics.contracts.kzn,
    assets: metrics.assets,
    service: metrics.service.jhb + metrics.service.kzn,
    closures: Object.values(metrics.taskClosures).reduce((sum, value) => sum + value, 0),
    deliveries: Object.values(metrics.orders).reduce((sum, value) => sum + value, 0),
    documents: metrics.documents,
    stockScans: Object.values(metrics.stockScans).reduce((sum, value) => sum + value, 0),
  }), [metrics]);

  const selectedKpiData = selectedKpis.map((key) => ({
    label: EXECUTIVE_KPI_CATALOG.find((item) => item.key === key)?.label ?? key,
    value: kpiValues[key],
  }));

  function toggleKpi(key: ExecutiveKpiKey) {
    setSelectedKpis((current) => {
      const next = current.includes(key)
        ? current.length > 1 ? current.filter((item) => item !== key) : current
        : current.length < 6 ? [...current, key] : current;
      safeLocalStorageSet(KPI_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function saveSchedule() {
    const now = new Date();
    const schedule: ReportSchedule = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `schedule-${Date.now()}`,
      reportKey: 'executive-management-pack',
      name: scheduleName.trim() || 'Executive management pack',
      cadence: scheduleCadence,
      weekday: 1,
      dayOfMonth: 1,
      hour: 8,
      minute: 0,
      format: scheduleFormat,
      enabled: true,
      createdAt: now.toISOString(),
    };
    const next = [...schedules, schedule].slice(-12);
    setSchedules(next);
    safeLocalStorageSet(SCHEDULE_STORAGE_KEY, JSON.stringify(next));
  }

  function deleteSchedule(id: string) {
    const next = schedules.filter((schedule) => schedule.id !== id);
    setSchedules(next);
    safeLocalStorageSet(SCHEDULE_STORAGE_KEY, JSON.stringify(next));
  }

  function printManagementPack() {
    const previousTitle = document.title;
    document.title = `DallmayrERP Executive Management Pack ${new Date().toISOString().slice(0, 10)}`;
    window.print();
    window.setTimeout(() => { document.title = previousTitle; }, 0);
  }

  function exportSummaryCsv() {
    const rows = [
      ['Metric', 'Value'],
      ...EXECUTIVE_KPI_CATALOG.map((item) => [item.label, String(kpiValues[item.key])]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dallmayrerp-executive-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="neo-card spatial-card"><h2>Loading reporting metrics...</h2><p>Preparing branch and department dashboards.</p></div>;
  }

  return (
    <div className="grid spatial-stage spatial-dashboard" data-management-pack="executive">
      <style>{`@media print { .application-header, .desktop-navigation-rail, .mobile-quick-bar, .breadcrumbs, .connected-workflow-bar, [data-print-hide='true'] { display: none !important; } .application-main { margin: 0 !important; padding: 0 !important; } [data-management-pack='executive'] { display: block !important; } [data-management-pack='executive'] .card, [data-management-pack='executive'] .neo-card { break-inside: avoid; margin-bottom: 12px; } }`}</style>
      {error ? <div className="error">{error}</div> : null}

      <div className="page-header" data-print-hide="true">
        <div><h2>Executive management pack</h2><p>Configurable KPIs, operational trends, branch comparisons and saved report schedules.</p></div>
        <div className="action-row">
          <button className="button" onClick={printManagementPack} type="button">Print / Save PDF</button>
          <button className="button secondary" onClick={exportSummaryCsv} type="button">Export summary CSV</button>
          <button className="button secondary" onClick={loadMetrics} type="button">Refresh</button>
        </div>
      </div>

      <div className="card spatial-card" data-print-hide="true">
        <h3>Executive KPI configuration</h3>
        <p>Select up to six KPIs for this management pack. The choice is saved on this device.</p>
        <div className="grid grid-3">
          {EXECUTIVE_KPI_CATALOG.map((item) => (
            <label key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input checked={selectedKpis.includes(item.key)} onChange={() => toggleKpi(item.key)} type="checkbox" />
              <span><strong>{item.label}</strong><small style={{ display: 'block' }}>{item.description}</small></span>
            </label>
          ))}
        </div>
      </div>

      <StatStrip data={selectedKpiData} />

      <div className="grid grid-2">
        <LineChart title="Six-month captured activity trend" data={activityTrend} />
        <BarChart title="Customer master by branch" data={[{ label: 'JHB', value: metrics.customers.jhb }, { label: 'CPT', value: metrics.customers.cpt }, { label: 'KZN', value: metrics.customers.kzn }]} />
        <BarChart title="Contract volume by branch" data={[{ label: 'JHB', value: metrics.contracts.jhb }, { label: 'CPT', value: metrics.contracts.cpt }, { label: 'KZN', value: metrics.contracts.kzn }]} />
        <DonutChart title="Operational work captured" data={[{ label: 'Task closures', value: kpiValues.closures }, { label: 'Delivery orders', value: kpiValues.deliveries }, { label: 'Stock scans', value: kpiValues.stockScans }]} />
        <BarChart title="Digital activity by branch" data={[{ label: 'JHB', value: metrics.taskClosures.jhb + metrics.orders.jhb + metrics.stockScans.jhb }, { label: 'CPT', value: metrics.taskClosures.cpt + metrics.orders.cpt + metrics.stockScans.cpt }, { label: 'KZN', value: metrics.taskClosures.kzn + metrics.orders.kzn + metrics.stockScans.kzn }, { label: 'National', value: metrics.taskClosures.national + metrics.orders.national + metrics.stockScans.national }]} />
        <div className="card spatial-card">
          <h3>Management commentary</h3>
          <p>Use this pack for executive review of customer/contract scale, field execution, delivery throughput and stock activity. PDF output uses the browser's native print-to-PDF path so the report remains dependency-free.</p>
          <ul>
            <li>Customer and contract records: {kpiValues.customers.toLocaleString()} customers / {kpiValues.contracts.toLocaleString()} contracts</li>
            <li>Operational capture: {kpiValues.closures.toLocaleString()} closures / {kpiValues.deliveries.toLocaleString()} deliveries</li>
            <li>Digital evidence: {kpiValues.documents.toLocaleString()} documents / {kpiValues.stockScans.toLocaleString()} stock scans</li>
          </ul>
        </div>
      </div>

      <div className="card spatial-card" data-print-hide="true">
        <h3>Saved report schedules</h3>
        <p>Save recurring management-pack due dates. Schedules are intentionally local definitions; they do not claim unattended email delivery while no approved report-delivery worker exists.</p>
        <div className="grid grid-3">
          <label>Schedule name<input value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} /></label>
          <label>Cadence<select value={scheduleCadence} onChange={(event) => setScheduleCadence(event.target.value as ReportSchedule['cadence'])}><option value="weekly">Weekly · Monday 08:00</option><option value="monthly">Monthly · 1st 08:00</option></select></label>
          <label>Format<select value={scheduleFormat} onChange={(event) => setScheduleFormat(event.target.value as ReportSchedule['format'])}><option value="pdf">PDF management pack</option><option value="csv">CSV summary</option></select></label>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}><button className="button" onClick={saveSchedule} type="button">Save schedule</button></div>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {schedules.length ? schedules.map((schedule) => {
            const nextRun = nextReportRun(schedule);
            return (
              <div className="card" key={schedule.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div><strong>{schedule.name}</strong><small style={{ display: 'block' }}>{schedule.cadence} · {schedule.format.toUpperCase()} · next due {nextRun ? nextRun.toLocaleString() : 'disabled'}</small></div>
                <button className="button secondary" onClick={() => deleteSchedule(schedule.id)} type="button">Remove</button>
              </div>
            );
          }) : <p>No schedules saved yet.</p>}
        </div>
      </div>
    </div>
  );
}
