'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { getSupabaseClient } from '@/lib/supabase/client';

type SegmentSummary = {
  customer_count?: number;
  with_email?: number;
  with_machines?: number;
  without_machines?: number;
  with_contract_reference?: number;
};

type SalesSummary = {
  contract_count?: number;
  renewals_overdue?: number;
  renewals_30?: number;
  renewals_60?: number;
  renewals_90?: number;
  renewals_no_end?: number;
};

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function MarketingReportsPage() {
  const [segmentSummary, setSegmentSummary] = useState<SegmentSummary | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReports() {
      const client = getSupabaseClient();
      const [segmentResult, salesResult, campaignResult] = await Promise.all([
        client.rpc('get_marketing_segment_summary', { p_branch: 'all' }),
        client.rpc('get_sales_workspace_summary', { p_branch: 'all', p_salesman: 'all' }),
        client.from('marketing_campaigns').select('*', { count: 'exact', head: true }),
      ]);

      const firstError = segmentResult.error ?? salesResult.error ?? campaignResult.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }

      setSegmentSummary((segmentResult.data ?? {}) as SegmentSummary);
      setSalesSummary((salesResult.data ?? {}) as SalesSummary);
      setCampaignCount(campaignResult.count ?? 0);
    }

    loadReports().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load marketing reports.'));
  }, []);

  const renewalDue = asNumber(salesSummary?.renewals_overdue) + asNumber(salesSummary?.renewals_30) + asNumber(salesSummary?.renewals_60) + asNumber(salesSummary?.renewals_90);

  return (
    <AppShell>
      <div className="page-header hero-panel"><div><div className="badge">Marketing</div><h1>Marketing Reports</h1><p>Live campaign, segmentation and customer intelligence reporting.</p></div></div>
      {error ? <div className="error">{error}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Segment records" value={asNumber(segmentSummary?.customer_count).toLocaleString()} helper={`${asNumber(segmentSummary?.with_email).toLocaleString()} contactable by email`} />
        <KpiCard label="Renewal targets" value={renewalDue.toLocaleString()} helper={`${asNumber(salesSummary?.renewals_no_end).toLocaleString()} contracts need date cleanup`} />
        <KpiCard label="Machine mapping" value={asNumber(segmentSummary?.with_machines).toLocaleString()} helper={`${asNumber(segmentSummary?.without_machines).toLocaleString()} customer records are unmapped`} />
        <KpiCard label="Campaign records" value={campaignCount.toLocaleString()} helper="Created in Marketing Campaigns." />
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <Link className="card" href="/marketing/segments"><h2>Customer segment report</h2><p>Filter and export live customer segment lists by branch, status, category, salesman and machine mapping.</p></Link>
        <Link className="card" href="/marketing/contract-renewals"><h2>Contract renewal target list</h2><p>Open the live overdue, 30-day, 60-day and 90-day contract renewal worklist.</p></Link>
        <Link className="card" href="/marketing/campaigns"><h2>Campaign performance register</h2><p>Review planned, active, completed and cancelled campaign records.</p></Link>
        <Link className="card" href="/sales"><h2>Opportunity conversion report</h2><p>Review renewal, upgrade, new-machine and reactivation opportunities created from campaign work.</p></Link>
      </div>
    </AppShell>
  );
}
