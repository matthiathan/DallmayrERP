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
type CreditRiskFilter = 'all' | 'missing_limit' | 'high_limit' | 'long_terms';
type VatFilter = 'all' | 'with_vat' | 'missing_vat';
type DebitOrderFilter = 'all' | 'yes' | 'no';

type FinanceSummaryBreakdown = { vat_treatment?: string; credit_days?: string; account_count?: number };
type FinanceSummary = {
  account_count?: number;
  active_accounts?: number;
  with_credit_limit?: number;
  without_credit_limit?: number;
  high_credit_accounts?: number;
  credit_exposure?: number | string;
  with_vat_trn?: number;
  without_vat_trn?: number;
  debit_order_accounts?: number;
  vat_treatment_breakdown?: FinanceSummaryBreakdown[];
  credit_days_breakdown?: FinanceSummaryBreakdown[];
};

type FinanceRow = {
  branch: string;
  customer_code: string | null;
  customer_name: string | null;
  active_status: string | null;
  credit_days: string | null;
  credit_limit: string | null;
  credit_limit_value: number | string | null;
  vat_trn: string | null;
  vat_treatment: string | null;
  debit_order: string | null;
  currency: string | null;
  bill_to: string | null;
  email: string | null;
  phone: string | null;
  total_count: number;
};

const branches: BranchFilter[] = ['all', 'jhb', 'cpt', 'kzn'];
const creditRiskFilters: CreditRiskFilter[] = ['all', 'missing_limit', 'high_limit', 'long_terms'];
const vatFilters: VatFilter[] = ['all', 'with_vat', 'missing_vat'];
const debitOrderFilters: DebitOrderFilter[] = ['all', 'yes', 'no'];

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(asNumber(value));
}

