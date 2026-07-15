'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

export default function CustomerDirectoryPage() {
  const querySearch = useClientQueryParam('q');
  const customerSearch = useClientQueryParam('customer');
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCustomers() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('customers')
      .select('id, customer_name, customer_code, branch, phone, email, address, status')
      .order('customer_name')
      .limit(2000);
    if (loadError) setError(loadError.message);
    else {
      setCustomers((data ?? []) as CustomerRecord[]);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
      setLoading(false);
    });
  }, []);

  const columns = useMemo<EnterpriseColumn<CustomerRecord>[]>(() => [
    { id: 'name', header: 'Customer', value: (row) => row.customer_name, render: (row) => <Link href={`/customers/${row.id}`}><strong>{row.customer_name}</strong></Link>, sortable: true },
    { id: 'code', header: 'Account code', value: (row) => row.customer_code ?? '', sortable: true },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), sortable: true },
    { id: 'phone', header: 'Phone', value: (row) => row.phone ?? '', sortable: true },
    { id: 'email', header: 'Email', value: (row) => row.email ?? '', sortable: true },
    { id: 'address', header: 'Address', value: (row) => row.address ?? '', sortable: true },
    { id: 'status', header: 'Status', value: (row) => row.status ?? 'unknown', render: (row) => <StatusBadge value={row.status ?? 'unknown'} />, sortable: true },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><div className="badge">Customer Management</div><h1>Customer Directory</h1><p>Search customers and open a unified operational profile.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadCustomers} type="button">{loading ? 'Refreshing...' : 'Refresh directory'}</button>} description="Search by customer name, account code, branch, phone, email or address." lastUpdated={lastUpdated} title="Customer records" />
      <EnterpriseDataTable columns={columns} emptyMessage={loading ? 'Loading customers...' : 'No matching customers found.'} getSearchText={(row) => [row.id, row.customer_name, row.customer_code, row.branch, row.phone, row.email, row.address, row.status].join(' ')} initialSearch={querySearch || customerSearch} rowKey={(row) => row.id} rows={customers} searchPlaceholder="Search customer, account code, phone or address" />
    </AppShell>
  );
}
