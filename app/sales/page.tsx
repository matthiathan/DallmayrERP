'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayDetailsName } from '@/types/dallmayrerp';

type BranchFilter = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';
type RenewalWindow = 'all' | 'overdue' | '30' | '60' | '90' | 'later' | 'no_end';
type OpportunityStatus = 'all' | 'open' | 'follow_up' | 'quoted' | 'won' | 'lost' | 'cancelled';
type OpportunityType = 'all' | 'upgrade' | 'new_machine' | 'reactivation' | 'renewal' | 'other';
type Priority = 'low' | 'medium' | 'high' | 'critical';

type SummaryBreakdown = { branch?: string; customer_count?: number; salesman?: string; contract_count?: number };
type SalesSummary = {
  customer_count?: number;
  active_customer_count?: number;
  contract_count?: number;
  renewals_overdue?: number;
  renewals_30?: number;
  renewals_60?: number;
  renewals_90?: number;
  renewals_no_end?: number;
  open_opportunities?: number;
  won_opportunities?: number;
  lost_opportunities?: number;
  pipeline_value?: number | string;
  branch_breakdown?: SummaryBreakdown[];
  salesman_breakdown?: SummaryBreakdown[];
};

type ContractRenewalRow = {
  branch: string;
  contract_number: string | null;
  customer_code: string | null;
  customer_name: string | null;
  agreement_type: string | null;
  salesman: string | null;
  machine_count: number | null;
  start_date_text: string | null;
  end_date_text: string | null;
  days_to_expire: number | null;
  renewal_window: RenewalWindow;
  total_count: number;
};

type SalesOpportunityRow = {
  id: string;
  branch: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  opportunity_type: Exclude<OpportunityType, 'all'>;
  status: Exclude<OpportunityStatus, 'all'>;
  priority: Priority;
  estimated_value: number | null;
  next_action_date: string | null;
  owner_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  total_count: number;
};

const branches: BranchFilter[] = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const renewalWindows: RenewalWindow[] = ['all', 'overdue', '30', '60', '90', 'later', 'no_end'];
const opportunityStatuses: OpportunityStatus[] = ['all', 'open', 'follow_up', 'quoted', 'won', 'lost', 'cancelled'];
const opportunityTypes: OpportunityType[] = ['all', 'upgrade', 'new_machine', 'reactivation', 'renewal', 'other'];
const priorities: Priority[] = ['low', 'medium', 'high', 'critical'];

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(asNumber(value));
}