function labelize(value: string) {
  if (value === 'all') return 'All';
  if (value === 'yes') return 'Debit order only';
  if (value === 'no') return 'No debit order';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function FinancePage() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [rows, setRows] = useState<FinanceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState<BranchFilter>('all');
  const [creditRisk, setCreditRisk] = useState<CreditRiskFilter>('all');
  const [vatFilter, setVatFilter] = useState<VatFilter>('all');
  const [debitOrder, setDebitOrder] = useState<DebitOrderFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFinance() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [summaryResult, rowsResult] = await Promise.all([
      client.rpc('get_finance_workspace_summary', { p_branch: branch }),
      client.rpc('search_finance_accounts', {
        p_search: search.trim() || null,
        p_branch: branch,
        p_credit_risk: creditRisk,
        p_vat_filter: vatFilter,
        p_debit_order: debitOrder,
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

    const resultRows = (rowsResult.data ?? []) as FinanceRow[];
    setSummary((summaryResult.data ?? {}) as FinanceSummary);
    setRows(resultRows);
    setTotalRows(resultRows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadFinance().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load finance workspace.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, branch, creditRisk, vatFilter, debitOrder, page, pageSize]);

  function resetPage(setter: () => void) {
    setter();
    setPage(1);
  }

  function exportVisibleRows() {
    const header = ['Branch', 'Code', 'Customer', 'Status', 'Credit days', 'Credit limit', 'VAT TRN', 'VAT treatment', 'Debit order', 'Currency', 'Bill To', 'Email', 'Phone'];
    const body = rows.map((row) => [
      row.branch.toUpperCase(),
      row.customer_code,
      row.customer_name,
      row.active_status,
      row.credit_days,
      row.credit_limit,
      row.vat_trn,
      row.vat_treatment,
      row.debit_order,
      row.currency,
      row.bill_to,
      row.email,
      row.phone,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-accounts-${branch}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const columns = useMemo<EnterpriseColumn<FinanceRow>[]>(() => [
    { id: 'customer', header: 'Customer', value: (row) => row.customer_name ?? '', render: (row) => <strong>{row.customer_name ?? 'Unnamed customer'}</strong> },
    { id: 'code', header: 'Code', value: (row) => row.customer_code ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'status', header: 'Status', value: (row) => row.active_status ?? '', render: (row) => <StatusBadge value={row.active_status ?? 'unknown'} /> },
    { id: 'terms', header: 'Credit terms', value: (row) => row.credit_days ?? '', render: (row) => <span>{row.credit_days || 'No terms'}</span> },
    { id: 'limit', header: 'Credit limit', value: (row) => asNumber(row.credit_limit_value), render: (row) => <strong>{formatCurrency(row.credit_limit_value)}</strong> },
    { id: 'vat', header: 'VAT', value: (row) => row.vat_trn ?? '', render: (row) => <span>{row.vat_trn || 'Missing'}{row.vat_treatment ? ` • ${row.vat_treatment}` : ''}</span> },
    { id: 'debit', header: 'Debit order', value: (row) => row.debit_order ?? '', render: (row) => <StatusBadge value={row.debit_order || 'not set'} /> },
    { id: 'bill', header: 'Bill To', value: (row) => row.bill_to ?? '' },
    { id: 'contact', header: 'Contact', value: (row) => row.email ?? row.phone ?? '', render: (row) => <small>{row.email ?? row.phone ?? 'No contact detail'}</small> },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Finance</div>
          <h1>Finance Workspace</h1>
          <p>Live credit, VAT, debit-order and customer-finance controls from the customer master source data.</p>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Accounts" value={asNumber(summary?.account_count).toLocaleString()} helper={`${asNumber(summary?.active_accounts).toLocaleString()} active accounts`} />
        <KpiCard label="Credit exposure" value={formatCurrency(summary?.credit_exposure)} helper={`${asNumber(summary?.high_credit_accounts).toLocaleString()} accounts over R50k limit`} />
        <KpiCard label="Missing VAT" value={asNumber(summary?.without_vat_trn).toLocaleString()} helper={`${asNumber(summary?.with_vat_trn).toLocaleString()} accounts have VAT TRN`} />
        <KpiCard label="Debit orders" value={asNumber(summary?.debit_order_accounts).toLocaleString()} helper="Accounts flagged for debit-order billing." />
      </div>

      <PageToolbar
        actions={<><button className="button secondary" disabled={loading} onClick={loadFinance} type="button">{loading ? 'Refreshing...' : 'Refresh finance data'}</button><button className="button secondary" disabled={rows.length === 0} onClick={exportVisibleRows} type="button">Export visible CSV</button></>}
        description="Filter finance exposure by branch, credit risk, VAT completeness and debit-order status."
        lastUpdated={lastUpdated}
        title="Finance control filters"
      />
      <div className="neo-card">
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => resetPage(() => setBranch(event.target.value as BranchFilter))}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Credit risk<select value={creditRisk} onChange={(event) => resetPage(() => setCreditRisk(event.target.value as CreditRiskFilter))}>{creditRiskFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>VAT filter<select value={vatFilter} onChange={(event) => resetPage(() => setVatFilter(event.target.value as VatFilter))}>{vatFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Debit order<select value={debitOrder} onChange={(event) => resetPage(() => setDebitOrder(event.target.value as DebitOrderFilter))}>{debitOrderFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
        </div>
        <div className="feature-list" style={{ marginTop: 16 }}>
          {(summary?.vat_treatment_breakdown ?? []).slice(0, 8).map((item) => <div className="feature-pill" key={item.vat_treatment}>{item.vat_treatment}: {asNumber(item.account_count).toLocaleString()}</div>)}
          {(summary?.credit_days_breakdown ?? []).slice(0, 6).map((item) => <div className="feature-pill" key={item.credit_days}>{item.credit_days}: {asNumber(item.account_count).toLocaleString()}</div>)}
        </div>
      </div>

      <RemoteDataTable
        columns={columns}
        emptyMessage="No finance accounts match the current filters."
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => `${row.branch}-${row.customer_code ?? row.customer_name}`}
        rows={rows}
        search={search}
        searchPlaceholder="Search customer, account code, VAT number, bill-to, email or phone"
        totalRows={totalRows}
      />
    </AppShell>
  );
}
