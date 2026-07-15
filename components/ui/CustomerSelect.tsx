'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

export type CustomerOption = CustomerRecord;

function safeFilterTerm(value: string) {
  return value.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
}

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
  const [search, setSearch] = useState(value);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const listboxId = useRef(`customer-options-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!open || value) setSearch(value);
  }, [open, value]);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const requestId = ++requestRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const term = safeFilterTerm(search);
      let query = getSupabaseClient()
        .from('customers')
        .select('id, customer_name, branch, customer_code, phone, email, address, status')
        .order('customer_name', { ascending: true })
        .limit(25);

      if (term) {
        const pattern = `%${term}%`;
        query = query.or(`customer_name.ilike.${pattern},customer_code.ilike.${pattern},phone.ilike.${pattern},address.ilike.${pattern}`);
      }

      const { data, error: loadError } = await query;
      if (requestId !== requestRef.current) return;

      if (loadError) {
        setError(loadError.message);
        setCustomers([]);
      } else {
        setCustomers((data ?? []) as CustomerOption[]);
        setActiveIndex(0);
      }
      setLoading(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [open, search]);

  function selectCustomer(customer: CustomerOption) {
    setSearch(customer.customer_name);
    setOpen(false);
    setError(null);
    onSelect(customer);
  }

  function clearSelection() {
    setSearch('');
    setCustomers([]);
    setOpen(true);
    onSelect(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(customers.length - 1, current + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    }
    if (event.key === 'Enter' && open && customers[activeIndex]) {
      event.preventDefault();
      selectCustomer(customers[activeIndex]);
    }
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <label className="customer-combobox-label">
      {label}
      <div className="customer-combobox" ref={rootRef}>
        <div className="customer-combobox-input-row">
          <input
            aria-autocomplete="list"
            aria-controls={listboxId.current}
            aria-expanded={open}
            autoComplete="off"
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearch(nextValue);
              setOpen(true);
              if (nextValue !== value) onSelect(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search name, account code, phone or address"
            required={required}
            role="combobox"
            type="search"
            value={search}
          />
          {search ? <button aria-label="Clear customer selection" className="customer-combobox-clear" onClick={clearSelection} type="button">×</button> : null}
        </div>

        {open ? (
          <div className="customer-combobox-menu" id={listboxId.current} role="listbox">
            {loading ? <div className="customer-combobox-state">Searching customers...</div> : null}
            {!loading && error ? <div className="customer-combobox-state danger">{error}</div> : null}
            {!loading && !error && customers.length === 0 ? <div className="customer-combobox-state">No matching customers found.</div> : null}
            {!loading && !error ? customers.map((customer, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`customer-combobox-option ${index === activeIndex ? 'is-active' : ''}`}
                key={customer.id}
                onClick={() => selectCustomer(customer)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <strong>{customer.customer_name}</strong>
                <span>{customer.customer_code ?? 'No account code'} • {customer.branch.toUpperCase()}</span>
                <small>{customer.phone ?? customer.address ?? 'No contact details'}</small>
              </button>
            )) : null}
          </div>
        ) : null}
      </div>
      {required && !value && search ? <span className="field-note">Choose a customer from the search results.</span> : null}
    </label>
  );
}
