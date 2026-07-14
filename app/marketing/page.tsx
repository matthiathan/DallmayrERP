'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { countRawContracts, countRawCustomers, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function MarketingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ customers: 0, contracts: 0, assets: 0, campaigns: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const client = getSupabaseClient();
        const [customers, contracts, assets, campaigns] = await Promise.all([
          countRawCustomers(client),
          countRawContracts(client),
          safeCountRows(client, 'fixed_assets'),
          safeCountRows(client, 'marketing_campaigns'),
        ]);
        setData({ customers: customers.total, contracts: contracts.total, assets, campaigns });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Marketing dashboard failed to load.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <AppShell>
      <div className="page-header"><div><h1>Marketing Dashboard</h1><p>Customer intelligence, segmentation and campaign planning.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <p>Loading marketing data...</p> : null}
      <div className="grid grid-2">
        <KpiCard label="Customer base" value={data.customers} helper="Raw customer master rows across all branches" />
        <KpiCard label="Contracts" value={data.contracts} helper="Useful for renewal and retention campaigns" />
        <KpiCard label="Machines / assets" value={data.assets} helper="Installed estate for upgrade and service campaigns" />
        <KpiCard label="Campaigns" value={data.campaigns} helper="Campaign rows once marketing tables are applied" />
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Recommended marketing actions</h2>
        <ul>
          <li>Build contract renewal campaigns for customers expiring in 30, 60 and 90 days.</li>
          <li>Segment customers by branch, category, service frequency, machine count and salesman.</li>
          <li>Flag customers with many service calls as retention opportunities.</li>
          <li>Export targeted branch campaign lists for sales follow-up.</li>
        </ul>
      </div>
    </AppShell>
  );
}
