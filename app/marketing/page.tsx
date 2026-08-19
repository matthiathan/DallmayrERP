'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { DocumentHub } from '@/components/features/DocumentHub';
import { BarChart, DonutChart } from '@/components/ui/MiniCharts';
import { KpiCard } from '@/components/ui/KpiCard';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { countRawContracts, countRawCustomers, safeCountRows } from '@/lib/data/counts';
import { getSupabaseClient } from '@/lib/supabase/client';

type MarketingSegmentSummary = {
  with_email?: number;
  without_machines?: number;
  with_contract_reference?: number;
};

type SalesSummary = {
  renewals_overdue?: number;
  renewals_30?: number;
  renewals_60?: number;
  renewals_90?: number;
  renewals_no_end?: number;
  open_opportunities?: number;
};

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
    contactableCustomers: 0,
    unmappedCustomers: 0,
    contractLinkedCustomers: 0,
    renewalsDue: 0,
    renewalsNoEnd: 0,
    openOpportunities: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const client = getSupabaseClient();
        const [customers, contracts, assets, campaigns, segmentResult, salesResult] = await Promise.all([
          countRawCustomers(client),
          countRawContracts(client),
          safeCountRows(client, 'machines'),
          safeCountRows(client, 'marketing_campaigns'),
          client.rpc('get_marketing_segment_summary', { p_branch: 'all' }),
          client.rpc('get_sales_workspace_summary', { p_branch: 'all', p_salesman: 'all' }),
        ]);

        const segmentSummary = (segmentResult.data ?? {}) as MarketingSegmentSummary;
        const salesSummary = (salesResult.data ?? {}) as SalesSummary;
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
          contactableCustomers: asNumber(segmentSummary.with_email),
          unmappedCustomers: asNumber(segmentSummary.without_machines),
          contractLinkedCustomers: asNumber(segmentSummary.with_contract_reference),
          renewalsDue: asNumber(salesSummary.renewals_overdue) + asNumber(salesSummary.renewals_30) + asNumber(salesSummary.renewals_60) + asNumber(salesSummary.renewals_90),
          renewalsNoEnd: asNumber(salesSummary.renewals_no_end),
          openOpportunities: asNumber(salesSummary.open_opportunities),
        });

        if (segmentResult.error || salesResult.error) {
          setError(segmentResult.error?.message ?? salesResult.error?.message ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Marketing dashboard failed to load.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const renewalDue = data.renewalsDue.toLocaleString();

  return (
    <AppShell>
      <div className="page-header hero-panel" data-ui-priority="identity">
        <div>
          <div className="badge">Marketing</div>
          <h1>Marketing Dashboard</h1>
          <p>Prioritize renewal follow-up and customer actions, then review audience and campaign analysis.</p>
        </div>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading marketing data" /> : null}

      <div className="grid grid-4" style={{ marginBottom: 20 }} data-ui-priority="summary">
        <KpiCard label="Renewals needing attention" value={renewalDue} helper={`${data.renewalsNoEnd.toLocaleString()} contracts also need end-date cleanup`} />
        <KpiCard label="Open opportunities" value={data.openOpportunities.toLocaleString()} helper="Active sales opportunities available for follow-up" />
        <KpiCard label="Contactable customers" value={data.contactableCustomers.toLocaleString()} helper={`${data.customers.toLocaleString()} customers in the current national base`} />
        <KpiCard label="Campaigns" value={data.campaigns.toLocaleString()} helper="Campaign records in the marketing workspace" />
        <KpiCard label="Contracts" value={data.contracts.toLocaleString()} helper="Agreement records available for audience and renewal planning" />
        <KpiCard label="Machines" value={data.assets.toLocaleString()} helper={`${data.unmappedCustomers.toLocaleString()} customers still need machine-mapping review`} />
      </div>

      <section className="card" style={{ marginBottom: 20 }} data-ui-priority="urgent">
        <h2>Marketing action queue</h2>
        <p>Open the work that needs follow-up before moving into analysis.</p>
        <div className="feature-list">
          <Link className="feature-pill" href="/marketing/contract-renewals">{data.renewalsDue.toLocaleString()} renewal records need follow-up</Link>
          <Link className="feature-pill" href="/marketing/contract-renewals">{data.renewalsNoEnd.toLocaleString()} contracts need end-date cleanup</Link>
          <Link className="feature-pill" href="/marketing/segments">{data.unmappedCustomers.toLocaleString()} customers need machine-mapping review</Link>
          <Link className="feature-pill" href="/marketing/segments">{data.contractLinkedCustomers.toLocaleString()} customers have contract references</Link>
        </div>
      </section>

      <section aria-label="Marketing workspaces" className="grid grid-4" style={{ marginBottom: 20 }} data-ui-priority="primary">
        <Link className="card" href="/marketing/contract-renewals"><div className="nav-heading">Renewal campaigns</div><div className="kpi-value">{renewalDue}</div><p>Open the live 30/60/90 renewal worklist and export campaign audiences.</p></Link>
        <Link className="card" href="/marketing/segments"><div className="nav-heading">Customer segments</div><div className="kpi-value">{data.contactableCustomers.toLocaleString()}</div><p>Filter by branch, status, category, salesman, contact readiness and machine mapping.</p></Link>
        <Link className="card" href="/sales"><div className="nav-heading">Sales opportunities</div><div className="kpi-value">{data.openOpportunities.toLocaleString()}</div><p>Create and manage renewal, upgrade, new-machine and reactivation opportunities.</p></Link>
        <Link className="card" href="/marketing/campaigns"><div className="nav-heading">Campaign planning</div><div className="kpi-value">{data.campaigns.toLocaleString()}</div><p>Create campaign records, track status and manage the campaign schedule.</p></Link>
      </section>

      <section aria-label="Marketing analysis" className="grid grid-2" style={{ marginBottom: 20 }} data-ui-priority="secondary">
        <BarChart title="Customer base by branch" data={[{ label: 'JHB', value: data.jhbCustomers }, { label: 'CPT', value: data.cptCustomers }, { label: 'KZN', value: data.kznCustomers }]} />
        <DonutChart title="Contract records by branch" data={[{ label: 'JHB', value: data.jhbContracts }, { label: 'CPT', value: data.cptContracts }, { label: 'KZN', value: data.kznContracts }]} />
      </section>

      <section data-ui-priority="supporting">
        <DocumentHub department="marketing" branch="all" />
      </section>
    </AppShell>
  );
}
