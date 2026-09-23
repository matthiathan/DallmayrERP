'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TelemetryRegion } from '@/types/dallmayrerp';

type CustomerTarget = {
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  branch: string | null;
};

type ClientUser = {
  user_id: string;
  email: string;
  is_active: boolean;
  access_note: string | null;
  account_scope: 'dallmayr' | 'client';
  customer_id: string | null;
  customer_name: string | null;
  role: string | null;
  branch: string | null;
  telemetry_region: TelemetryRegion | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
};

const regions: Array<{ value: TelemetryRegion; label: string }> = [
  { value: 'south_africa', label: 'South Africa' },
  { value: 'dubai', label: 'Dubai' },
  { value: 'europe', label: 'Europe' },
];

function displayName(user: ClientUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email;
}

function customerLabel(customer: CustomerTarget) {
  const code = customer.customer_code?.trim();
  const name = customer.customer_name?.trim() || 'Unnamed customer';
  return code ? `${name} · ${code}` : name;
}

export function ClientAccessControl() {
  const [customers, setCustomers] = useState<CustomerTarget[]>([]);
  const [clients, setClients] = useState<ClientUser[]>([]);
  const [email, setEmail] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [region, setRegion] = useState<TelemetryRegion>('south_africa');
  const [note, setNote] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editRegion, setEditRegion] = useState<TelemetryRegion>('south_africa');
  const [editActive, setEditActive] = useState(true);
  const [editNote, setEditNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const selected = useMemo(() => clients.find((row) => row.user_id === selectedUserId) ?? null, [clients, selectedUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseClient();
    const [customerResult, userResult] = await Promise.all([
      supabase.rpc('admin_list_client_customer_targets'),
      supabase.rpc('admin_list_user_access_v2'),
    ]);
    if (customerResult.error) {
      setError(customerResult.error.message);
      setLoading(false);
      return;
    }
    if (userResult.error) {
      setError(userResult.error.message);
      setLoading(false);
      return;
    }
    setCustomers((customerResult.data ?? []) as CustomerTarget[]);
    const rows = ((userResult.data ?? []) as ClientUser[]).filter((row) => row.account_scope === 'client');
    setClients(rows);
    setSelectedUserId((current) => current && rows.some((row) => row.user_id === current) ? current : null);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    setEditCustomerId(selected.customer_id ?? '');
    setEditRegion(selected.telemetry_region ?? 'south_africa');
    setEditActive(selected.is_active);
    setEditNote(selected.access_note ?? '');
  }, [selected]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId) return setError('Select the company this client belongs to.');
    setSaving(true);
    setError(null);
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    const { error: createError } = await getSupabaseClient().rpc('admin_create_user_access_v2', {
      p_email: cleanEmail,
      p_account_scope: 'client',
      p_customer_id: customerId,
      p_telemetry_region: region,
      p_role: 'client_viewer',
      p_branch: 'national',
      p_is_active: true,
      p_access_note: note.trim() || null,
    });
    setSaving(false);
    if (createError) return setError(createError.message);
    const company = customers.find((row) => row.customer_id === customerId);
    setMessage(`${cleanEmail} can now access telemetry for ${company ? customerLabel(company) : 'the selected company'} only. They can register/sign in with this email from the normal login screen.`);
    setEmail('');
    setCustomerId('');
    setNote('');
    await load();
  }

  async function saveSelected() {
    if (!selected || !editCustomerId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await getSupabaseClient().rpc('admin_update_user_access_v2', {
      p_user_id: selected.user_id,
      p_account_scope: 'client',
      p_customer_id: editCustomerId,
      p_telemetry_region: editRegion,
      p_role: 'client_viewer',
      p_branch: 'national',
      p_is_active: editActive,
      p_access_note: editNote.trim() || null,
    });
    setSaving(false);
    if (saveError) return setError(saveError.message);
    setMessage(`${displayName(selected)} was updated. Company telemetry access is ${editActive ? 'active' : 'suspended'}.`);
    await load();
  }

  const columns = useMemo<EnterpriseColumn<ClientUser>[]>(() => [
    {
      id: 'manage', header: 'Manage', defaultWidth: 105, filterable: false, value: (row) => row.user_id,
      render: (row) => <button className="button secondary compact-action" onClick={() => setSelectedUserId(row.user_id)} type="button">Select</button>,
    },
    {
      id: 'user', header: 'Client user', defaultWidth: 260, value: (row) => `${displayName(row)} ${row.email}`,
      render: (row) => <strong>{displayName(row)}<small>{row.email}</small></strong>,
    },
    { id: 'company', header: 'Company', defaultWidth: 260, value: (row) => row.customer_name ?? '', render: (row) => <span>{row.customer_name ?? 'Company not resolved'}</span> },
    { id: 'region', header: 'Telemetry region', defaultWidth: 155, value: (row) => row.telemetry_region ?? '', render: (row) => <span>{regions.find((item) => item.value === row.telemetry_region)?.label ?? 'Not assigned'}</span> },
    { id: 'status', header: 'Access', defaultWidth: 125, value: (row) => row.is_active ? 'active' : 'suspended', render: (row) => <StatusBadge value={row.is_active ? 'active' : 'inactive'} label={row.is_active ? 'Active' : 'Suspended'} /> },
    { id: 'rights', header: 'Rights', defaultWidth: 180, value: () => 'client viewer', render: () => <span>Telemetry read-only</span> },
  ], []);

  return (
    <div className="admin-access-stage" data-client-access-control="v1">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? 'Refreshing…' : 'Refresh clients'}</button>}
        description="Create client logins that can only read telemetry belonging to one customer company. Dallmayr accounts remain unrestricted by customer tenancy."
        lastUpdated={lastUpdated}
        title="Client telemetry access"
      />

      <section aria-label="Client account totals" className="grid grid-3 admin-access-kpis">
        <KpiCard label="Client accounts" value={clients.length} helper="Customer-scoped telemetry users." />
        <KpiCard label="Active" value={clients.filter((row) => row.is_active).length} helper="Accounts currently allowed to sign in." />
        <KpiCard label="Companies" value={new Set(clients.map((row) => row.customer_id).filter(Boolean)).size} helper="Companies with at least one client login." />
      </section>

      <section className="neo-card admin-access-section">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">New client login</span>
            <h2>Create company-scoped access</h2>
            <p>The client will use the normal login page. Their account is permanently filtered to the selected company at the database boundary.</p>
          </div>
        </div>
        <form className="admin-access-create-grid" onSubmit={createClient}>
          <label>Email address<input autoCapitalize="none" required spellCheck={false} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Company
            <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Select company…</option>
              {customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customerLabel(customer)}</option>)}
            </select>
          </label>
          <label>Telemetry region
            <select value={region} onChange={(event) => setRegion(event.target.value as TelemetryRegion)}>
              {regions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="admin-access-note">Access note<textarea placeholder="Client contact, approval reference or contract note." value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="button" disabled={saving || !customerId} type="submit">{saving ? 'Creating access…' : 'Create client access'}</button>
        </form>
      </section>

      <section className="neo-card admin-access-section">
        <div className="minimal-panel-header"><div><span className="minimal-kicker">Existing clients</span><h2>Company login register</h2></div></div>
        <EnterpriseDataTable columns={columns} data={clients} emptyMessage={loading ? 'Loading client accounts…' : 'No client accounts have been created yet.'} rowKey={(row) => row.user_id} />
      </section>

      {selected ? (
        <section className="neo-card admin-access-section">
          <div className="minimal-panel-header"><div><span className="minimal-kicker">Selected client</span><h2>{displayName(selected)}</h2><p>{selected.email}</p></div></div>
          <div className="admin-access-create-grid">
            <label>Company
              <select value={editCustomerId} onChange={(event) => setEditCustomerId(event.target.value)}>
                {customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customerLabel(customer)}</option>)}
              </select>
            </label>
            <label>Telemetry region
              <select value={editRegion} onChange={(event) => setEditRegion(event.target.value as TelemetryRegion)}>
                {regions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="admin-access-toggle"><input checked={editActive} type="checkbox" onChange={(event) => setEditActive(event.target.checked)} /><span>Client access active</span></label>
            <label className="admin-access-note">Access note<textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} /></label>
            <button className="button" disabled={saving || !editCustomerId} onClick={() => void saveSelected()} type="button">{saving ? 'Saving…' : 'Save client access'}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
