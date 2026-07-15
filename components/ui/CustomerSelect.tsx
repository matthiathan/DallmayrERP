'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

export type CustomerOption = {
  id: string;
  customer_name: string;
  branch: Branch;
  customer_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
};

export function CustomerSelect({
  value,
  onSelect,
  label = 'Customer name',
  required = false,
}: {
  value: string;
  onSelect: (customer: CustomerOption | null) => void;
  label?: string;
  required?: boolean;
}) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCustomers() {
      setLoading(true);
      setError(null);
      const { data, error: loadError } = await getSupabaseClient()
        .from('customers')
        .select('id, customer_name, branch, customer_code, phone, email, address, status')
        .order('customer_name', { ascending: true })
        .limit(2500);

      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      setCustomers((data ?? []) as CustomerOption[]);
      setLoading(false);
    }

    loadCustomers().catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not load customers.');
      setLoading(false);
    });
  }, []);

  const selectedId = useMemo(() => customers.find((customer) => customer.customer_name === value)?.id ?? '', [customers, value]);

  function handleChange(customerId: string) {
    const customer = customers.find((item) => item.id === customerId) ?? null;
    onSelect(customer);
  }

  return (
    <label>
      {label}
      <select required={required} value={selectedId} onChange={(event) => handleChange(event.target.value)}>
        <option value="">{loading ? 'Loading customers...' : 'Select customer'}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.customer_name}{customer.customer_code ? ` (${customer.customer_code})` : ''} - {customer.branch.toUpperCase()}
          </option>
        ))}
      </select>
      {error ? <span className="field-note danger">{error}</span> : null}
    </label>
  );
}
