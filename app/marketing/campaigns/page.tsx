'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';

type Campaign = {
  id: string;
  campaign_name: string;
  campaign_type: string;
  target_segment: string | null;
  branch: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
};

const emptyForm = {
  campaign_name: '',
  campaign_type: 'contract_renewal',
  target_segment: '',
  branch: 'national',
  start_date: '',
  end_date: '',
  status: 'planned',
  notes: '',
};

export default function MarketingCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadCampaigns() {
    const { data, error: loadError } = await getSupabaseClient()
      .from('marketing_campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError('Apply sql/002_marketing_tables.sql to enable campaign storage. ' + loadError.message);
    } else {
      setCampaigns((data ?? []) as Campaign[]);
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const payload = {
      ...form,
      target_segment: form.target_segment || null,
      branch: form.branch || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes || null,
    };
    const { error: insertError } = await getSupabaseClient().from('marketing_campaigns').insert(payload);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSuccess('Campaign created.');
    setForm(emptyForm);
    await loadCampaigns();
  }

  return (
    <AppShell>
      <div className="page-header"><div><h1>Marketing Campaigns</h1><p>Plan campaigns for renewals, upgrades, service follow-ups and customer reactivation.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Create campaign</h2>
        <form className="form-grid" onSubmit={createCampaign}>
          <label>Campaign name<input required value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} /></label>
          <label>Campaign type<select value={form.campaign_type} onChange={(e) => setForm({ ...form, campaign_type: e.target.value })}><option>contract_renewal</option><option>new_product</option><option>machine_upgrade</option><option>service_follow_up</option><option>customer_reactivation</option><option>seasonal_campaign</option></select></label>
          <label>Target segment<input value={form.target_segment} onChange={(e) => setForm({ ...form, target_segment: e.target.value })} /></label>
          <label>Branch<select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}><option>national</option><option>jhb</option><option>cpt</option><option>kzn</option></select></label>
          <label>Start date<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label>End date<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>planned</option><option>active</option><option>completed</option><option>cancelled</option></select></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ alignSelf: 'end' }}><button className="button">Create campaign</button></div>
        </form>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Segment</th><th>Branch</th><th>Status</th><th>Dates</th></tr></thead><tbody>{campaigns.length === 0 ? <tr><td colSpan={6}>No campaigns yet.</td></tr> : campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.campaign_name}</td><td>{campaign.campaign_type}</td><td>{campaign.target_segment || '-'}</td><td>{campaign.branch || '-'}</td><td>{campaign.status}</td><td>{campaign.start_date || '-'} to {campaign.end_date || '-'}</td></tr>)}</tbody></table></div>
    </AppShell>
  );
}
