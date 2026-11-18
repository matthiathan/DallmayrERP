'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { ComparisonLineChart, type ComparisonPoint } from './ComparisonLineChart';
import { deviceConnectionState } from '@/lib/telemetry/device-health';
import { formatLocalDate } from '@/lib/dates/local-date';
import type { FleetAttentionDevice } from '@/lib/telemetry/fleet-attention';
import { loadDeviceHealthPolicies, withDeviceHealthPolicies } from '@/lib/telemetry/health-policy';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePagesResult } from '@/lib/supabase/collect-pages';
import { buildOverviewAttention, selectOverviewAttention, type OverviewFault, type OverviewAttentionItem, type OverviewMachine, type OverviewAttentionCategory } from '@/lib/telemetry/overview-attention';
import { maintenanceDayRange } from '@/lib/telemetry/overview-maintenance';
import { telemetryRegionLabel } from './TelemetryRegionSelector';
import styles from './TelevendFleetDashboard.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';

type Summary = {
  units_sold?: number;
  revenue_cents?: number;
  failed_vends?: number;
  active_machines?: number;
  reporting_devices?: number;
  online_devices?: number;
  offline_devices?: number;
  unassigned_devices?: number;
};

type TrendRow = { date: string; units_sold: number; revenue_cents: number; failed_vends: number };
type ProductRow = { product_key: string; product_name: string | null; sku: string | null; brand: string | null; units_sold: number; failed_vends: number; revenue_cents: number };
type MachineRow = { machine_id: string | null; machine_name: string | null; serial_number: string | null; units_sold: number; failed_vends: number; revenue_cents: number };
type SaleRow = { id: string; product_name: string | null; sku: string | null; selection_code: string; machine_name: string | null; serial_number: string | null; branch: string; units_sold: number; last_received_at: string };

type ReportingPayload = {
  date_from?: string;
  date_to?: string;
  summary?: Summary;
  daily_trend?: TrendRow[];
  top_items?: ProductRow[];
  top_machines?: MachineRow[];
  recent_sales?: SaleRow[];
};

type DeviceState = {
  device_id: string;
  machine_id: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  telemetry_mode: 'live' | 'daily' | 'monthly';
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};

type DashboardPayload = { device_states?: DeviceState[]; active_faults?: Array<{ id: string; severity: string; fault_code: string }> };
type FaultHistoryRow = { id: string; fault_code: string; severity: string; started_at: string; cleared_at: string | null };

type UsageRow = {
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

type BalanceRow = { device_id: string; remaining_bytes: number | null; alert_level: string; is_stale: boolean };

type FleetLocationRow = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  active_fault_count: number;
  last_seen_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  location_stale: boolean;
  has_location: boolean;
  communication_status: string | null;
  communication_error: boolean;
  minutes_overdue: number | null;
};

type MaintenancePreview = {
  rows?: Array<{ id: string; job_number: string; summary: string | null; status: string; due_at: string | null; assigned_to: string | null; machines?: { machine_name: string | null } | null }>;
  total?: number;
  summary?: { active_jobs?: number; in_progress?: number };
};

type ViewData = {
  report: ReportingPayload;
  history: ReportingPayload;
  dashboard: DashboardPayload;
  faultHistory: FaultHistoryRow[];
  usage: UsageRow[];
  balances: BalanceRow[];
  locations: FleetLocationRow[];
  attentionDevices: FleetAttentionDevice[] | null;
  machineCount: number;
  machines: OverviewMachine[];
  openFaults: OverviewFault[];
  maintenance: MaintenancePreview | null;
  maintenanceError: string | null;
};

const periods: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'six_months', label: 'Last 6 months' },
];

const ATTENTION_DEVICE_SELECT = 'id,device_code,machine_id,status,last_heartbeat_at,last_seen_at,last_upload_at,last_config_at,last_config_ack_at,last_transport,wifi_rssi,cellular_csq,cellular_operator';

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n(cents) / 100);
}

function bytes(value: number | null | undefined) {
  const amount = n(value);
  if (amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** unit);
  return `${scaled.toFixed(unit === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[unit]}`;
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' });
}

function timeAgo(value: string | null | undefined) {
  if (!value) return 'never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function usageValue(row: UsageRow) {
  if (n(row.modem_sample_count) > 0) return n(row.measured_modem_bytes);
  if (n(row.device_application_sample_count) > 0) return n(row.device_application_bytes);
  return n(row.application_bytes);
}

function projectedValue(row: UsageRow) {
  if (n(row.modem_sample_count) > 0) return n(row.projected_monthly_modem_bytes);
  if (n(row.device_application_sample_count) > 0) return n(row.projected_monthly_device_application_bytes);
  return n(row.projected_monthly_application_bytes);
}

