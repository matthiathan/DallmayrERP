'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';
import { KpiCard } from '@/components/ui/KpiCard';
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
      <section className="admin-command-dashboard cx-dashboard">
        <section className="cx-dashboard-hero" data-ui-priority="identity">
          <div className="cx-dashboard-hero-copy">
            <span className="cx-dashboard-live"><i aria-hidden="true" />Live DallmayrERP data</span>
            <h1>Dallmayr South Africa operations at a glance.</h1>
            <p>See equipment, service workload, customers, contracts and stock before opening detailed operational reporting.</p>
          </div>
          <div className="cx-dashboard-hero-status" aria-label="Dashboard status">
            <span>Workspace</span>
            <strong>All branches</strong>
            <small>National operational overview</small>
          </div>
        </section>

        {error ? <div className="error" role="alert">{error}</div> : null}
        {loading ? <HamsterLoader label="Loading dashboard" /> : null}

        <section aria-label="Key operational summary" className="admin-command-kpis cx-dashboard-kpis" data-ui-priority="summary">
          <KpiCard label="Machines / Assets" value={data.assets} helper="Equipment recorded across the business" />
          <KpiCard label="Service Calls" value={data.serviceCalls} helper="Recorded service activity across JHB, CPT and KZN" />
          <KpiCard label="Customers" value={data.customers} helper="Customers across Johannesburg, Cape Town and KwaZulu-Natal" />
          <KpiCard label="Contracts" value={data.contracts} helper="Customer agreements across all branches" />
          <KpiCard label="Stock Items" value={data.stockItems} helper="Products available to warehouse workflows" />
          <KpiCard label="Business Users" value={data.users} helper="Staff with ERP user records" />
        </section>

        <section className="admin-command-reporting cx-dashboard-reporting" data-ui-priority="secondary">
          <div className="cx-dashboard-section-heading">
            <div>
              <span>Operational reporting</span>
              <h2>Performance and accountability</h2>
            </div>
            <p>Use the detailed reporting below after reviewing the operational summary above.</p>
          </div>
          <ExecutiveReportingPanel />
        </section>

        <footer className="admin-command-footer">© {new Date().getFullYear()} Dallmayr ERP. All rights reserved.</footer>
      </section>
    </AppShell>
  );
}
