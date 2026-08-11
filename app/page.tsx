'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { LineIcon, type LineIconName } from '@/components/ui/LineIcon';
import { countRawContracts, countRawCustomers, countRawServiceCalls, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

type DashboardData = {
  customers: number;
  contracts: number;
  assets: number;
  serviceCalls: number;
  stockItems: number;
  users: number;
};

type ActivityRow = {
  id: string;
  action: string;
  summary: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
};

type DashboardAlertCounts = {
  overdueWork: number;
  pendingApprovals: number;
  stockAlerts: number;
};

type DashboardMetric = {
  key: keyof DashboardData;
  label: string;
  helper: string;
  href: string;
  icon: LineIconName;
  accent: 'blue' | 'sky' | 'green' | 'purple' | 'orange' | 'gold';
};

const dashboardMetrics: DashboardMetric[] = [
  { key: 'customers', label: 'Customers', helper: 'JHB, CPT and KZN customer master rows', href: '/customers', icon: 'customers', accent: 'blue' },
  { key: 'contracts', label: 'Contracts', helper: 'All branch contract agreement rows', href: '/executive/contracts', icon: 'contract', accent: 'sky' },
  { key: 'assets', label: 'Machines / Assets', helper: 'Fixed assets imported into Supabase', href: '/operations/assets', icon: 'equipment', accent: 'green' },
  { key: 'serviceCalls', label: 'Service Calls', helper: 'JHB, KZN and CPT preventive service logs', href: '/operations/service-jobs', icon: 'work-orders', accent: 'purple' },
  { key: 'stockItems', label: 'Stock Items', helper: 'Warehouse product records', href: '/warehouse/stock', icon: 'inventory', accent: 'orange' },
  { key: 'users', label: 'Business Users', helper: 'Staff records in public.users', href: '/admin/users', icon: 'users', accent: 'gold' },
];

const numberFormatter = new Intl.NumberFormat('en-ZA');
const openWorkStatuses = ['new', 'triaged', 'assigned', 'in_progress', 'blocked', 'waiting_approval'];

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function actionLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function activityHref(activity: ActivityRow) {
  if (!activity.entity_id) return '/admin/activity';
  switch (activity.entity_type) {
    case 'work_item': return `/work/${activity.entity_id}`;
    case 'service_job': return `/operations/service-jobs?job=${encodeURIComponent(activity.entity_id)}`;
    case 'customer': return `/customers/${activity.entity_id}`;
    case 'machine': return `/operations/assets/${activity.entity_id}`;
    default: return '/admin/activity';
  }
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlertCounts>({ overdueWork: 0, pendingApprovals: 0, stockAlerts: 0 });
  const [data, setData] = useState<DashboardData>({
    customers: 0,
    contracts: 0,
    assets: 0,
    serviceCalls: 0,
    stockItems: 0,
    users: 0,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const client = getSupabaseClient();
        const now = new Date().toISOString();
        const [customers, contracts, serviceCalls, assets, stockItems, users, activityResult, overdueResult, approvalResult, stockAlertResult] = await Promise.all([
          countRawCustomers(client),
          countRawContracts(client),
          countRawServiceCalls(client),
          safeCountRows(client, 'fixed_assets'),
          safeCountRows(client, 'stock_items'),
          safeCountRows(client, 'users'),
          client.from('audit_events').select('id, action, summary, entity_type, entity_id, created_at').order('created_at', { ascending: false }).limit(5),
          client.from('work_items').select('id', { count: 'exact', head: true }).in('status', openWorkStatuses).lt('due_at', now),
          client.from('work_items').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending'),
          client.from('stock_alerts').select('id', { count: 'exact', head: true }).in('status', ['open', 'acknowledged']),
        ]);

        if (!active) return;
        setData({
          customers: customers.total,
          contracts: contracts.total,
          serviceCalls: serviceCalls.total,
          assets,
          stockItems,
          users,
        });

        const supplementaryError = activityResult.error ?? overdueResult.error ?? approvalResult.error ?? stockAlertResult.error;
        if (supplementaryError) {
          setNotice('Core dashboard totals are live. Recent activity or alert summaries could not be fully refreshed.');
        } else {
          setNotice(null);
        }
        setActivity(activityResult.error ? [] : (activityResult.data ?? []) as ActivityRow[]);
        setAlerts({
          overdueWork: overdueResult.error ? 0 : Number(overdueResult.count ?? 0),
          pendingApprovals: approvalResult.error ? 0 : Number(approvalResult.count ?? 0),
          stockAlerts: stockAlertResult.error ? 0 : Number(stockAlertResult.count ?? 0),
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Dashboard failed to load.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  const alertRows = useMemo(() => [
    { key: 'overdue', label: 'Overdue work orders', count: alerts.overdueWork, href: '/work', tone: 'danger' },
    { key: 'approvals', label: 'Pending approvals', count: alerts.pendingApprovals, href: '/work', tone: 'warning' },
    { key: 'stock', label: 'Open stock alerts', count: alerts.stockAlerts, href: '/warehouse/planning', tone: 'info' },
  ], [alerts]);

  return (
    <AppShell>
      <section className="admin-command-dashboard admin-reference-dashboard">
        <header className="admin-command-header admin-reference-header">
          <div>
            <h1>DallmayrERP Dashboard</h1>
            <p>Live overview from Supabase plus operational reporting for branch and department accountability.</p>
          </div>
          <div className="admin-command-status admin-reference-status" aria-label="Dashboard status">
            <div><span>Live data</span><strong>All branches</strong></div>
            <span aria-hidden="true" className="admin-reference-status-icon"><LineIcon name="building" size={31} /></span>
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}
        {notice ? <div className="admin-reference-notice" role="status">{notice}</div> : null}
        {loading ? <HamsterLoader label="Loading dashboard" /> : null}

        <section aria-label="Key performance indicators" className="admin-command-kpis admin-reference-kpis">
          {dashboardMetrics.map((metric) => (
            <Link className="admin-reference-metric" data-accent={metric.accent} href={metric.href} key={metric.key}>
              <span className="admin-reference-metric-label">{metric.label}</span>
              <div className="admin-reference-metric-body">
                <span aria-hidden="true" className="admin-reference-metric-icon"><LineIcon name={metric.icon} size={43} /></span>
                <div className="admin-reference-metric-copy">
                  <strong>{numberFormatter.format(data[metric.key])}</strong>
                  <p>{metric.helper}</p>
                </div>
                <span aria-hidden="true" className="admin-reference-metric-chevron"><LineIcon name="chevron" size={25} /></span>
              </div>
            </Link>
          ))}
        </section>

        <section className="admin-reference-lower-grid">
          <section className="admin-reference-panel" aria-labelledby="recent-activity-title">
            <header>
              <h2 id="recent-activity-title">Recent Activity</h2>
              <Link href="/admin/activity">View all</Link>
            </header>
            <div className="admin-reference-panel-list">
              {activity.length ? activity.map((item) => (
                <Link className="admin-reference-activity-row" href={activityHref(item)} key={item.id}>
                  <span className="admin-reference-activity-entity">{item.entity_type.replace(/_/g, ' ')}</span>
                  <strong>{item.summary}</strong>
                  <span className="admin-reference-activity-state"><i aria-hidden="true" />{actionLabel(item.action)}</span>
                  <time>{formatRelativeTime(item.created_at)}</time>
                </Link>
              )) : <div className="admin-reference-empty">No recent audit activity is available.</div>}
            </div>
          </section>

          <section className="admin-reference-panel" aria-labelledby="dashboard-alerts-title">
            <header>
              <h2 id="dashboard-alerts-title">Alerts</h2>
              <Link href="/work">View all</Link>
            </header>
            <div className="admin-reference-panel-list">
              {alertRows.map((item) => (
                <Link className="admin-reference-alert-row" data-tone={item.tone} href={item.href} key={item.key}>
                  <span aria-hidden="true" className="admin-reference-alert-dot" />
                  <strong>{item.label}</strong>
                  <span className="admin-reference-alert-count">{numberFormatter.format(item.count)}</span>
                </Link>
              ))}
            </div>
          </section>
        </section>

        <section className="admin-command-reporting admin-reference-reporting">
          <div className="admin-reference-reporting-heading">
            <span>Operational reporting</span>
            <h2>Business performance and branch accountability</h2>
          </div>
          <ExecutiveReportingPanel />
        </section>

        <footer className="admin-command-footer">© {new Date().getFullYear()} Dallmayr ERP. All rights reserved.</footer>
      </section>
    </AppShell>
  );
}