function previousWindow(report: ReportingPayload, history: ReportingPayload) {
  if (!report.date_from || !report.date_to || !history.daily_trend?.length) return [] as TrendRow[];
  const from = new Date(`${report.date_from}T00:00:00`);
  const to = new Date(`${report.date_to}T00:00:00`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  if (days > 190) return [];
  const previousEnd = new Date(from);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  const startKey = formatLocalDate(previousStart);
  const endKey = formatLocalDate(previousEnd);
  return history.daily_trend.filter((row) => row.date >= startKey && row.date <= endKey);
}

function Metric({ label, value, helper, tone }: { label: string; value: string; helper: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'gold' }) {
  const toneClass = tone === 'blue' ? styles.metricBlue : tone === 'green' ? styles.metricGreen : tone === 'amber' ? styles.metricAmber : tone === 'gold' ? styles.metricGold : styles.metricRed;
  return <article className={`${styles.metric} ${toneClass}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

function Ring({ label, value, percent, tone, legend }: { label: string; value: number; percent: number; tone: 'red' | 'green' | 'amber'; legend: string[] }) {
  const ringClass = tone === 'green' ? styles.ringGreen : tone === 'amber' ? styles.ringAmber : styles.ringRed;
  return (
    <div className={styles.ringBlock}>
      <div className={`${styles.ring} ${ringClass}`} style={{ '--ring-value': `${Math.max(2, Math.min(100, percent))}%` } as CSSProperties}>
        <div className={styles.ringCenter}><span>{label}</span><strong>{value.toLocaleString('en-ZA')}</strong></div>
      </div>
      <div className={styles.ringLegend}>{legend.map((item) => <span key={item}><i />{item}</span>)}</div>
    </div>
  );
}

function Gauge({ title, value, percent, label }: { title: string; value: string; percent: number; label: string }) {
  return (
    <article className={`${styles.card} ${styles.gaugeCard}`}>
      <div className={styles.gaugeTitle}>{title}</div>
      <div className={styles.gauge}>
        <div className={styles.gaugeFill} style={{ '--gauge-value': `${Math.max(2, Math.min(100, percent))}%` } as CSSProperties} />
        <div className={styles.gaugeValue}><strong>{value}</strong><span>{label}</span></div>
      </div>
    </article>
  );
}

function attentionTitle(item: OverviewAttentionItem) {
  if (item.title) return item.title;
  if (item.kind === 'offline') return item.occurredAt ? 'Controller offline' : 'Controller has never reported';
  if (item.kind === 'config') return 'Configuration awaiting device ACK';
  if (item.kind === 'sim_balance') return item.balanceAlert === 'depleted' ? 'SIM balance depleted' : item.balanceAlert === 'critical' ? 'SIM balance critical' : 'SIM balance low';
  return item.lastTransport ? `${item.lastTransport === 'wifi' ? 'Wi-Fi' : 'Cellular'} signal not reported` : 'Network transport not reported';
}

function attentionDetail(item: OverviewAttentionItem) {
  if (item.reason) return item.reason;
  if (item.kind === 'offline') return item.occurredAt ? `Last confirmed device contact ${timeAgo(item.occurredAt)} ago.` : 'No heartbeat, upload, seen event, or configuration acknowledgement has been received.';
  if (item.kind === 'config') return `Configuration was sent ${timeAgo(item.occurredAt)} ago and has not been acknowledged.`;
  if (item.kind === 'sim_balance') return `${item.remainingBytes === null ? 'Balance not reported.' : bytes(item.remainingBytes) + ' remaining.'} ${item.balanceAlert === 'low' ? 'Plan a top-up.' : 'Top up this SIM now.'}`;
  return 'The controller is online, but its active network or signal strength has not been reported.';
}

export function TelevendFleetDashboard() {
  const { businessProfile, userDetails } = useAuth();
  const isClient = businessProfile?.user.account_scope === 'client';
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [machineType, setMachineType] = useState('');
  const [category, setCategory] = useState<OverviewAttentionCategory>('all');
  const [attentionPage, setAttentionPage] = useState(1);
  const [verificationPage, setVerificationPage] = useState(1);
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const loadVersion = useRef(0);
  const machineTypeColumnAvailable = useRef(true);
  const load = useCallback(async (quiet = false) => {
    const version = ++loadVersion.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const client = getSupabaseClient();
      const faultFrom = new Date();
      faultFrom.setDate(faultFrom.getDate() - 30);
      const faultFromBusinessDate = `${formatLocalDate(faultFrom)}T00:00:00+02:00`;

      const usageRows = collectSupabasePagesResult<UsageRow>(async (from, to) => {
        const { data, error: pageError } = await client.rpc('get_telemetry_data_usage', { p_days: 30 }).range(from, to);
        return { data: (data ?? []) as UsageRow[], error: pageError };
      });
      const balanceRows = collectSupabasePagesResult<BalanceRow>(async (from, to) => {
        const { data, error: pageError } = await client.rpc('get_telemetry_prepaid_balances').range(from, to);
        return { data: (data ?? []) as BalanceRow[], error: pageError };
      });
      const locationRows = collectSupabasePagesResult<FleetLocationRow>(async (from, to) => {
        const { data, error: pageError } = await client.rpc('get_telemetry_location_map').range(from, to);
        return { data: (data ?? []) as FleetLocationRow[], error: pageError };
      });
      const attentionDeviceRows = collectSupabasePagesResult<FleetAttentionDevice>(async (from, to) => {
        const { data, error: pageError } = await client
          .from('telemetry_devices')
          .select(ATTENTION_DEVICE_SELECT)
          .order('device_code', { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as FleetAttentionDevice[], error: pageError };
      });

      const machinesRows = collectSupabasePagesResult<OverviewMachine>(async (from, to) => {
        const contextFields = 'id,machine_name,customer_id,site_id,customers(customer_name),customer_sites(site_name)';
        let result = await client.from('machines')
          .select(machineTypeColumnAvailable.current ? `${contextFields},machine_type` : contextFields)
          .neq('status', 'retired').order('id').range(from, to).returns<OverviewMachine[]>();
        // Older deployments do not yet have the optional type column. Do not
        // infer a type from model names or suppress unrelated access failures.
        if (result.error?.code === '42703' && result.error.message.includes('machine_type')) {
          machineTypeColumnAvailable.current = false;
          result = await client.from('machines').select(contextFields).neq('status', 'retired').order('id').range(from, to).returns<OverviewMachine[]>();
        }
        return { data: (result.data ?? []).map((row) => ({ ...row, machine_type: row.machine_type ?? null })), error: result.error };
      });
      const openFaultRows = collectSupabasePagesResult<OverviewFault>(async (from, to) => {
        const { data, error: pageError } = await client.from('telemetry_fault_events')
          .select('id,device_id,machine_id,fault_code,severity,started_at,normalization_status,canonical_title,recommended_action').is('cleared_at', null)
          .order('id').range(from, to);
        return { data: (data ?? []) as OverviewFault[], error: pageError };
      });

      const day = maintenanceDayRange();
      const maintenanceRequest = isClient ? Promise.resolve({ data: null, error: null }) : client.rpc('get_telemetry_maintenance_directory', {
        p_search: '', p_status: 'active', p_priority: 'all', p_technician: 'all', p_offset: 0, p_limit: 3,
        p_from: day.from, p_until: day.until,
      });
      const [reportResult, historyResult, dashboardResult, faultResult, usageResult, balanceResult, locationResult, attentionDevicesResult, machineCountResult, policies, machinesResult, openFaultResult, maintenanceResult] = await Promise.all([
        client.rpc('get_telemetry_reporting', { p_period: period, p_branch: 'all', p_dataset: 'production' }),
        client.rpc('get_telemetry_reporting', { p_period: 'six_months', p_branch: 'all', p_dataset: 'production' }),
        client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
        client.from('telemetry_fault_events').select('id,fault_code,severity,started_at,cleared_at').gte('started_at', faultFromBusinessDate).order('started_at', { ascending: false }).limit(5000),
        usageRows,
        balanceRows,
        locationRows,
        attentionDeviceRows,
        client.from('machines').select('id', { count: 'exact', head: true }),
        loadDeviceHealthPolicies(),
        machinesRows,
        openFaultRows,
        maintenanceRequest,
      ]);

      const errors = [reportResult.error, historyResult.error, dashboardResult.error, faultResult.error, usageResult.error, balanceResult.error, locationResult.error, attentionDevicesResult.error, machineCountResult.error, machinesResult.error, openFaultResult.error].filter(Boolean);
      if (errors.length) throw new Error(errors[0]?.message ?? 'Could not load telemetry overview.');

      if (version !== loadVersion.current) return;
      setData({
        report: (reportResult.data ?? {}) as ReportingPayload,
        history: (historyResult.data ?? {}) as ReportingPayload,
        dashboard: (dashboardResult.data ?? {}) as DashboardPayload,
        faultHistory: faultResult.error ? [] : ((faultResult.data ?? []) as FaultHistoryRow[]),
        usage: usageResult.error ? [] : usageResult.data,
        balances: balanceResult.error ? [] : balanceResult.data,
        locations: locationResult.error ? [] : locationResult.data,
        attentionDevices: withDeviceHealthPolicies(attentionDevicesResult.data, policies),
        maintenance: maintenanceResult.error ? null : maintenanceResult.data as MaintenancePreview | null,
        maintenanceError: maintenanceResult.error?.message ?? null,
        machines: machinesResult.data,
        openFaults: openFaultResult.data,
        machineCount: machineCountResult.error ? 0 : (machineCountResult.count ?? 0),
      });
      setUpdated(new Date());
      setError(null);
    } catch (loadError) {
      if (version === loadVersion.current) setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry overview.');
    } finally { if (version === loadVersion.current) { setLoading(false); setRefreshing(false); } }
  }, [period, isClient]);

  useEffect(() => { load().catch((loadError) => { setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry overview.'); setLoading(false); setRefreshing(false); }); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const report = data?.report ?? {};
  const summary = report.summary ?? {};
  const currentTrend = useMemo<ComparisonPoint[]>(() => (report.daily_trend ?? []).map((row) => ({ key: row.date, label: shortDate(row.date), value: n(row.units_sold), detail: money(n(row.revenue_cents)) })), [report.daily_trend]);
  const previousTrendRows = useMemo(() => data ? previousWindow(data.report, data.history) : [], [data]);
  const previousTrend = useMemo<ComparisonPoint[]>(() => previousTrendRows.map((row) => ({ key: row.date, label: shortDate(row.date), value: n(row.units_sold), detail: money(n(row.revenue_cents)) })), [previousTrendRows]);

  const previousUnits = previousTrendRows.reduce((sum, row) => sum + n(row.units_sold), 0);
  const units = n(summary.units_sold);
  const revenue = n(summary.revenue_cents);
  const failed = n(summary.failed_vends);
  const attempts = units + failed;
  const success = attempts ? units / attempts * 100 : 100;
  const reportingDevices = (data?.attentionDevices ?? []).filter((device) => device.status === 'active').length;
  const connectionStates = (data?.attentionDevices ?? []).filter((device) => device.status === 'active').map((device) => deviceConnectionState(device, updated?.getTime() ?? 0));
  const online = connectionStates.filter((state) => state.key === 'online').length;
  const offline = connectionStates.filter((state) => state.key === 'offline').length;
  const delayed = connectionStates.filter((state) => state.key === 'delayed').length;
  const unknown = connectionStates.filter((state) => state.key === 'unknown' || state.key === 'never_seen').length;
  const availability = reportingDevices ? online / reportingDevices * 100 : 0;
  const periodChange = previousUnits > 0 ? ((units - previousUnits) / previousUnits) * 100 : 0;

  const faults = data?.faultHistory ?? [];
  const resolved = faults.filter((fault) => fault.cleared_at).length;
  const active = faults.length - resolved;
  const critical = faults.filter((fault) => !fault.cleared_at && fault.severity.toLowerCase() === 'critical').length;
  const warning = faults.filter((fault) => !fault.cleared_at && ['warning', 'medium'].includes(fault.severity.toLowerCase())).length;
  const resolvedRate = faults.length ? resolved / faults.length * 100 : 100;
  const activeRate = faults.length ? active / faults.length * 100 : 0;

  const usage = data?.usage ?? [];
  const balances = data?.balances ?? [];
  const observed = usage.reduce((sum, row) => sum + usageValue(row), 0);
  const projected = usage.reduce((sum, row) => sum + projectedValue(row), 0);
  const balanceRows = balances.filter((row) => row.remaining_bytes !== null && row.remaining_bytes !== undefined);
  const remaining = balanceRows.reduce((sum, row) => sum + n(row.remaining_bytes), 0);
  const lowBalance = balances.filter((row) => ['low', 'critical', 'depleted'].includes(row.alert_level)).length;
  const modemCoverage = usage.length ? Math.round(usage.filter((row) => n(row.modem_sample_count) > 0).length / usage.length * 100) : 0;

  const devices = data?.dashboard.device_states ?? [];
  const wifi = devices.filter((device) => device.last_transport === 'wifi').length;
  const cellular = devices.filter((device) => device.last_transport === 'cellular').length;
  const avgWifi = devices.map((device) => device.wifi_rssi).filter((value): value is number => typeof value === 'number').reduce((sum, value, _, array) => sum + value / array.length, 0);
  const avgCell = devices.map((device) => device.cellular_csq).filter((value): value is number => typeof value === 'number').reduce((sum, value, _, array) => sum + value / array.length, 0);

  const locations = data?.locations ?? [];
  const attentionUnavailable = Boolean(data && data.attentionDevices === null);
  const attentionItems = useMemo(() => buildOverviewAttention(
    data?.attentionDevices ?? [], data?.balances ?? [], data?.machines ?? [], data?.openFaults ?? [], updated?.getTime() ?? 0,
  ), [data?.attentionDevices, data?.balances, data?.machines, data?.openFaults, updated]);
  const machines = data?.machines ?? [];
  const selectedAttention = selectOverviewAttention(attentionItems, machines, { customerId, siteId, machineType, category });
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));
  const relation = <T,>(value: T | T[] | null | undefined) => Array.isArray(value) ? value[0] : value;
  const customerOptions = [...new Map(machines.filter((machine) => machine.customer_id).map((machine) => [machine.customer_id!, relation(machine.customers)?.customer_name ?? 'Customer name not reported'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const siteOptions = [...new Map(machines.filter((machine) => machine.site_id && (!customerId || machine.customer_id === customerId)).map((machine) => [machine.site_id!, relation(machine.customer_sites)?.site_name ?? 'Site name not reported'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const typeOptions = [...new Set(machines.flatMap((machine) => machine.machine_type ? [machine.machine_type] : []))].sort();
  const resetPages = () => { setAttentionPage(1); setVerificationPage(1); };
  const actionablePages = Math.max(1, Math.ceil(selectedAttention.actionable.length / 8));
  const verificationPages = Math.max(1, Math.ceil(selectedAttention.verification.length / 8));
  const currentAttentionPage = Math.min(attentionPage, actionablePages);
  const currentVerificationPage = Math.min(verificationPage, verificationPages);
  useEffect(() => { setAttentionPage((page) => Math.min(page, actionablePages)); }, [actionablePages]);
  useEffect(() => { setVerificationPage((page) => Math.min(page, verificationPages)); }, [verificationPages]);
  const locationByDevice = useMemo(
    () => new Map((data?.locations ?? []).map((location) => [location.device_id, location])),
    [data?.locations],
  );
  const machineCount = data?.machineCount ?? 0;
  const assignedDevices = locations.filter((row) => Boolean(row.machine_id)).length;
  const mappedDevices = locations.filter((row) => row.has_location && typeof row.latitude === 'number' && typeof row.longitude === 'number').length;
  const staleLocations = locations.filter((row) => row.has_location && row.location_stale).length;
  const communicationErrors = locations.filter((row) => row.communication_error).length;
  const unknownNetwork = Math.max(0, devices.length - wifi - cellular);
  const assignmentCoverage = machineCount ? Math.min(100, assignedDevices / machineCount * 100) : 0;
  const locationCoverage = reportingDevices ? Math.min(100, mappedDevices / reportingDevices * 100) : 0;
  const networkCoverage = devices.length ? Math.min(100, (wifi + cellular) / devices.length * 100) : 0;
  const communicationHealth = locations.length ? Math.max(0, 100 - communicationErrors / locations.length * 100) : 0;

  const topProducts = report.top_items ?? [];
  const recentSales = report.recent_sales ?? [];

  const exportFleetSnapshot = () => {
    if (!locations.length) return;
    const usageByDevice = new Map(usage.map((row) => [row.device_id, row]));
    const balanceByDevice = new Map(balances.map((row) => [row.device_id, row]));
    const headers = [
      'Device', 'Machine', 'Serial', 'Branch', 'Communication', 'Minutes overdue', 'Transport',
      'Latitude', 'Longitude', 'Location source', 'Location stale', 'Active faults',
      '30-day data bytes', 'Prepaid remaining bytes', 'Last seen',
    ];
    const body = locations.map((row) => {
      const usageRow = usageByDevice.get(row.device_id);
      const balance = balanceByDevice.get(row.device_id);
      return [
        row.device_code,
        row.machine_name ?? '',
        row.serial_number ?? '',
        row.branch,
        row.communication_status ?? (row.communication_error ? 'offline' : ''),
        row.minutes_overdue ?? '',
        row.last_transport ?? '',
        row.latitude ?? '',
        row.longitude ?? '',
        row.location_source ?? '',
        row.location_stale,
        row.active_fault_count,
        usageRow ? usageValue(usageRow) : '',
        balance?.remaining_bytes ?? '',
        row.last_seen_at ?? '',
      ];
    });
    const csv = [headers, ...body].map((line) => line.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dallmayr-fleet-snapshot-${formatLocalDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  function renderQueuePagination(label: string, page: number, pages: number, setPage: (value: number) => void) {
    return <nav className={styles.queuePagination} aria-label={`${label} pages`}>
      <button className="button secondary" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>{label} · Page {page} of {pages}</span>
      <button className="button secondary" type="button" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
    </nav>;
  }

  function renderAttentionItem(item: OverviewAttentionItem) {
    const location = locationByDevice.get(item.deviceId);
    const machineId = item.machineId ?? (['fault', 'raw_fault', 'diagnostic'].includes(item.kind) ? null : location?.machine_id) ?? null;
    const machine = machineId ? machineById.get(machineId) : undefined;
    const machineName = machine?.machine_name ?? location?.machine_name ?? location?.serial_number ?? (machineId ? 'Linked machine' : 'Unassigned device');
    return <article className={styles.attentionRow} key={item.id}>
      <span className={`${styles.attentionIcon} ${item.severity === 'critical' ? styles.attentionCritical : styles.attentionWarning}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{item.kind === 'delayed' ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></> : <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/></>}</svg></span>
      <div className={styles.attentionBody}>
        <div><strong>{attentionTitle(item)}</strong><span>{machineName} · {item.deviceCode}</span></div>
        <p>{attentionDetail(item)}</p>
        <small>{relation(machine?.customers)?.customer_name ?? 'Customer not reported'} · {relation(machine?.customer_sites)?.site_name ?? 'Site not reported'}</small>
        <small>Evidence time: {item.occurredAt ? new Date(item.occurredAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) + ' SAST' : 'Not reported'}</small>
      </div>
      <nav className={styles.attentionActions} aria-label={`${item.deviceCode} actions`}>
        {machineId ? <Link href={`/machines/${machineId}`}>Open machine</Link> : null}
        {!isClient && item.deviceId && item.deviceCode !== 'Device identifier unavailable' ? <details className={styles.attentionTools}><summary>Device tools</summary>
          <Link href={`/telemetry/devices?device=${encodeURIComponent(item.deviceCode)}`}>Device</Link>
          <Link href={`/telemetry/test-center?device=${encodeURIComponent(item.deviceCode)}`}>Test Center</Link>
        </details> : null}
      </nav>
    </article>;
  }

  return (
    <section className={styles.dashboard} data-fleet-dashboard="televend-v3">
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}><i /><div><h1>Fleet overview</h1><span>Start with the machines and work that need your attention.</span></div></div>
        <div className={styles.toolbarActions}>
          <button className="button secondary" disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          {!isClient ? <Link className="button" href="/maintenance">Open maintenance</Link> : null}
        </div>
      </div>

      {error ? <div className={styles.error} role="alert">Dashboard updates unavailable: {error} Displayed information may be outdated. Last successful refresh: {updated ? updated.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : 'never'}.</div> : null}
      {loading && !data ? <HamsterLoader label="Loading fleet overview" /> : null}

      {data ? <>


        <div className={styles.overviewGrid}>
        <section className={styles.attentionCard} aria-label="Fleet attention queue" data-fleet-attention-queue="v1">
          <header className={styles.attentionHeader}>
            <div><h2>Needs attention</h2><p>Confirmed faults and device contact issues</p></div>
            <strong className={styles.attentionCount}>{selectedAttention.actionable.length} {selectedAttention.actionable.length === 1 ? 'issue' : 'issues'}</strong>
          </header>
          <details className={styles.filterDisclosure}><summary>Filter machines needing attention</summary>
          <div className={styles.attentionFilters}>
            <label>Customer<select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSiteId(''); resetPages(); }}><option value="">All customers</option>{customerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Site<select value={siteId} onChange={(event) => { setSiteId(event.target.value); resetPages(); }}><option value="">All sites</option>{siteOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Machine type<select value={machineType} onChange={(event) => { setMachineType(event.target.value); resetPages(); }}><option value="">All types</option><option value="__not_reported__">Not reported</option>{typeOptions.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label>Attention category<select value={category} onChange={(event) => { setCategory(event.target.value as OverviewAttentionCategory); resetPages(); }}><option value="all">All attention</option><option value="fault">Reported faults</option><option value="connectivity">Offline / delayed devices</option><option value="verification">Needs verification</option><option value="device">Device / SIM settings</option></select></label>
            <button className="button secondary" type="button" onClick={() => { setCustomerId(''); setSiteId(''); setMachineType(''); setCategory('all'); resetPages(); }}>Clear filters</button>
          </div>
          {!typeOptions.length ? <p className={styles.scopeNote}>Machine type is not reported for this fleet. Types are not inferred from machine names.</p> : null}
          </details>
          {customerId || siteId || machineType || category !== 'all' ? <p className={styles.scopeNote} role="status">Attention list: {telemetryRegionLabel(userDetails?.telemetry_region)} · {customerId ? customerOptions.find(([id]) => id === customerId)?.[1] ?? 'Selected customer unavailable' : 'All customers'} · {siteId ? siteOptions.find(([id]) => id === siteId)?.[1] ?? 'Selected site unavailable' : 'All sites'} · {machineType === '__not_reported__' ? 'Machine type not reported' : machineType || 'All machine types'}. Filters apply to this list; charts below describe the full regional fleet.</p> : null}
          {attentionUnavailable ? <div className={styles.attentionEmpty}>Current device attention could not be loaded.</div> : <>
            <div className={styles.attentionList}>{selectedAttention.actionable.slice((currentAttentionPage - 1) * 8, currentAttentionPage * 8).map(renderAttentionItem)}</div>
            {!selectedAttention.actionable.length ? <div className={styles.attentionEmpty}>No actionable issues match these filters. Check Needs verification for missing evidence.</div> : null}
            {actionablePages > 1 ? renderQueuePagination('Actionable issues', currentAttentionPage, actionablePages, setAttentionPage) : null}
            <details className={styles.verification}>
              <summary>Needs verification · {selectedAttention.verification.length} evidence gaps</summary>
              <p>Unknown does not mean faulty. These machines or devices need evidence before their condition can be established.</p>
              <div className={styles.attentionList}>{selectedAttention.verification.slice((currentVerificationPage - 1) * 8, currentVerificationPage * 8).map(renderAttentionItem)}</div>
              {!selectedAttention.verification.length ? <div className={styles.attentionEmpty}>No evidence gaps match these filters.</div> : null}
              {verificationPages > 1 ? renderQueuePagination('Evidence gaps', currentVerificationPage, verificationPages, setVerificationPage) : null}
            </details>
          </>}
        </section>
          {!isClient ? <aside className={styles.maintenancePreview} aria-label="Today’s maintenance">
            <header><div><h2>Today’s maintenance</h2><p>Due or reported today</p></div>{typeof data.maintenance?.total === 'number' ? <small>{data.maintenance.total.toLocaleString('en-ZA')} jobs</small> : null}</header>
            {data.maintenanceError || !data.maintenance ? <p className={styles.maintenanceEmpty}>Maintenance summary unavailable. Open Maintenance to retry.</p> : data.maintenance?.rows?.length ? data.maintenance.rows.map((job) => <div className={styles.maintenanceJob} key={job.id}>
              <div><strong>{job.machines?.machine_name || job.job_number}</strong><p>{job.summary || 'Maintenance visit'}</p><small>{job.assigned_to ? 'Assigned technician' : 'Unassigned'} · {job.due_at ? new Date(job.due_at).toLocaleTimeString('en-ZA', {timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit'}) : 'Not scheduled'}</small></div>
              <span>{job.status.replaceAll('_', ' ')}</span>
            </div>) : <p className={styles.maintenanceEmpty}>No active jobs due or reported today.</p>}
            {data.maintenance && n(data.maintenance.total) > (data.maintenance.rows?.length ?? 0) ? <p className={styles.scopeNote}>Showing {data.maintenance.rows?.length ?? 0} of {n(data.maintenance.total)} jobs. Open Maintenance for the full list.</p> : null}
            <Link href="/maintenance">Open Maintenance →</Link>
          </aside> : <aside className={styles.quickAccess}><h2>Quick access</h2><p>Open your machines and reports.</p><Link className="button secondary" href="/machines">Find a machine →</Link><Link className="button secondary" href="/telemetry/reports">Sales &amp; Reports →</Link></aside>}
        </div>

        <section className={styles.metricsStrip} aria-label="Regional fleet headline metrics">
          <Metric helper="Across the selected region" label="Machines" tone="blue" value={machineCount.toLocaleString('en-ZA')} />
          <Metric helper={`${delayed} delayed · ${offline} offline · ${unknown} unknown / never seen`} label="Devices online" tone="green" value={online.toLocaleString('en-ZA')} />
          <Metric helper={data.maintenance ? `${n(data.maintenance.summary?.in_progress)} in progress` : 'Summary unavailable'} label="Open maintenance jobs" tone="gold" value={data.maintenance ? n(data.maintenance.summary?.active_jobs).toLocaleString('en-ZA') : 'Not reported'} />
          <Metric helper={`${periods.find((item) => item.value === period)?.label} · completeness Unknown`} label="Products recorded" tone="blue" value={units.toLocaleString('en-ZA')} />
        </section>

        <section className={styles.overviewGrid}>
          <article className={`${styles.card} ${styles.primarySales}`}>
            <header className={styles.cardHeader}><div><h2>{period === 'week' ? 'Sales over seven days' : 'Recorded product sales'}</h2><span>{units.toLocaleString('en-ZA')} products · {periods.find((item) => item.value === period)?.label}</span></div><Link href="/telemetry/reports">Sales &amp; Reports →</Link></header>
            {currentTrend.length ? <div className={styles.salesBars} role="img" aria-label={`Recorded products per day: ${currentTrend.map((point) => `${point.label}: ${point.value}`).join(', ')}`}>{currentTrend.map((point) => <div className={styles.salesBarColumn} key={point.key}><strong>{point.value.toLocaleString('en-ZA')}</strong><i style={{height: `${point.value / Math.max(1, ...currentTrend.map((row) => row.value)) * 100}px`}} /><span>{point.label}</span></div>)}</div> : <p className={styles.maintenanceEmpty}>No recorded sales counters for this period. Report completeness is Unknown.</p>}
            <p className={styles.scopeNote}>Products recorded per day · received counters do not establish a complete report.</p>
          </article>
          <aside className={styles.quickAccess} aria-label="Common fleet tasks">
            <h2>Quick access</h2>
            <p>Common tasks, without the detour.</p>
            {!isClient ? <Link className="button secondary" href="/maintenance">Manage maintenance <span aria-hidden="true">→</span></Link> : null}
            <Link className="button secondary" href="/machines">Find a machine <span aria-hidden="true">→</span></Link>
            <Link className="button secondary" href="/telemetry/reports">Sales &amp; reports <span aria-hidden="true">→</span></Link>
            <small>Device contact, machine communication and sales completeness are independent indicators.</small>
          </aside>
        </section>
        <details className={styles.advancedDetails}>
          <summary>More fleet details &amp; report controls</summary>
        <div className={styles.toolbarActions}>
          <label><span>Sales period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button disabled={!locations.length} onClick={exportFleetSnapshot} type="button">Export fleet CSV</button>
          <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <section className={styles.telemetryRow} aria-label="Fleet operational readiness">
          <article className={styles.telemetryCard}><header><span>Machine-device linking</span><strong>{assignedDevices.toLocaleString('en-ZA')} / {machineCount.toLocaleString('en-ZA')}</strong></header><div className={styles.meter}><i style={{ width: `${assignmentCoverage}%` }} /></div><small>{n(summary.unassigned_devices).toLocaleString('en-ZA')} active devices unassigned · <Link href="/telemetry/devices">Device management ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Map coverage</span><strong>{locationCoverage.toFixed(0)}%</strong></header><div className={styles.meter}><i style={{ width: `${locationCoverage}%` }} /></div><small>{mappedDevices.toLocaleString('en-ZA')} devices located · {staleLocations.toLocaleString('en-ZA')} stale · <Link href="/map">Fleet map ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Device reporting deadlines</span><strong>{communicationErrors.toLocaleString('en-ZA')} overdue</strong></header><div className={styles.meter}><i style={{ width: `${communicationHealth}%` }} /></div><small>Uses each device reporting schedule · <Link href="/machines">Investigate machines ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Network visibility</span><strong>{networkCoverage.toFixed(0)}%</strong></header><div className={styles.meter}><i style={{ width: `${networkCoverage}%` }} /></div><small>{wifi} Wi-Fi · {cellular} cellular · {unknownNetwork} unknown</small></article>
        </section>

        <section className={styles.grid}>
          <article className={`${styles.card} ${styles.trendCard}`}>
            <header className={`${styles.cardHeader} ${styles.cardHeaderRed}`}><div><span>{periods.find((item) => item.value === period)?.label}</span><h2>Sales metrics</h2></div><strong>{units.toLocaleString('en-ZA')} vends</strong></header>
            <div className={styles.cardBody}>{currentTrend.length ? <ComparisonLineChart current={currentTrend} currentLabel="This period" previous={previousTrend} previousLabel="Previous period" valueLabel="vends" /> : <div className={styles.empty}>No sales counters for this period.</div>}</div>
            <footer className={styles.cardFooter}><span>Total revenue</span><strong>{money(revenue)} <em>{periodChange >= 0 ? '+' : ''}{periodChange.toFixed(1)}%</em></strong></footer>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Vends</span><h2>Top products</h2></div><Link href="/products">Full report ›</Link></header>
            <div className={styles.topProducts}>
              <div className={styles.productHeader}><span>#</span><span>Product</span><span>Vends</span><span>Failed</span></div>
              {topProducts.slice(0, 10).map((product, index) => {
                const failRate = n(product.units_sold) + n(product.failed_vends) ? n(product.failed_vends) / (n(product.units_sold) + n(product.failed_vends)) * 100 : 0;
                return <div className={styles.productRow} key={product.product_key}><b>{index + 1}</b><span className={styles.productName}>{product.product_name ?? product.sku ?? product.product_key}</span><span className={styles.productValue}>{n(product.units_sold).toLocaleString('en-ZA')}</span><span className={`${styles.productTrend} ${failRate > 2 ? styles.productTrendDown : ''}`}>{failRate.toFixed(1)}%</span></div>;
              })}
              {!topProducts.length ? <div className={styles.empty}>No product counters yet.</div> : null}
            </div>
            <footer className={styles.cardFooter}><span>Total products</span><strong>{topProducts.length.toLocaleString('en-ZA')}</strong></footer>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Fault activity · 30 days</span><h2>Alerts</h2></div><Link href="/alerts">All alerts ›</Link></header>
            <div className={styles.alarmGrid}>
              <Ring label="Active" legend={[`${critical} critical`, `${warning} warning`, `${Math.max(0, active - critical - warning)} other`]} percent={activeRate} tone="red" value={active} />
              <Ring label="Resolved" legend={[`${resolved} cleared`, `${Math.max(0, faults.length - resolved)} open`, `${faults.length} raised`]} percent={resolvedRate} tone="green" value={resolved} />
            </div>
          </article>

          <div className={styles.gaugeStack}>
            <Gauge label={`${online} of ${Math.max(reportingDevices, 1)} devices`} percent={availability} title="Fleet availability" value={`${availability.toFixed(0)}%`} />
            <Gauge label={`${units.toLocaleString('en-ZA')} successful vends`} percent={success} title="Vend success performance" value={attempts ? `${success.toFixed(0)}%` : 'Not reported'} />
          </div>
        </section>

        <section className={styles.telemetryRow} aria-label="Connectivity and data usage">
          <article className={styles.telemetryCard}><header><span>30-day data transfer</span><strong>{bytes(observed)}</strong></header><div className={styles.meter}><i style={{ width: `${Math.min(100, modemCoverage)}%` }} /></div><small>{modemCoverage}% modem-counter coverage</small></article>
          <article className={styles.telemetryCard}><header><span>Monthly projection</span><strong>{bytes(projected)}</strong></header><div className={styles.meter}><i style={{ width: `${Math.min(100, projected ? observed / projected * 100 : 0)}%` }} /></div><small>{usage.reduce((sum, row) => sum + n(row.request_count), 0).toLocaleString('en-ZA')} accepted uploads</small></article>
          <article className={styles.telemetryCard}><header><span>Prepaid remaining</span><strong>{balanceRows.length ? bytes(remaining) : 'Awaiting data'}</strong></header><div className={styles.meter}><i style={{ width: `${lowBalance ? 35 : balanceRows.length ? 100 : 0}%` }} /></div><small>{lowBalance ? `${lowBalance} SIMs need top-up` : 'No reported top-up risk'}</small></article>
          <article className={styles.telemetryCard}><header><span>Network mix</span><strong>{wifi} Wi-Fi · {cellular} cellular</strong></header><div className={styles.meter}><i style={{ width: `${devices.length ? wifi / devices.length * 100 : 0}%` }} /></div><small>{avgWifi ? `${avgWifi.toFixed(0)} dBm avg Wi-Fi` : 'Wi-Fi RSSI pending'} · {avgCell ? `${avgCell.toFixed(1)} CSQ cellular` : 'CSQ pending'}</small></article>
        </section>

        <section className={styles.grid}>
          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Recent counters</span><h2>Latest vend activity</h2></div><Link href="/telemetry">Analytics ›</Link></header>
            <div className={styles.activityList}>{recentSales.slice(0, 8).map((sale) => <div className={styles.activityRow} key={sale.id}><i /><div><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong><span>{sale.machine_name ?? sale.serial_number ?? sale.branch.toUpperCase()} · {timeAgo(sale.last_received_at)} ago</span></div><b>{n(sale.units_sold).toLocaleString('en-ZA')}</b></div>)}{!recentSales.length ? <div className={styles.empty}>No recent vend activity.</div> : null}</div>
          </article>
          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Fleet leaders</span><h2>Top machines</h2></div><Link href="/machines">Machines ›</Link></header>
            <div className={styles.topProducts}><div className={styles.productHeader}><span>#</span><span>Machine</span><span>Vends</span><span>Failed</span></div>{(report.top_machines ?? []).slice(0, 8).map((machine, index) => <div className={styles.productRow} key={machine.machine_id ?? `${index}`}><b>{index + 1}</b><span className={styles.productName}>{machine.machine_name ?? machine.serial_number ?? 'Unassigned'}</span><span className={styles.productValue}>{n(machine.units_sold).toLocaleString('en-ZA')}</span><span className={`${styles.productTrend} ${n(machine.failed_vends) ? styles.productTrendDown : ''}`}>{n(machine.failed_vends).toLocaleString('en-ZA')}</span></div>)}</div>
            <footer className={styles.cardFooter}><span>Updated</span><strong>{updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</strong></footer>
          </article>
        </section>
        </details>
      <p className={styles.scopeNote}>Region: {telemetryRegionLabel(userDetails?.telemetry_region)} · Production telemetry · Last successful update: {updated ? updated.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) + ' SAST' : 'Not yet loaded'}</p>
      </> : null}
    </section>
  );
}
