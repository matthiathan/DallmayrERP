'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
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
      <div className="page-header">
        <div>
          <h1>DallmayrERP Dashboard</h1>
          <p>Live overview from the DallmayrERP Supabase database.</p>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <p>Loading dashboard...</p> : null}
      <div className="grid grid-3">
        <KpiCard label="Customers" value={data.customers} helper="JHB, CPT and KZN customer master rows" />
        <KpiCard label="Contracts" value={data.contracts} helper="All branch contract agreement rows" />
        <KpiCard label="Machines / Assets" value={data.assets} helper="Fixed assets imported into Supabase" />
        <KpiCard label="Service Calls" value={data.serviceCalls} helper="JHB, KZN and CPT preventive service logs" />
        <KpiCard label="Stock Items" value={data.stockItems} helper="Warehouse product records" />
        <KpiCard label="Business Users" value={data.users} helper="Staff records in public.users" />
      </div>
    </AppShell>
  );
}
