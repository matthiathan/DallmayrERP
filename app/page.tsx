'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { countRawContracts, countRawCustomers, countRawServiceCalls, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState({
    customers: 0,
    contracts: 0,
    assets: 0,
    serviceCalls: 0,
    stockItems: 0,
    users: 0,
  });

  useEffect(() => {
    async function load() {
      try {
        const client = getSupabaseClient();
        const [customers, contracts, serviceCalls, assets, stockItems, users] = await Promise.all([
          countRawCustomers(client),
          countRawContracts(client),
          countRawServiceCalls(client),
          safeCountRows(client, 'fixed_assets'),
          safeCountRows(client, 'stock_items'),
          safeCountRows(client, 'users'),
        ]);
        setData({
          customers: customers.total,
          contracts: contracts.total,
          serviceCalls: serviceCalls.total,
          assets,
          stockItems,
          users,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dashboard failed to load.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <AppShell>
      <section className="ops-console">
        <header className="ops-console-heading">
          <div><h1>Good morning</h1><p>Here&apos;s what needs attention across the business.</p></div>
          <div className="ops-console-actions"><Link className="button" href="/work">+ Create work item</Link><Link className="button secondary" href="/work">Customise view</Link></div>
        </header>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <HamsterLoader label="Loading dashboard" /> : null}

        <section aria-label="Key performance indicators" className="ops-kpis">
          <DashboardMetric icon="◉" label="Machines / assets" value={data.assets} helper="Registered equipment" tone="green" />
          <DashboardMetric icon="!" label="Service calls" value={data.serviceCalls} helper="All service records" tone="red" />
          <DashboardMetric icon="✓" label="Contracts" value={data.contracts} helper="Active agreement records" tone="blue" />
          <DashboardMetric icon="□" label="Stock items" value={data.stockItems} helper="Warehouse products" tone="amber" />
          <DashboardMetric icon="R" label="Customers" value={data.customers} helper="Across all branches" tone="green" />
        </section>

        <section className="ops-dashboard-grid">
          <article className="ops-panel ops-priority-panel">
            <PanelHeading title="Priority inbox" count={4} href="/work" />
            <div className="ops-priority-list">
              <PriorityRow severity="Critical" title="Review open service calls" meta={`${data.serviceCalls} service records available`} href="/operations/service-jobs" action="View" />
              <PriorityRow severity="High" title="Check stock availability" meta={`${data.stockItems} stock items across warehouses`} href="/warehouse/planning" action="Open" />
              <PriorityRow severity="Medium" title="Review customer contracts" meta={`${data.contracts} agreement records`} href="/contracts" action="Review" />
              <PriorityRow severity="Low" title="Manage business access" meta={`${data.users} staff records`} href="/admin/users" action="Manage" />
            </div>
          </article>

          <article className="ops-panel ops-fleet-panel">
            <PanelHeading title="Fleet overview" href="/telemetry" />
            <div className="fleet-overview">
              <div className="fleet-ring"><strong>{data.assets}</strong><span>Total machines</span></div>
              <dl><div><dt><i className="green" />Telemetry</dt><dd>Monitor</dd></div><div><dt><i className="blue" />Daily reporting</dt><dd>Review</dd></div><div><dt><i className="amber" />Monthly reporting</dt><dd>Review</dd></div><div><dt><i className="red" />Exceptions</dt><dd>Open</dd></div></dl>
            </div>
          </article>

          <article className="ops-panel ops-schedule-panel">
            <PanelHeading title="Today's workspace" href="/workspace" />
            <ol className="ops-timeline"><li><time>08:00</time><span><strong>Review priority inbox</strong><small>Assign urgent work</small></span></li><li><time>10:00</time><span><strong>Service planning</strong><small>Routes and technicians</small></span></li><li><time>13:00</time><span><strong>Stock review</strong><small>Risks and transfers</small></span></li><li><time>16:00</time><span><strong>Daily close</strong><small>Exceptions and approvals</small></span></li></ol>
          </article>

          <article className="ops-panel ops-performance-panel">
            <PanelHeading title="Operational coverage" href="/executive/reports" />
            <div className="ops-bars"><Bar label="Customers" value={data.customers} max={Math.max(data.customers, data.contracts, data.assets, 1)} /><Bar label="Contracts" value={data.contracts} max={Math.max(data.customers, data.contracts, data.assets, 1)} /><Bar label="Assets" value={data.assets} max={Math.max(data.customers, data.contracts, data.assets, 1)} /></div>
          </article>

          <article className="ops-panel ops-inventory-panel">
            <PanelHeading title="Inventory & service" href="/warehouse/stock" />
            <div className="ops-big-stat"><strong>{data.stockItems}</strong><span>stock items available</span></div><div className="ops-stat-pair"><span><strong>{data.serviceCalls}</strong> service calls</span><span><strong>{data.contracts}</strong> contracts</span></div>
          </article>

          <article className="ops-panel ops-activity-panel">
            <PanelHeading title="Quick access" href="/work" />
            <nav className="ops-quick-links"><Link href="/telemetry"><span>◉</span>Fleet monitor</Link><Link href="/operations/exceptions"><span>!</span>Exception centre</Link><Link href="/warehouse/stock"><span>□</span>Stock control</Link><Link href="/executive"><span>↗</span>Executive view</Link></nav>
          </article>
        </section>
      </section>
    </AppShell>
  );
}

function DashboardMetric({ icon, label, value, helper, tone }: { icon: string; label: string; value: number; helper: string; tone: string }) {
  return <article className="ops-metric"><span className={`ops-metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value.toLocaleString()}</strong></div><small>{helper}</small></article>;
}

function PanelHeading({ title, count, href }: { title: string; count?: number; href: string }) {
  return <header className="ops-panel-heading"><h2>{title}{count ? <span>{count}</span> : null}</h2><Link href={href}>View all</Link></header>;
}

function PriorityRow({ severity, title, meta, href, action }: { severity: string; title: string; meta: string; href: string; action: string }) {
  return <div className={`ops-priority-row severity-${severity.toLowerCase()}`}><span className="ops-severity">{severity}</span><div><strong>{title}</strong><small>{meta}</small></div><span className="ops-owner">Operations</span><Link href={href}>{action}</Link></div>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div><span>{label}</span><i><b style={{ width: `${Math.max(5, (value / max) * 100)}%` }} /></i><strong>{value.toLocaleString()}</strong></div>;
}
