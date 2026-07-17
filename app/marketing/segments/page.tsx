'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { getSupabaseClient } from '@/lib/supabase/client';

type BranchFilter = 'all' | 'jhb' | 'cpt' | 'kzn';
type StatusFilter = 'all' | 'active' | 'inactive';
type MachineMappedFilter = 'all' | 'mapped' | 'unmapped';

type SegmentBreakdown = {
  category?: string;
  area?: string;
  salesman?: string;
  customer_count?: number;
};

type SegmentSummary = {
  customer_count?: number;
  active_customers?: number;
  inactive_customers?: number;
  with_machines?: number;
  without_machines?: number;
  with_email?: number;
  with_contract_reference?: number;
  category_breakdown?: SegmentBreakdown[];
  area_breakdown?: SegmentBreakdown[];
  salesman_breakdown?: SegmentBreakdown[];
};

type SegmentRow = {
  branch: string;
  customer_code: string | null;
  customer_name: string | null;
  category: string | null;
  area: string | null;
  sales_man: string | null;
  active_status: string | null;
  machine_mapped: string | null;
  service_days: string | null;
  last_contract_number: string | null;
  last_contract_type: string | null;
  email: string | null;
  phone: string | null;
  total_count: number;
};

const branches: BranchFilter[] = ['all', 'jhb', 'cpt', 'kzn'];
const statusFilters: StatusFilter[] = ['all', 'active', 'inactive'];
const machineFilters: MachineMappedFilter[] = ['all', 'mapped', 'unmapped'];

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function labelize(value: string) {
  if (value === 'all') return 'All';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanOption(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export default function MarketingSegmentsPage() {
  const [summary, setSummary] = useState<SegmentSummary | null>(null);
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState<BranchFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [machineMapped, setMachineMapped] = useState<MachineMappedFilter>('all');
  const [category, setCategory] = useState('all');
  const [salesman, setSalesman] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSegments() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [summaryResult, rowsResult] = await Promise.all([
      client.rpc('get_marketing_segment_summary', { p_branch: branch }),
      client.rpc('search_marketing_segments', {
        p_search: search.trim() || null,
        p_branch: branch,
        p_status: status,
        p_machine_mapped: machineMapped,
        p_category: category,
        p_salesman: salesman,
        p_offset: (page - 1) * pageSize,
        p_limit: pageSize,
      }),
    ]);

    const firstError = summaryResult.error ?? rowsResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const resultRows = (rowsResult.data ?? []) as SegmentRow[];
    setSummary((summaryResult.data ?? {}) as SegmentSummary);
    setRows(resultRows);
    setTotalRows(resultRows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadSegments().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load customer segments.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, branch, status, machineMapped, category, salesman, page, pageSize]);

  function resetPage(setter: () => void) {
    setter();
    setPage(1);
  }

  const categoryOptions = useMemo(() => {
    const values = (summary?.category_breakdown ?? []).map((item) => item.category).filter((value): value is string => Boolean(value));
    return ['all', ...values];
  }, [summary]);

  const salesmanOptions = useMemo(() => {
    const values = (summary?.salesman_breakdown ?? []).map((item) => item.salesman).filter((value): value is string => Boolean(value));
    return ['all', ...values];
  }, [summary]);

  const columns = useMemo<EnterpriseColumn<SegmentRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => row.customer_name ?? '', render: (row) => <strong>{row.customer_name ?? 'Unnamed customer'}</strong> },
    { id: 'code', header: 'Code', value: (row) => row.customer_code ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'status', header: 'Status', value: (row) => row.active_status ?? '', render: (row) => <StatusBadge value={cleanOption(row.active_status, 'unknown')} /> },
    { id: 'mapped', header: 'Machine mapped', value: (row) => row.machine_mapped ?? '', render: (row) => <StatusBadge value={cleanOption(row.machine_mapped, 'not mapped')} /> },
    { id: 'category', header: 'Category', value: (row) => row.category ?? '' },
    { id: 'area', header: 'Area', value: (row) => row.area ?? '' },
    { id: 'salesman', header: 'Salesman', value: (row) => row.sales_man ?? 'Unassigned' },
    { id: 'contract', header: 'Last contract', value: (row) => row.last_contract_number ?? '', render: (row) => <span>{row.last_contract_number ?? '-'}{row.last_contract_type ? ` • ${row.last_contract_type}` : ''}</span> },
    { id: 'contact', header: 'Contact', value: (row) => row.email ?? row.phone ?? '', render: (row) => <small>{row.email ?? row.phone ?? 'No contact detail'}</small> },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel"><div><div className="badge">Marketing</div><h1>Customer Segments</h1><p>Live customer segmentation by branch, category, salesman, contact readiness and machine mapping.</p></div></div>
      {error ? <div className="error">{error}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Customers" value={numberValue(summary?.customer_count).toLocaleString()} helper={`${numberValue(summary?.active_customers).toLocaleString()} active • ${numberValue(summary?.inactive_customers).toLocaleString()} inactive`} />
        <KpiCard label="Machine mapped" value={numberValue(summary?.with_machines).toLocaleString()} helper={`${numberValue(summary?.without_machines).toLocaleString()} customer records without machine mapping.`} />
        <KpiCard label="Contactable" value={numberValue(summary?.with_email).toLocaleString()} helper="Customer records with an email address for campaigns." />
        <KpiCard label="Contract-linked" value={numberValue(summary?.with_contract_reference).toLocaleString()} helper="Customer records with a last contract reference." />
      </div>

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={loadSegments} type="button">{loading ? 'Refreshing...' : 'Refresh segments'}</button>}
        description="Use these filters to build practical campaign audiences from the imported customer master data."
        lastUpdated={lastUpdated}
        title="Segment filters"
      />
      <div className="neo-card">
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => resetPage(() => setBranch(event.target.value as BranchFilter))}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Status<select value={status} onChange={(event) => resetPage(() => setStatus(event.target.value as StatusFilter))}>{statusFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Machine mapping<select value={machineMapped} onChange={(event) => resetPage(() => setMachineMapped(event.target.value as MachineMappedFilter))}>{machineFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Category<select value={category} onChange={(event) => resetPage(() => setCategory(event.target.value))}>{categoryOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'All categories' : item}</option>)}</select></label>
          <label>Salesman<select value={salesman} onChange={(event) => resetPage(() => setSalesman(event.target.value))}>{salesmanOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'All salesmen' : item}</option>)}</select></label>
        </div>
        <div className="feature-list" style={{ marginTop: 16 }}>
          {(summary?.category_breakdown ?? []).slice(0, 8).map((item) => <button className="feature-pill" key={item.category} onClick={() => resetPage(() => setCategory(item.category ?? 'all'))} type="button">{item.category}: {numberValue(item.customer_count).toLocaleString()}</button>)}
          {(summary?.salesman_breakdown ?? []).slice(0, 6).map((item) => <button className="feature-pill" key={item.salesman} onClick={() => resetPage(() => setSalesman(item.salesman ?? 'all'))} type="button">{item.salesman}: {numberValue(item.customer_count).toLocaleString()}</button>)}
        </div>
      </div>

      <RemoteDataTable
        columns={columns}
        emptyMessage="No customers match this segment."
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => `${row.branch}-${row.customer_code ?? row.customer_name}`}
        rows={rows}
        search={search}
        searchPlaceholder="Search customer, account code, category, area, salesman, email or phone"
        totalRows={totalRows}
      />
    </AppShell>
  );
}
