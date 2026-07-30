'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

type BranchFilter = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';
type RenewalWindow = 'all' | 'overdue' | '30' | '60' | '90' | 'later' | 'no_end';

type SalesSummary = {
  contract_count?: number;
  renewals_overdue?: number;
  renewals_30?: number;
  renewals_60?: number;
  renewals_90?: number;
  renewals_no_end?: number;
  salesman_breakdown?: { salesman?: string; contract_count?: number }[];
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

const branches: BranchFilter[] = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const renewalWindows: RenewalWindow[] = ['all', 'overdue', '30', '60', '90', 'later', 'no_end'];

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function ContractRenewalsPage() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [rows, setRows] = useState<ContractRenewalRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState<BranchFilter>('all');
  const [salesman, setSalesman] = useState('all');
  const [renewalWindow, setRenewalWindow] = useState<RenewalWindow>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRenewals() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [summaryResult, rowsResult] = await Promise.all([
      client.rpc('get_sales_workspace_summary', { p_branch: branch, p_salesman: salesman }),
      client.rpc('search_contract_renewals', {
        p_search: search.trim() || null,
        p_branch: branch,
        p_salesman: salesman,
        p_window: renewalWindow,
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

    const resultRows = (rowsResult.data ?? []) as ContractRenewalRow[];
    setSummary((summaryResult.data ?? {}) as SalesSummary);
    setRows(resultRows);
    setTotalRows(resultRows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadRenewals().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load renewal marketing worklist.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, branch, salesman, renewalWindow, page, pageSize]);

  function resetPage(setter: () => void) {
    setter();
    setPage(1);
  }

  const salesmanOptions = useMemo(() => {
    const names = (summary?.salesman_breakdown ?? [])
      .map((item) => item.salesman)
      .filter((value): value is string => Boolean(value));
    return ['all', ...names];
  }, [summary]);

  function exportVisibleRows() {
    const header = ['Branch', 'Customer code', 'Customer', 'Salesman', 'Contract', 'Agreement type', 'Machine count', 'Start date', 'End date', 'Days to expire', 'Window'];
    const body = rows.map((row) => [row.branch.toUpperCase(), row.customer_code, row.customer_name, row.salesman, row.contract_number, row.agreement_type, row.machine_count, row.start_date_text, row.end_date_text, row.days_to_expire, labelize(row.renewal_window)]);
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contract-renewals-${branch}-${formatLocalDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const columns = useMemo<EnterpriseColumn<ContractRenewalRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => row.customer_name ?? '', render: (row) => <strong>{row.customer_name ?? 'Unnamed customer'}</strong> },
    { id: 'code', header: 'Code', value: (row) => row.customer_code ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'salesman', header: 'Salesman', value: (row) => row.salesman ?? 'Unassigned' },
    { id: 'contract', header: 'Contract', value: (row) => row.contract_number ?? '' },
    { id: 'type', header: 'Type', value: (row) => row.agreement_type ?? '' },
    { id: 'machines', header: 'Machines', value: (row) => row.machine_count ?? '' },
    { id: 'expiry', header: 'Expiry', value: (row) => row.days_to_expire ?? '', render: (row) => <><StatusBadge value={riskLabel(row)} /><small>{row.end_date_text ?? 'No end date'}{row.days_to_expire !== null ? ` • ${row.days_to_expire} day(s)` : ''}</small></> },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel"><div><div className="badge">Marketing</div><h1>Contract Renewal Marketing</h1><p>Live renewal campaign list from imported contract data.</p></div></div>
      {error ? <div className="error">{error}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Contracts" value={asNumber(summary?.contract_count).toLocaleString()} />
        <KpiCard label="Overdue" value={asNumber(summary?.renewals_overdue).toLocaleString()} helper="Contracts already past renewal date." />
        <KpiCard label="Due 30 / 60 / 90" value={`${asNumber(summary?.renewals_30)}/${asNumber(summary?.renewals_60)}/${asNumber(summary?.renewals_90)}`} helper="Renewal windows for campaign priority." />
        <KpiCard label="No end date" value={asNumber(summary?.renewals_no_end).toLocaleString()} helper="Records needing contract-date cleanup." />
      </div>

      <PageToolbar
        actions={<><button className="button secondary" disabled={loading} onClick={loadRenewals} type="button">{loading ? 'Refreshing...' : 'Refresh renewals'}</button><button className="button secondary" disabled={rows.length === 0} onClick={exportVisibleRows} type="button">Export visible CSV</button></>}
        description="Filter the renewal list, export the current campaign audience, or use Sales Workspace to convert rows into follow-up opportunities."
        lastUpdated={lastUpdated}
        title="Renewal campaign filters"
      />
      <div className="neo-card">
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => resetPage(() => setBranch(event.target.value as BranchFilter))}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Salesman<select value={salesman} onChange={(event) => resetPage(() => setSalesman(event.target.value))}>{salesmanOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'All salesmen' : item}</option>)}</select></label>
          <label>Renewal window<select value={renewalWindow} onChange={(event) => resetPage(() => setRenewalWindow(event.target.value as RenewalWindow))}>{renewalWindows.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
        </div>
      </div>

      <RemoteDataTable
        columns={columns}
        emptyMessage="No renewal records match this campaign filter."
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => `${row.branch}-${row.customer_code ?? row.customer_name}-${row.contract_number ?? row.start_date_text ?? ''}-${row.end_date_text ?? ''}-${row.days_to_expire ?? ''}`}
        rows={rows}
        search={search}
        searchPlaceholder="Search customer, account code, contract, type or salesman"
        totalRows={totalRows}
      />
    </AppShell>
  );
}
