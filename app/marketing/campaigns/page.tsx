'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { getSupabaseClient } from '@/lib/supabase/client';

type CampaignStatus = 'all' | 'planned' | 'active' | 'completed' | 'cancelled';

type Campaign = {
  id: string;
  campaign_name: string;
  campaign_type: string;
  target_segment: string | null;
  branch: string | null;
  start_date: string | null;
  end_date: string | null;
  status: Exclude<CampaignStatus, 'all'>;
  notes: string | null;
  created_at?: string;
};

const emptyForm = {
  campaign_name: '',
  campaign_type: 'contract_renewal',
  target_segment: '',
  branch: 'national',
  start_date: '',
  end_date: '',
  status: 'planned' as Exclude<CampaignStatus, 'all'>,
  notes: '',
};

const campaignStatuses: CampaignStatus[] = ['all', 'planned', 'active', 'completed', 'cancelled'];
const campaignTypes = ['contract_renewal', 'new_product', 'machine_upgrade', 'service_follow_up', 'customer_reactivation', 'seasonal_campaign'];
const branches = ['national', 'jhb', 'cpt', 'kzn'];

function labelize(value: string) {
  if (value === 'all') return 'All';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MarketingCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CampaignStatus>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadCampaigns() {
    setLoading(true);
    const { data, error: loadError } = await getSupabaseClient()
      .from('marketing_campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setCampaigns((data ?? []) as Campaign[]);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCampaigns().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load campaigns.');
      setLoading(false);
    });
  }, []);

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const payload = {
      ...form,
      target_segment: form.target_segment || null,
      branch: form.branch || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes || null,
    };
    const { error: insertError } = await getSupabaseClient().from('marketing_campaigns').insert(payload);
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSuccess('Campaign created.');
    setForm(emptyForm);
    await loadCampaigns();
  }

  async function updateCampaignStatus(id: string, nextStatus: Exclude<CampaignStatus, 'all'>) {
    setSaving(true);
    setError(null);
    const { error: updateError } = await getSupabaseClient().from('marketing_campaigns').update({ status: nextStatus }).eq('id', id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess('Campaign status updated.');
    await loadCampaigns();
  }

  const filteredCampaigns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (status !== 'all' && campaign.status !== status) return false;
      if (!term) return true;
      return [campaign.campaign_name, campaign.campaign_type, campaign.target_segment, campaign.branch, campaign.status, campaign.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [campaigns, search, status]);

  const visibleCampaigns = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCampaigns.slice(start, start + pageSize);
  }, [filteredCampaigns, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, status, pageSize]);

  const plannedCount = campaigns.filter((campaign) => campaign.status === 'planned').length;
  const activeCount = campaigns.filter((campaign) => campaign.status === 'active').length;
  const completedCount = campaigns.filter((campaign) => campaign.status === 'completed').length;
  const cancelledCount = campaigns.filter((campaign) => campaign.status === 'cancelled').length;

  const columns = useMemo<EnterpriseColumn<Campaign>[]>(() => [
    { id: 'name', header: 'Campaign', value: (row) => row.campaign_name, render: (row) => <strong>{row.campaign_name}</strong> },
    { id: 'type', header: 'Type', value: (row) => row.campaign_type, render: (row) => <StatusBadge value={labelize(row.campaign_type)} /> },
    { id: 'segment', header: 'Segment', value: (row) => row.target_segment ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch ?? '' },
    { id: 'dates', header: 'Dates', value: (row) => `${row.start_date ?? ''} ${row.end_date ?? ''}`, render: (row) => <small>{row.start_date || '-'} to {row.end_date || '-'}</small> },
    { id: 'notes', header: 'Notes', value: (row) => row.notes ?? '' },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <select aria-label="Campaign status" disabled={saving} onChange={(event) => updateCampaignStatus(row.id, event.target.value as Exclude<CampaignStatus, 'all'>)} value={row.status}>{campaignStatuses.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select> },
  ], [saving]);

  return (
    <AppShell>
      <div className="page-header hero-panel"><div><div className="badge">Marketing</div><h1>Marketing Campaigns</h1><p>Plan, filter and track campaigns for renewals, upgrades, service follow-ups and customer reactivation.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Total campaigns" value={campaigns.length.toLocaleString()} />
        <KpiCard label="Planned" value={plannedCount.toLocaleString()} />
        <KpiCard label="Active" value={activeCount.toLocaleString()} />
        <KpiCard label="Completed / cancelled" value={`${completedCount}/${cancelledCount}`} />
      </div>

      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadCampaigns} type="button">{loading ? 'Refreshing...' : 'Refresh campaigns'}</button>} description="Create campaign records and update their status as the campaign moves from planning to execution." lastUpdated={lastUpdated} title="Campaign planner" />
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Create campaign</h2>
        <form className="form-grid" onSubmit={createCampaign}>
          <label>Campaign name<input required value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} /></label>
          <label>Campaign type<select value={form.campaign_type} onChange={(e) => setForm({ ...form, campaign_type: e.target.value })}>{campaignTypes.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Target segment<input value={form.target_segment} onChange={(e) => setForm({ ...form, target_segment: e.target.value })} placeholder="Example: JHB active customers without machines" /></label>
          <label>Branch<select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Start date<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label>End date<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Exclude<CampaignStatus, 'all'> })}>{campaignStatuses.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ alignSelf: 'end' }}><button className="button" disabled={saving} type="submit">{saving ? 'Saving...' : 'Create campaign'}</button></div>
        </form>
      </div>

      <RemoteDataTable
        columns={columns}
        emptyMessage="No campaigns match this filter."
        filters={<label>Status<select value={status} onChange={(event) => setStatus(event.target.value as CampaignStatus)}>{campaignStatuses.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSearchChange={setSearch}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => row.id}
        rows={visibleCampaigns}
        search={search}
        searchPlaceholder="Search campaign, type, segment, branch or notes"
        totalRows={filteredCampaigns.length}
      />
    </AppShell>
  );
}
