'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { DocumentHub } from '@/components/features/DocumentHub';
import { BarChart, DonutChart } from '@/components/ui/MiniCharts';
import { KpiCard } from '@/components/ui/KpiCard';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { countRawContracts, countRawCustomers, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function MarketingDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    customers: 0,
    contracts: 0,
    assets: 0,
    campaigns: 0,
    jhbCustomers: 0,
    cptCustomers: 0,
    kznCustomers: 0,
    jhbContracts: 0,
    cptContracts: 0,
    kznContracts: 0,
  });
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
        setData({
          customers: customers.total,
          contracts: contracts.total,
          assets,
          campaigns,
          jhbCustomers: customers.jhb,
          cptCustomers: customers.cpt,
          kznCustomers: customers.kzn,
          jhbContracts: contracts.jhb,
          cptContracts: contracts.cpt,
          kznContracts: contracts.kzn,
        });
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
      <div className="page-header hero-panel"><div><div className="badge">Marketing</div><h1>Marketing Dashboard</h1><p>Customer intelligence, segmentation, campaign planning and shared marketing documentation.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading marketing data" /> : null}
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <KpiCard label="Customer base" value={data.customers} helper="Raw customer master rows across all branches" />
        <KpiCard label="Contracts" value={data.contracts} helper="Useful for renewal and retention campaigns" />
        <KpiCard label="Machines / assets" value={data.assets} helper="Installed estate for upgrade and service campaigns" />
        <KpiCard label="Campaigns" value={data.campaigns} helper="Campaign rows once marketing tables are applied" />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <BarChart title="Customer base by branch" data={[{ label: 'JHB', value: data.jhbCustomers }, { label: 'CPT', value: data.cptCustomers }, { label: 'KZN', value: data.kznCustomers }]} />
        <DonutChart title="Contract records by branch" data={[{ label: 'JHB', value: data.jhbContracts }, { label: 'CPT', value: data.cptContracts }, { label: 'KZN', value: data.kznContracts }]} />
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Recommended marketing actions</h2>
        <ul>
          <li>Build contract renewal campaigns for customers expiring in 30, 60 and 90 days.</li>
          <li>Segment customers by branch, category, service frequency, machine count and salesman.</li>
          <li>Flag customers with many service calls as retention opportunities.</li>
          <li>Upload campaign briefs, price sheets and approvals here for branch access.</li>
        </ul>
      </div>
      <DocumentHub department="marketing" branch="all" />
    </AppShell>
  );
}
