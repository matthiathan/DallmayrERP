'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { isNavItemAllowed, navSections } from '@/lib/auth/permissions';
import { groupEnterpriseNavigationSections } from '@/lib/navigation/enterpriseNavigation';
import { getSupplementalNavigationSections } from '@/lib/navigation/supplementalNavigation';
import { getSupabaseClient } from '@/lib/supabase/client';

type SearchResult = {
  id: string;
  type: 'Page' | 'Work' | 'Customer' | 'Machine' | 'Stock' | 'Delivery' | 'Service';
  title: string;
  subtitle: string;
  href: string;
};

type GlobalSearchProps = {
  enableShortcut?: boolean;
  showShortcut?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
};

const OPEN_SEARCH_EVENT = 'dallmayr-open-global-search';
const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true';
const GLOBAL_SEARCH_DIALOG_ID = 'global-search-dialog';

function safeFilterTerm(value: string) {
  return value.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
}

function includesTerm(value: string | undefined, term: string) {
  return Boolean(value?.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
}

export function GlobalSearch({
  enableShortcut = true,
  showShortcut = true,
  triggerClassName = '',
  triggerLabel = 'Search records',
}: GlobalSearchProps = {}) {
  const { userDetails } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recordResults, setRecordResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);

  const availablePages = useMemo<SearchResult[]>(() => {
    if (!userDetails?.role) return [];
    const seen = new Set<string>();
    const roleSections = navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => isNavItemAllowed(userDetails.role, item)),
      }))
      .filter((section) => section.items.length > 0);
    const searchSections = groupEnterpriseNavigationSections(userDetails.role, [
      ...getSupplementalNavigationSections(userDetails.role, MESSAGING_ENABLED),
      ...roleSections,
    ]);
    const pages = searchSections.flatMap((section) => section.items.map((item) => ({
      id: item.href,
      type: 'Page' as const,
      title: item.label,
      subtitle: `${section.heading}${item.description ? ` • ${item.description}` : ''}`,
      href: item.href,
    })));

    return pages.filter((page) => {
      if (seen.has(page.href)) return false;
      seen.add(page.href);
      return true;
    });
  }, [userDetails?.role]);

  const pageResults = useMemo(() => {
    const term = safeFilterTerm(query);
    if (term.length < 2) return [];
    return availablePages.filter((page) => (
      includesTerm(page.title, term)
      || includesTerm(page.subtitle, term)
      || includesTerm(page.href.replaceAll('/', ' '), term)
    )).slice(0, 10);
  }, [availablePages, query]);

  const results = useMemo(
    () => [...pageResults, ...recordResults].slice(0, 30),
    [pageResults, recordResults],
  );

  useEffect(() => {
    function openSearch() {
      setOpen(true);
    }

    function handleShortcut(event: KeyboardEvent) {
      if (enableShortcut && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener('keydown', handleShortcut);
    if (enableShortcut) window.addEventListener(OPEN_SEARCH_EVENT, openSearch);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      if (enableShortcut) window.removeEventListener(OPEN_SEARCH_EVENT, openSearch);
    };
  }, [enableShortcut]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeyDown);
      const restoreTarget = restoreFocusRef.current ?? triggerRef.current;
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = safeFilterTerm(query);
    if (term.length < 2) {
      setRecordResults([]);
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
        const [work, customers, machines, stock, deliveries, services] = await Promise.all([
          client.from('work_items').select('id, work_number, title, department, branch, priority, status').or(`work_number.ilike.${pattern},title.ilike.${pattern},department.ilike.${pattern}`).limit(6),
          client.from('customers').select('id, customer_name, customer_code, branch, address').or(`customer_name.ilike.${pattern},customer_code.ilike.${pattern}`).limit(6),
          client.from('machines').select('id, machine_name, serial_number, machine_barcode, branch, model, condition').or(`machine_name.ilike.${pattern},serial_number.ilike.${pattern},machine_barcode.ilike.${pattern}`).limit(6),
          client.from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, warehouse_location').or(`stock_name.ilike.${pattern},item_barcode.ilike.${pattern},box_barcode.ilike.${pattern}`).limit(6),
          client.from('delivery_orders').select('id, order_number, customer_name, branch, status').or(`order_number.ilike.${pattern},customer_name.ilike.${pattern}`).limit(6),
          client.from('service_jobs').select('id, job_number, summary, branch, status').or(`job_number.ilike.${pattern},summary.ilike.${pattern}`).limit(6),
        ]);
        const queryError = work.error ?? customers.error ?? machines.error ?? stock.error ?? deliveries.error ?? services.error;
        if (queryError) throw queryError;
        if (requestId !== requestRef.current) return;

        const nextResults: SearchResult[] = [
          ...((work.data ?? []) as Array<{ id: string; work_number: string; title: string; department: string; branch: string; priority: string; status: string }>).map((row) => ({
            id: row.id,
            type: 'Work' as const,
            title: `${row.work_number} — ${row.title}`,
            subtitle: `${row.department} • ${row.branch.toUpperCase()} • ${row.priority} • ${row.status.replace(/_/g, ' ')}`,
            href: `/work/${row.id}`,
          })),
          ...((customers.data ?? []) as Array<{ id: string; customer_name: string; customer_code: string | null; branch: string; address: string | null }>).map((row) => ({
            id: row.id,
            type: 'Customer' as const,
            title: row.customer_name,
            subtitle: `${row.customer_code ?? 'No account code'} • ${row.branch.toUpperCase()}${row.address ? ` • ${row.address}` : ''}`,
            href: `/customers/${row.id}`,
          })),
          ...((machines.data ?? []) as Array<{ id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; branch: string; model: string | null; condition: string }>).map((row) => ({
            id: row.id,
            type: 'Machine' as const,
            title: row.machine_name ?? row.serial_number ?? row.machine_barcode ?? 'Unnamed machine',
            subtitle: `${row.model ?? 'Model not set'} • ${row.serial_number ?? 'No serial'} • ${row.branch.toUpperCase()} • ${row.condition}`,
            href: `/operations/assets/${row.id}`,
          })),
          ...((stock.data ?? []) as Array<{ id: string; stock_name: string; item_barcode: string; item_quantity: number; warehouse_location: string | null }>).map((row) => ({
            id: row.id,
            type: 'Stock' as const,
            title: row.stock_name,
            subtitle: `${row.item_barcode} • ${row.item_quantity} item(s)${row.warehouse_location ? ` • ${row.warehouse_location}` : ''}`,
            href: `/warehouse/stock/${row.id}`,
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
        setRecordResults(nextResults);
      } catch (searchError) {
        if (requestId !== requestRef.current) return;
        setError(searchError instanceof Error ? searchError.message : 'Record search could not be completed. Page results are still available.');
        setRecordResults([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [open, query]);

  function closeSearch() {
    setOpen(false);
    setQuery('');
    setRecordResults([]);
    setError(null);
  }

  const dialog = open ? createPortal(
    <div className="global-search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSearch(); }}>
      <section aria-label="Find a page, record or task" aria-modal="true" className="global-search-dialog" id={GLOBAL_SEARCH_DIALOG_ID} ref={dialogRef} role="dialog">
        <div className="global-search-input-row">
          <input aria-label="Search pages, customers, work numbers, machines, barcodes, orders or service jobs" onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, customers, jobs, serials, barcodes or orders..." ref={inputRef} type="search" value={query} />
          <button aria-label="Close search" className="button secondary" onClick={closeSearch} type="button">Close</button>
        </div>
        <div className="global-search-quick-actions"><Link href="/work" onClick={closeSearch}>Review actions</Link><Link href="/customers" onClick={closeSearch}>Find a customer</Link><Link href="/operations/service-jobs" onClick={closeSearch}>Find a service job</Link><Link href="/warehouse/stock" onClick={closeSearch}>Check stock</Link><Link href="/operations/assets" onClick={closeSearch}>Find a machine</Link></div>
        <div aria-live="polite" className="global-search-results">
          {loading ? <div className="global-search-state">Searching records…</div> : null}
          {error ? <div className="error" role="alert">{error}</div> : null}
          {!loading && !error && query.trim().length < 2 ? <div className="global-search-state">Type at least two characters. You can search for a page such as Assets or a record identifier.</div> : null}
          {!loading && query.trim().length >= 2 && results.length === 0 ? <div className="global-search-state">No matching pages or records found. Check the spelling or try a different identifier.</div> : null}
          {results.map((result) => <Link className="global-search-result" href={result.href} key={`${result.type}-${result.id}`} onClick={closeSearch}><span className="global-search-result-type">{result.type}</span><strong>{result.title}</strong><span>{result.subtitle}</span></Link>)}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        aria-controls={GLOBAL_SEARCH_DIALOG_ID}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`global-search-trigger ${triggerClassName}`.trim()}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <span>{triggerLabel}</span>
        {showShortcut ? <kbd>Ctrl K</kbd> : null}
      </button>
      {dialog}
    </>
  );
}