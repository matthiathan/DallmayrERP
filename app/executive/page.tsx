'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawContracts, countRawCustomers, countRawServiceCalls, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ExecutiveOverviewPage() {
  const [data, setData] = useState({ customers: 0, contracts: 0, assets: 0, serviceCalls: 0, stockItems: 0, users: 0 });

  useEffect(() => {
    async function load() {
      const client = getSupabaseClient();
      const [customers, contracts, serviceCalls, assets, stockItems, users] = await Promise.all([
        countRawCustomers(client),
        countRawContracts(client),
        countRawServiceCalls(client),
        safeCountRows(client, 'fixed_assets'),
        safeCountRows(client, 'stock_items'),
        safeCountRows(client, 'users'),
      ]);
      setData({ customers: customers.total, contracts: contracts.total, serviceCalls: serviceCalls.total, assets, stockItems, users });
    }
    load().catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Executive Overview</h1><p>Strategic snapshot across customers, contracts, assets, service, warehouse and people.</p></div></div>
      <div className="grid grid-3">
        <KpiCard label="Customers" value={data.customers} />
        <KpiCard label="Contracts" value={data.contracts} />
        <KpiCard label="Machines / assets" value={data.assets} />
        <KpiCard label="Service records" value={data.serviceCalls} />
        <KpiCard label="Stock items" value={data.stockItems} />
        <KpiCard label="Staff users" value={data.users} />
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Executive focus areas</h2>
        <ul><li>Branch performance and operational risk</li><li>Contract expiry and customer retention</li><li>Service workload and repeat failures</li><li>Warehouse low-stock exposure</li><li>Customer and asset base growth</li></ul>
      </div>
    </AppShell>
  );
}