function labelize(value: string) {
  if (value === 'all') return 'All';
  if (value === 'no_end') return 'No end date';
  if (value === '30') return '0-30 days';
  if (value === '60') return '31-60 days';
  if (value === '90') return '61-90 days';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function riskLabel(row: ContractRenewalRow) {
  if (row.renewal_window === 'overdue') return 'overdue';
  if (row.renewal_window === '30') return 'urgent';
  if (row.renewal_window === '60') return 'warning';
  if (row.renewal_window === '90') return 'planned';
  if (row.renewal_window === 'no_end') return 'missing date';
  return 'future';
}

export default function SalesPage() {
  const { businessUser, userDetails } = useAuth();
  const currentUserName = displayDetailsName(userDetails, businessUser?.email ?? 'Sales user');
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [branch, setBranch] = useState<BranchFilter>(userDetails?.branch ?? 'all');
  const [salesman, setSalesman] = useState('all');
  const [renewalWindow, setRenewalWindow] = useState<RenewalWindow>('all');
  const [renewalSearch, setRenewalSearch] = useState('');
  const [renewalPage, setRenewalPage] = useState(1);
  const [renewalPageSize, setRenewalPageSize] = useState(50);
  const [renewals, setRenewals] = useState<ContractRenewalRow[]>([]);
  const [renewalTotal, setRenewalTotal] = useState(0);
  const [opportunitySearch, setOpportunitySearch] = useState('');
  const [opportunityStatus, setOpportunityStatus] = useState<OpportunityStatus>('all');
  const [opportunityType, setOpportunityType] = useState<OpportunityType>('all');
  const [opportunityPage, setOpportunityPage] = useState(1);
  const [opportunityPageSize, setOpportunityPageSize] = useState(50);
  const [opportunities, setOpportunities] = useState<SalesOpportunityRow[]>([]);
  const [opportunityTotal, setOpportunityTotal] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [newType, setNewType] = useState<Exclude<OpportunityType, 'all'>>('upgrade');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newValue, setNewValue] = useState('');
  const [nextActionDate, setNextActionDate] = useState(formatLocalDate());
  const [ownerName, setOwnerName] = useState(currentUserName);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setOwnerName(currentUserName);
  }, [currentUserName]);

  async function loadSalesWorkspace() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [summaryResult, renewalResult, opportunityResult] = await Promise.all([
      client.rpc('get_sales_workspace_summary', { p_branch: branch, p_salesman: salesman }),
      client.rpc('search_contract_renewals', {
        p_search: renewalSearch.trim() || null,
        p_branch: branch,
        p_salesman: salesman,
        p_window: renewalWindow,
        p_offset: (renewalPage - 1) * renewalPageSize,
        p_limit: renewalPageSize,
      }),
      client.rpc('search_sales_opportunities', {
        p_search: opportunitySearch.trim() || null,
        p_branch: branch,
        p_status: opportunityStatus,
        p_type: opportunityType,
        p_offset: (opportunityPage - 1) * opportunityPageSize,
        p_limit: opportunityPageSize,
      }),
    ]);

    const firstError = summaryResult.error ?? renewalResult.error ?? opportunityResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const renewalRows = (renewalResult.data ?? []) as ContractRenewalRow[];
    const opportunityRows = (opportunityResult.data ?? []) as SalesOpportunityRow[];
    setSummary((summaryResult.data ?? {}) as SalesSummary);
    setRenewals(renewalRows);
    setRenewalTotal(renewalRows[0]?.total_count ?? 0);
    setOpportunities(opportunityRows);
    setOpportunityTotal(opportunityRows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadSalesWorkspace().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load sales workspace.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [branch, salesman, renewalWindow, renewalSearch, renewalPage, renewalPageSize, opportunitySearch, opportunityStatus, opportunityType, opportunityPage, opportunityPageSize]);

  function updateBranch(value: BranchFilter) {
    setBranch(value);
    setRenewalPage(1);
    setOpportunityPage(1);
  }

  function updateSalesman(value: string) {
    setSalesman(value);
    setRenewalPage(1);
  }

  function updateRenewalWindow(value: RenewalWindow) {
    setRenewalWindow(value);
    setRenewalPage(1);
  }

  function updateRenewalSearch(value: string) {
    setRenewalSearch(value);
    setRenewalPage(1);
  }

  function updateOpportunitySearch(value: string) {
    setOpportunitySearch(value);
    setOpportunityPage(1);
  }

  function updateOpportunityStatusFilter(value: OpportunityStatus) {
    setOpportunityStatus(value);
    setOpportunityPage(1);
  }

  function updateOpportunityType(value: OpportunityType) {
    setOpportunityType(value);
    setOpportunityPage(1);
  }

  function handleCustomerSelect(customer: CustomerOption | null) {
    setSelectedCustomer(customer);
    setCustomerName(customer?.customer_name ?? '');
    if (customer) setBranch(customer.branch as BranchFilter);
  }

  async function createOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerName.trim()) {
      setError('Select a customer before creating an opportunity.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await getSupabaseClient().from('sales_opportunities').insert({
      branch: selectedCustomer?.branch ?? (branch === 'all' ? userDetails?.branch ?? 'jhb' : branch),
      customer_id: selectedCustomer?.id ?? null,
      customer_code: selectedCustomer?.customer_code ?? null,
      customer_name: customerName.trim(),
      opportunity_type: newType,
      status: 'open',
      priority: newPriority,
      estimated_value: newValue ? Number(newValue) : null,
      next_action_date: nextActionDate || null,
      owner_name: ownerName.trim() || currentUserName,
      notes: notes.trim() || null,
      source: 'manual',
      created_by: businessUser?.id ?? null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMessage('Sales opportunity created.');
    setSelectedCustomer(null);
    setCustomerName('');
    setNewType('upgrade');
    setNewPriority('medium');
    setNewValue('');
    setNotes('');
    setNextActionDate(formatLocalDate());
    await loadSalesWorkspace();
  }

  async function createRenewalOpportunity(row: ContractRenewalRow) {
    if (!row.customer_name) return;
    setSaving(true);
    setError(null);
    const client = getSupabaseClient();
    const { data: existing, error: existingError } = await client
      .from('sales_opportunities')
      .select('id')
      .eq('branch', row.branch)
      .eq('opportunity_type', 'renewal')
      .eq('customer_name', row.customer_name)
      .in('status', ['open', 'follow_up', 'quoted'])
      .limit(1);

    if (existingError) {
      setSaving(false);
      setError(existingError.message);
      return;
    }
    if ((existing ?? []).length > 0) {
      setSaving(false);
      setMessage('A live renewal opportunity already exists for this customer.');
      return;
    }

    const { error: insertError } = await client.from('sales_opportunities').insert({
      branch: row.branch,
      customer_code: row.customer_code,
      customer_name: row.customer_name,
      opportunity_type: 'renewal',
      status: 'follow_up',
      priority: row.renewal_window === 'overdue' || row.renewal_window === '30' ? 'high' : 'medium',
      next_action_date: formatLocalDate(),
      owner_name: row.salesman ?? currentUserName,
      notes: `Renewal follow-up from contract ${row.contract_number ?? 'not numbered'} (${labelize(row.renewal_window)}).`,
      source: 'contract_renewal',
      created_by: businessUser?.id ?? null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMessage('Renewal opportunity created.');
    await loadSalesWorkspace();
  }

  async function changeOpportunityStatus(id: string, status: Exclude<OpportunityStatus, 'all'>) {
    setSaving(true);
    const { error: updateError } = await getSupabaseClient().from('sales_opportunities').update({ status }).eq('id', id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage('Opportunity status updated.');
    await loadSalesWorkspace();
  }

  const salesmanOptions = useMemo(() => {
    const names = (summary?.salesman_breakdown ?? [])
      .map((item) => item.salesman)
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(['all', ...names]));
  }, [summary]);

  const renewalColumns = useMemo<EnterpriseColumn<ContractRenewalRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => row.customer_name ?? '', render: (row) => <strong>{row.customer_name ?? 'Unnamed customer'}</strong> },
    { id: 'code', header: 'Code', value: (row) => row.customer_code ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'salesman', header: 'Salesman', value: (row) => row.salesman ?? 'Unassigned' },
    { id: 'contract', header: 'Contract', value: (row) => row.contract_number ?? '' },
    { id: 'type', header: 'Type', value: (row) => row.agreement_type ?? '' },
    { id: 'machines', header: 'Machines', value: (row) => row.machine_count ?? '' },
    { id: 'expiry', header: 'Expiry', value: (row) => row.days_to_expire ?? '', render: (row) => <><StatusBadge value={riskLabel(row)} /><small>{row.end_date_text ?? 'No end date'}{row.days_to_expire !== null ? ` • ${row.days_to_expire} day(s)` : ''}</small></> },
    { id: 'action', header: 'Action', value: () => '', render: (row) => <button className="button secondary" disabled={saving || !row.customer_name} onClick={() => createRenewalOpportunity(row)} type="button">Create follow-up</button> },
  ], [saving, currentUserName, businessUser?.id]);

  const opportunityColumns = useMemo<EnterpriseColumn<SalesOpportunityRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => row.customer_name, render: (row) => row.customer_id ? <Link href={`/customers/${row.customer_id}`}><strong>{row.customer_name}</strong></Link> : <strong>{row.customer_name}</strong> },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'type', header: 'Type', value: (row) => row.opportunity_type, render: (row) => <StatusBadge value={labelize(row.opportunity_type)} /> },
    { id: 'priority', header: 'Priority', value: (row) => row.priority, render: (row) => <StatusBadge value={row.priority} /> },
    { id: 'value', header: 'Value', value: (row) => row.estimated_value ?? '', render: (row) => row.estimated_value ? formatCurrency(row.estimated_value) : '-' },
    { id: 'next', header: 'Next action', value: (row) => row.next_action_date ?? '', render: (row) => row.next_action_date ?? 'Not scheduled' },
    { id: 'owner', header: 'Owner', value: (row) => row.owner_name ?? '' },
    { id: 'notes', header: 'Notes', value: (row) => row.notes ?? '' },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <select aria-label="Opportunity status" disabled={saving} onChange={(event) => changeOpportunityStatus(row.id, event.target.value as Exclude<OpportunityStatus, 'all'>)} value={row.status}>{opportunityStatuses.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select> },
  ], [saving]);

  const renewalDue = asNumber(summary?.renewals_overdue) + asNumber(summary?.renewals_30) + asNumber(summary?.renewals_60) + asNumber(summary?.renewals_90);

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Sales</div>
          <h1>Sales Workspace</h1>
          <p>Live renewal follow-up, customer segmentation and opportunity tracking for sales staff.</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Renewals due" value={renewalDue.toLocaleString()} helper={`${asNumber(summary?.renewals_overdue).toLocaleString()} overdue • ${asNumber(summary?.renewals_30).toLocaleString()} in 30 days`} />
        <KpiCard label="Customers" value={asNumber(summary?.customer_count).toLocaleString()} helper={`${asNumber(summary?.active_customer_count).toLocaleString()} active customers in current filter.`} />
        <KpiCard label="Open opportunities" value={asNumber(summary?.open_opportunities).toLocaleString()} helper={`${asNumber(summary?.won_opportunities).toLocaleString()} won • ${asNumber(summary?.lost_opportunities).toLocaleString()} lost`} />
        <KpiCard label="Pipeline value" value={formatCurrency(summary?.pipeline_value)} helper="Open, follow-up and quoted opportunities." />
      </div>

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={loadSalesWorkspace} type="button">{loading ? 'Refreshing...' : 'Refresh sales data'}</button>}
        description="Filter sales activity by branch and salesman, then convert renewal risks into live follow-up opportunities."
        lastUpdated={lastUpdated}
        title="Sales control filters"
      />
      <div className="neo-card">
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => updateBranch(event.target.value as BranchFilter)}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Salesman<select value={salesman} onChange={(event) => updateSalesman(event.target.value)}>{salesmanOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'All salesmen' : item}</option>)}</select></label>
          <label>Renewal window<select value={renewalWindow} onChange={(event) => updateRenewalWindow(event.target.value as RenewalWindow)}>{renewalWindows.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Opportunity status<select value={opportunityStatus} onChange={(event) => updateOpportunityStatusFilter(event.target.value as OpportunityStatus)}>{opportunityStatuses.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
        </div>
        <div className="feature-list" style={{ marginTop: 16 }}>
          {(summary?.branch_breakdown ?? []).map((item) => <div className="feature-pill" key={item.branch}>{String(item.branch ?? '').toUpperCase()}: {asNumber(item.customer_count).toLocaleString()} customers</div>)}
          {(summary?.salesman_breakdown ?? []).slice(0, 6).map((item) => <div className="feature-pill" key={item.salesman}>{item.salesman}: {asNumber(item.contract_count).toLocaleString()} contracts</div>)}
        </div>
      </div>

      <PageToolbar description="Contracts from the imported JHB, CPT and KZN agreement tables. Use this list to create renewal follow-up opportunities." title="Renewal follow-up worklist" />
      <RemoteDataTable
        columns={renewalColumns}
        emptyMessage="No contract renewals match the current filters."
        loading={loading}
        onPageChange={setRenewalPage}
        onPageSizeChange={(value) => { setRenewalPageSize(value); setRenewalPage(1); }}
        onSearchChange={updateRenewalSearch}
        page={renewalPage}
        pageSize={renewalPageSize}
        rowKey={(row) => `${row.branch}-${row.customer_code ?? row.customer_name}-${row.contract_number ?? row.start_date_text ?? ''}-${row.end_date_text ?? ''}-${row.days_to_expire ?? ''}`}
        rows={renewals}
        search={renewalSearch}
        searchPlaceholder="Search renewal customer, account code, contract, type or salesman"
        totalRows={renewalTotal}
      />

      <section className="neo-card">
        <h2>Create opportunity</h2>
        <p>Capture upgrade, new machine, reactivation or renewal opportunities against a customer account.</p>
        <form className="grid" onSubmit={createOpportunity}>
          <div className="form-grid">
            <CustomerSelect value={customerName} onSelect={handleCustomerSelect} required />
            <label>Opportunity type<select value={newType} onChange={(event) => setNewType(event.target.value as Exclude<OpportunityType, 'all'>)}>{opportunityTypes.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
            <label>Priority<select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)}>{priorities.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
            <label>Estimated value<input inputMode="decimal" min="0" onChange={(event) => setNewValue(event.target.value)} placeholder="R value" type="number" value={newValue} /></label>
            <label>Next action date<input onChange={(event) => setNextActionDate(event.target.value)} type="date" value={nextActionDate} /></label>
            <label>Owner<input onChange={(event) => setOwnerName(event.target.value)} value={ownerName} /></label>
          </div>
          <label>Notes<textarea onChange={(event) => setNotes(event.target.value)} placeholder="Follow-up requirement, machine need, renewal context or customer request" value={notes} /></label>
          <button className="button" disabled={saving || !customerName.trim()} type="submit">Create opportunity</button>
        </form>
      </section>

      <PageToolbar description="Live opportunity pipeline linked to customers. Update the status as calls, quotes and outcomes progress." title="Opportunity pipeline" />
      <RemoteDataTable
        columns={opportunityColumns}
        emptyMessage="No sales opportunities match the current filters."
        filters={<div className="form-grid"><label>Type<select value={opportunityType} onChange={(event) => updateOpportunityType(event.target.value as OpportunityType)}>{opportunityTypes.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label><label>Status<select value={opportunityStatus} onChange={(event) => updateOpportunityStatusFilter(event.target.value as OpportunityStatus)}>{opportunityStatuses.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label></div>}
        loading={loading}
        onPageChange={setOpportunityPage}
        onPageSizeChange={(value) => { setOpportunityPageSize(value); setOpportunityPage(1); }}
        onSearchChange={updateOpportunitySearch}
        page={opportunityPage}
        pageSize={opportunityPageSize}
        rowKey={(row) => row.id}
        rows={opportunities}
        search={opportunitySearch}
        searchPlaceholder="Search opportunity customer, owner, type or notes"
        totalRows={opportunityTotal}
      />
    </AppShell>
  );
}
