'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { WorkExecutionPanel } from '@/components/features/WorkExecutionPanel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null; machine_barcode: string | null };
type WorkOption = {
  id: string;
  work_number: string;
  title: string;
  work_type: string;
  status: string;
  priority: string;
  branch: string;
  assigned_to: string | null;
  customer_id: string | null;
  machine_id: string | null;
  due_at: string | null;
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function WorkExecutionWorkspace() {
  const { businessUser, userDetails } = useAuth();
  const [workItems, setWorkItems] = useState<WorkOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadWork() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('work_items')
      .select('id, work_number, title, work_type, status, priority, branch, assigned_to, customer_id, machine_id, due_at, customers(customer_name), machines(machine_name, serial_number, machine_barcode)')
      .not('status', 'in', '(completed,cancelled)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(500);
    if (loadError) {
      setError(loadError.message);
    } else {
      const rows = (data ?? []) as WorkOption[];
      setWorkItems(rows);
      const preferred = rows.find((item) => item.assigned_to === businessUser?.id) ?? rows[0];
      setSelectedId((current) => current || preferred?.id || '');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadWork().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load work items.');
      setLoading(false);
    });
  }, [businessUser?.id]);

  const canSeeAll = ['admin', 'operations'].includes(userDetails?.role ?? '');
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return workItems.filter((item) => {
      const customer = firstRelation(item.customers)?.customer_name ?? '';
      const machine = firstRelation(item.machines);
      const text = [item.work_number, item.title, item.work_type, item.priority, item.branch, customer, machine?.machine_name, machine?.serial_number, machine?.machine_barcode].join(' ').toLowerCase();
      const ownershipMatch = view === 'all' || item.assigned_to === businessUser?.id;
      return ownershipMatch && (!term || text.includes(term));
    });
  }, [businessUser?.id, search, view, workItems]);

  const selected = workItems.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      <div className="minimal-split">
        <aside className="neo-card">
          <div className="minimal-toolbar"><div><h2>Open work</h2><p>Select an item to execute. Partial words, serials and barcodes are supported.</p></div><button className="button secondary" onClick={loadWork} type="button">Refresh</button></div>
          <div className="form-grid">
            <label>Search<input autoComplete="off" autoCorrect="off" spellCheck={false} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Part of number, title, customer, serial or barcode" /></label>
            {canSeeAll ? <label>View<select value={view} onChange={(event) => setView(event.target.value as 'mine' | 'all')}><option value="mine">My assigned work</option><option value="all">All open work</option></select></label> : null}
          </div>
          <div className="minimal-list minimal-form-section">
            {filtered.length === 0 ? <div className="minimal-empty">{loading ? 'Loading work...' : 'No open work matches this partial search.'}</div> : filtered.map((item) => {
              const customer = firstRelation(item.customers)?.customer_name;
              const machine = firstRelation(item.machines);
              return <button className={`minimal-list-item ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button"><div><span className="nav-heading">{item.work_number}</span><h3>{item.title}</h3><p>{customer ?? 'No customer'}{machine ? ` • ${machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Machine'}` : ''}</p></div><div><StatusBadge value={item.status} /><StatusBadge value={item.priority} /></div></button>;
            })}
          </div>
        </aside>

        <section className="grid">
          {!selected ? <div className="minimal-empty">Select a work item to begin.</div> : <>
            <div className="neo-card">
              <div className="minimal-toolbar"><div><span className="nav-heading">{selected.work_number}</span><h2>{selected.title}</h2><p>{selected.branch.toUpperCase()} • {selected.due_at ? `Due ${new Date(selected.due_at).toLocaleString()}` : 'No due date'}</p></div><div className="action-row"><StatusBadge value={selected.status} /><StatusBadge value={selected.priority} /><Link className="button secondary" href={`/work/${selected.id}`}>Full record</Link></div></div>
            </div>
            <WorkExecutionPanel workItemId={selected.id} machineId={selected.machine_id} customerId={selected.customer_id} />
          </>}
        </section>
      </div>
    </div>
  );
}
