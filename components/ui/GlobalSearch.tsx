'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type SearchResult = {
  id: string;
  type: 'Customer' | 'Machine' | 'Stock' | 'Delivery' | 'Service';
  title: string;
  subtitle: string;
  href: string;
};

function safeFilterTerm(value: string) {
  return value.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = safeFilterTerm(query);
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const pattern = `%${term}%`;
      const client = getSupabaseClient();

      try {
        const [customers, machines, stock, deliveries, services] = await Promise.all([
          client.from('customers').select('id, customer_name, customer_code, branch, address').or(`customer_name.ilike.${pattern},customer_code.ilike.${pattern}`).limit(6),
          client.from('machines').select('id, machine_name, serial_number, machine_barcode, branch, model').or(`machine_name.ilike.${pattern},serial_number.ilike.${pattern},machine_barcode.ilike.${pattern}`).limit(6),
          client.from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, warehouse_location').or(`stock_name.ilike.${pattern},item_barcode.ilike.${pattern},box_barcode.ilike.${pattern}`).limit(6),
          client.from('delivery_orders').select('id, order_number, customer_name, branch, status').or(`order_number.ilike.${pattern},customer_name.ilike.${pattern}`).limit(6),
          client.from('service_jobs').select('id, job_number, summary, branch, status').or(`job_number.ilike.${pattern},summary.ilike.${pattern}`).limit(6),
        ]);

        const queryError = customers.error ?? machines.error ?? stock.error ?? deliveries.error ?? services.error;
        if (queryError) throw queryError;
        if (requestId !== requestRef.current) return;

        const nextResults: SearchResult[] = [
          ...((customers.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string | null; branch: string; address: string | null }>).map((row) => ({
            id: row.id,
            type: 'Customer' as const,
            title: row.customer_name,
            subtitle: `${row.customer_code ?? 'No account code'} • ${row.branch.toUpperCase()}${row.address ? ` • ${row.address}` : ''}`,
            href: `/operations?customer=${row.id}`,
          })),
          ...((machines.data ?? []) as Array<{ id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; branch: string; model: string | null }>).map((row) => ({
            id: row.id,
            type: 'Machine' as const,
            title: row.machine_name ?? row.serial_number ?? row.machine_barcode ?? 'Unnamed machine',
            subtitle: `${row.model ?? 'Model not set'} • ${row.serial_number ?? 'No serial'} • ${row.branch.toUpperCase()}`,
            href: `/operations/assets?machine=${row.id}`,
          })),
          ...((stock.data ?? []) as Array<{ id: string; stock_name: string; item_barcode: string; item_quantity: number; warehouse_location: string | null }>).map((row) => ({
            id: row.id,
            type: 'Stock' as const,
            title: row.stock_name,
            subtitle: `${row.item_barcode} • ${row.item_quantity} item(s)${row.warehouse_location ? ` • ${row.warehouse_location}` : ''}`,
            href: `/warehouse/stock?stock=${row.id}`,
          })),
          ...((deliveries.data ?? []) as Array<{ id: string; order_number: string; customer_name: string; branch: string; status: string }>).map((row) => ({
            id: row.id,
            type: 'Delivery' as const,
            title: row.order_number,
            subtitle: `${row.customer_name} • ${row.branch.toUpperCase()} • ${row.status.replace(/_/g, ' ')}`,
            href: `/operations/deliveries?order=${row.id}`,
          })),
          ...((services.data ?? []) as Array<{ id: string; job_number: string; summary: string; branch: string; status: string }>).map((row) => ({
            id: row.id,
            type: 'Service' as const,
            title: row.job_number,
            subtitle: `${row.summary} • ${row.branch.toUpperCase()} • ${row.status.replace(/_/g, ' ')}`,
            href: `/operations/service-jobs?job=${row.id}`,
          })),
        ];

        setResults(nextResults.slice(0, 24));
      } catch (searchError) {
        if (requestId !== requestRef.current) return;
        setError(searchError instanceof Error ? searchError.message : 'Search could not be completed.');
        setResults([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [open, query]);

  function closeSearch() {
    setOpen(false);
    setQuery('');
    setResults([]);
    setError(null);
  }

  return (
    <>
      <button aria-haspopup="dialog" className="global-search-trigger" onClick={() => setOpen(true)} type="button">
        <span>Search ERP</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open ? (
        <div className="global-search-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSearch();
        }}>
          <section aria-label="Search DallmayrERP" aria-modal="true" className="global-search-dialog" role="dialog">
            <div className="global-search-input-row">
              <input
                aria-label="Search customers, machines, stock, delivery orders and service jobs"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer, serial number, barcode, order or job..."
                ref={inputRef}
                type="search"
                value={query}
              />
              <button aria-label="Close search" className="button secondary" onClick={closeSearch} type="button">Close</button>
            </div>

            <div className="global-search-quick-actions">
              <Link href="/operations/service-jobs" onClick={closeSearch}>Create service job</Link>
              <Link href="/warehouse/stock" onClick={closeSearch}>Scan stock</Link>
              <Link href="/operations/deliveries" onClick={closeSearch}>Open deliveries</Link>
              <Link href="/operations/assets" onClick={closeSearch}>Machine register</Link>
            </div>

            <div aria-live="polite" className="global-search-results">
              {loading ? <div className="global-search-state">Searching enterprise records...</div> : null}
              {error ? <div className="error">{error}</div> : null}
              {!loading && !error && query.trim().length < 2 ? <div className="global-search-state">Enter at least two characters. Press Esc to close.</div> : null}
              {!loading && !error && query.trim().length >= 2 && results.length === 0 ? <div className="global-search-state">No matching records were found.</div> : null}
              {results.map((result) => (
                <Link className="global-search-result" href={result.href} key={`${result.type}-${result.id}`} onClick={closeSearch}>
                  <span className="global-search-result-type">{result.type}</span>
                  <strong>{result.title}</strong>
                  <span>{result.subtitle}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
