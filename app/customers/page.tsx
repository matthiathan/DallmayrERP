'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { type EnterpriseColumn, type TableColumnFilters } from '@/components/ui/EnterpriseDataTable';
import type { MobileFilterChip } from '@/components/ui/MobileDataViews';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

const branches = ['all', 'jhb', 'cpt', 'kzn', 'national'] as const;
const statuses = ['all', 'active', 'inactive', 'unknown'] as const;

function normaliseSearch(value: string) {
  return value.trim().replace(/[,()]/g, ' ');
}

function containsPattern(value: string | undefined) {
  const clean = normaliseSearch(value ?? '').replace(/[%_\\]/g, '');
  return clean ? `%${clean}%` : null;
}

export default function CustomerDirectoryPage() {
  const querySearch = useClientQueryParam('q');
  const customerSearch = useClientQueryParam('customer');
  const initialSearch = querySearch || customerSearch || '';
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [columnFilters, setColumnFilters] = useState<TableColumnFilters>({});
  const [branch, setBranch] = useState<(typeof branches)[number]>('all');
  const [status, setStatus] = useState<(typeof statuses)[number]>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCustomers() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const offset = (page - 1) * pageSize;
    let query = client
      .from('customers')
      .select('id, customer_name, customer_code, branch, phone, email, address, status', { count: 'exact' })
      .order('customer_name')
      .range(offset, offset + pageSize - 1);

    if (branch !== 'all') query = query.eq('branch', branch);
    if (status !== 'all') query = query.eq('status', status);

    const cleanSearch = normaliseSearch(search);
    if (cleanSearch) {
      const pattern = `%${cleanSearch}%`;
      query = query.or([
        `customer_name.ilike.${pattern}`,
        `customer_code.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        `email.ilike.${pattern}`,
        `address.ilike.${pattern}`,
      ].join(','));
    }

    const customerFilter = containsPattern(columnFilters.name);
    const codeFilter = containsPattern(columnFilters.code);
    const branchFilter = containsPattern(columnFilters.branch);
    const phoneFilter = containsPattern(columnFilters.phone);
    const emailFilter = containsPattern(columnFilters.email);
    const addressFilter = containsPattern(columnFilters.address);
    const statusFilter = containsPattern(columnFilters.status);

    if (customerFilter) query = query.ilike('customer_name', customerFilter);
    if (codeFilter) query = query.ilike('customer_code', codeFilter);
    if (branchFilter) query = query.ilike('branch', branchFilter);
    if (phoneFilter) query = query.ilike('phone', phoneFilter);
    if (emailFilter) query = query.ilike('email', emailFilter);
    if (addressFilter) query = query.ilike('address', addressFilter);
    if (statusFilter) query = query.ilike('status', statusFilter);

    const { data, count, error: loadError } = await query;
    if (loadError) {
      setError(loadError.message);
    } else {
      setCustomers((data ?? []) as CustomerRecord[]);
      setTotalRows(count ?? 0);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadCustomers().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, columnFilters, branch, status, page, pageSize]);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updateBranch(value: string) {
    setBranch(value as (typeof branches)[number]);
    setPage(1);
  }

  function updateStatus(value: string) {
    setStatus(value as (typeof statuses)[number]);
    setPage(1);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setPage(1);
  }

  const columns = useMemo<EnterpriseColumn<CustomerRecord>[]>(() => [
    {
      id: 'name',
      header: 'Customer',
      value: (row) => row.customer_name,
      render: (row) => <Link href={`/customers/${row.id}`}><strong>{row.customer_name}</strong></Link>,
      mobileTitle: true,
    },
    { id: 'code', header: 'Account code', value: (row) => row.customer_code ?? '', mobilePriority: 1 },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), mobilePriority: 3 },
    { id: 'phone', header: 'Phone', value: (row) => row.phone ?? '', mobilePriority: 4 },
    { id: 'email', header: 'Email', value: (row) => row.email ?? '', mobileHidden: true },
    { id: 'address', header: 'Address', value: (row) => row.address ?? '', mobileHidden: true },
    {
      id: 'status',
      header: 'Status',
      value: (row) => row.status ?? 'unknown',
      render: (row) => <StatusBadge value={row.status ?? 'unknown'} />,
      mobilePriority: 2,
    },
  ], []);

  const mobileFilterChips = useMemo<MobileFilterChip[]>(() => {
    const chips: MobileFilterChip[] = [];
    if (branch !== 'all') chips.push({ id: 'branch', label: `Branch: ${branch.toUpperCase()}`, onRemove: () => updateBranch('all') });
    if (status !== 'all') chips.push({ id: 'status', label: `Status: ${status}`, onRemove: () => updateStatus('all') });
    return chips;
  }, [branch, status]);

  function clearMobileFilters() {
    setBranch('all');
    setStatus('all');
    setPage(1);
  }

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><div className="badge">Customer Management</div><h1>Customer Directory</h1><p>Search customers and open a unified operational profile.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadCustomers} type="button">{loading ? 'Refreshing...' : 'Refresh directory'}</button>} description="Database-backed search by customer name, account code, branch, phone, email or address. Each column also supports its own contains filter." lastUpdated={lastUpdated} title="Customer records" />
      <RemoteDataTable
        actions={null}
        columnFilters={columnFilters}
        columns={columns}
        emptyMessage="No matching customers found."
        filters={(
          <>
            <label>Branch<select value={branch} onChange={(event) => updateBranch(event.target.value)}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Status<select value={status} onChange={(event) => updateStatus(event.target.value)}>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </>
        )}
        loading={loading}
        mobileFilterChips={mobileFilterChips}
        onClearMobileFilters={clearMobileFilters}
        onColumnFiltersChange={(filters) => { setColumnFilters(filters); setPage(1); }}
        onPageChange={setPage}
        onPageSizeChange={updatePageSize}
        onSearchChange={updateSearch}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100, 250]}
        rowKey={(row) => row.id}
        rows={customers}
        search={search}
        searchPlaceholder="Search customer, account code, phone, email or address"
        tableId="customer-directory"
        totalRows={totalRows}
      />
    </AppShell>
  );
}
