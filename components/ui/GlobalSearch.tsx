'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

type SearchResult = {
  id: string;
  type: 'Page' | 'Machine' | 'Device';
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
  triggerLabel = 'Search machines or devices',
}: GlobalSearchProps = {}) {
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
    const focusedPages = [
      { href: '/', label: 'Fleet Overview', section: 'Monitoring', description: 'Fleet health, sales, faults and connectivity.' },
      { href: '/machines', label: 'Machines', section: 'Monitoring', description: 'Every machine and connected device.' },
      { href: '/alerts', label: 'Alerts', section: 'Monitoring', description: 'Current machine faults and offline devices.' },
      { href: '/telemetry', label: 'Analytics', section: 'Telemetry', description: 'Item quantities, trends and activity.' },
      { href: '/map', label: 'Machine Map', section: 'Telemetry', description: 'Last known telemetry device positions.' },
      { href: '/telemetry/devices', label: 'Device Management', section: 'Management', description: 'Assign and manage telemetry controllers.' },
    ];
    return focusedPages.map((item) => ({
      id: item.href,
      type: 'Page' as const,
      title: item.label,
      subtitle: `${item.section} • ${item.description}`,
      href: item.href,
    }));
  }, []);

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
        const [machines, devices] = await Promise.all([
          client.from('machines').select('id,machine_name,serial_number,machine_barcode,asset_tag,branch,model,status').or(`machine_name.ilike.${pattern},serial_number.ilike.${pattern},machine_barcode.ilike.${pattern},asset_tag.ilike.${pattern},model.ilike.${pattern}`).limit(15),
          client.from('telemetry_devices').select('id,device_code,machine_id,status,firmware_version,last_seen_at').ilike('device_code', pattern).limit(10),
        ]);
        const queryError = machines.error ?? devices.error;
        if (queryError) throw queryError;
        if (requestId !== requestRef.current) return;

        const nextResults: SearchResult[] = [
          ...((machines.data ?? []) as Array<{ id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; asset_tag: string | null; branch: string; model: string | null; status: string }>).map((row) => ({
            id: row.id,
            type: 'Machine' as const,
            title: row.machine_name ?? row.serial_number ?? row.machine_barcode ?? row.asset_tag ?? 'Unnamed machine',
            subtitle: `${row.model ?? 'Type not recorded'} • ${row.serial_number ?? 'No serial'} • QR ${row.machine_barcode ?? row.asset_tag ?? 'not recorded'} • ${row.branch.toUpperCase()} • ${row.status}`,
            href: `/machines/${row.id}`,
          })),
          ...((devices.data ?? []) as Array<{ id: string; device_code: string; machine_id: string | null; status: string; firmware_version: string | null; last_seen_at: string | null }>).map((row) => ({
            id: row.id,
            type: 'Device' as const,
            title: row.device_code,
            subtitle: `${row.status} • ${row.firmware_version ?? 'Firmware not reported'} • ${row.last_seen_at ? `Last seen ${new Date(row.last_seen_at).toLocaleString('en-ZA')}` : 'Never connected'}`,
            href: row.machine_id ? `/machines/${row.machine_id}` : '/telemetry/devices',
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
      <section aria-label="Find a machine, telemetry device or monitoring page" aria-modal="true" className="global-search-dialog" id={GLOBAL_SEARCH_DIALOG_ID} ref={dialogRef} role="dialog">
        <div className="global-search-input-row">
          <input aria-label="Search machines, serial numbers, QR numbers or telemetry devices" onChange={(event) => setQuery(event.target.value)} placeholder="Search machine, serial, QR number or device ID..." ref={inputRef} type="search" value={query} />
          <button aria-label="Close search" className="button secondary" onClick={closeSearch} type="button">Close</button>
        </div>
        <div className="global-search-quick-actions">
          <Link href="/machines" onClick={closeSearch}>Find a machine</Link>
          <Link href="/alerts" onClick={closeSearch}>Active alerts</Link>
          <Link href="/telemetry" onClick={closeSearch}>Sales analytics</Link>
          <Link href="/map" onClick={closeSearch}>Machine map</Link>
          <Link href="/telemetry/devices" onClick={closeSearch}>Manage devices</Link>
        </div>
        <div aria-live="polite" className="global-search-results">
          {loading ? <div className="global-search-state">Searching records…</div> : null}
          {error ? <div className="error" role="alert">{error}</div> : null}
          {!loading && !error && query.trim().length < 2 ? <div className="global-search-state">Type at least two characters to search by machine name, serial number, QR number or device ID.</div> : null}
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
