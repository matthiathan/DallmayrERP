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
        <section className="cx-dashboard-hero">
          <div className="cx-dashboard-hero-copy">
            <span className="cx-dashboard-live"><i aria-hidden="true" />Live DallmayrERP data</span>
            <h1>Dallmayr South Africa operations at a glance.</h1>
            <p>Customers, contracts, equipment, service activity, stock and ERP users in one operational workspace.</p>
          </div>
          <div className="cx-dashboard-hero-status" aria-label="Dashboard status">
            <span>Workspace</span>
            <strong>All branches</strong>
            <small>Supabase operational overview</small>
          </div>
        </section>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <HamsterLoader label="Loading dashboard" /> : null}

        <section aria-label="Key performance indicators" className="admin-command-kpis cx-dashboard-kpis">
          <KpiCard label="Customers" value={data.customers} helper="JHB, CPT and KZN customer master rows" />
          <KpiCard label="Contracts" value={data.contracts} helper="All branch contract agreement rows" />
          <KpiCard label="Machines / Assets" value={data.assets} helper="Fixed assets imported into Supabase" />
          <KpiCard label="Service Calls" value={data.serviceCalls} helper="JHB, KZN and CPT preventive service logs" />
          <KpiCard label="Stock Items" value={data.stockItems} helper="Warehouse product records" />
          <KpiCard label="Business Users" value={data.users} helper="Staff records in public.users" />
        </section>

        <section className="admin-command-reporting cx-dashboard-reporting">
          <div className="cx-dashboard-section-heading">
            <div>
              <span>Operational reporting</span>
              <h2>Performance and accountability</h2>
            </div>
            <p>Existing DallmayrERP reporting data and controls are unchanged.</p>
          </div>
          <ExecutiveReportingPanel />
        </section>

        <footer className="admin-command-footer">© {new Date().getFullYear()} Dallmayr ERP. All rights reserved.</footer>
      </section>
    </AppShell>
  );
}
