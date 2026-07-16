'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_name: string;
  branch: Branch;
  status: string;
  approval_required: boolean;
  approval_status: string;
  estimated_total: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  expected_date: string | null;
  created_at: string;
};
type Suggestion = {
  stock_item_id: string;
  stock_name: string;
  sku: string | null;
  item_barcode: string;
  supplier_name: string | null;
  available_units: number;
  reorder_level: number;
  suggested_quantity: number;
  estimated_cost: number;
};

export function PurchaseApprovalPanel() {
  const { userDetails } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [view, setView] = useState<'pending' | 'draft' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const role = userDetails?.role ?? '';
  const canReview = ['admin', 'operations', 'finance', 'executive'].includes(role);
  const canCreate = ['admin', 'operations', 'warehouse_staff'].includes(role);

  async function loadApprovals() {
    setError(null);
    const client = getSupabaseClient();
    const [orderResult, suggestionResult] = await Promise.all([
      client.from('purchase_orders').select('id, po_number, supplier_name, branch, status, approval_required, approval_status, estimated_total, submitted_at, approved_at, expected_date, created_at').order('created_at', { ascending: false }).limit(500),
      client.from('stock_replenishment_suggestions').select('stock_item_id, stock_name, sku, item_barcode, supplier_name, available_units, reorder_level, suggested_quantity, estimated_cost').order('estimated_cost', { ascending: false }).limit(250),
    ]);
    const firstError = orderResult.error ?? suggestionResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    setOrders((orderResult.data ?? []) as PurchaseOrder[]);
    setSuggestions((suggestionResult.data ?? []) as Suggestion[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadApprovals().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load purchasing approvals.'));
  }, []);

  async function submit(order: PurchaseOrder) {
    setSavingId(order.id);
    setError(null);
    const { error: submitError } = await getSupabaseClient().rpc('submit_purchase_order_for_approval', { p_purchase_order_id: order.id });
    setSavingId(null);
    if (submitError) {
      setError(submitError.message);
      return;
    }
    setMessage(`${order.po_number} submitted for approval.`);
    await loadApprovals();
  }

  async function review(order: PurchaseOrder, approve: boolean) {
    setSavingId(order.id);
    setError(null);
    const { error: reviewError } = await getSupabaseClient().rpc('review_purchase_order', {
      p_purchase_order_id: order.id,
      p_approve: approve,
      p_notes: reviewNotes[order.id]?.trim() || null,
    });
    setSavingId(null);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    setMessage(`${order.po_number} ${approve ? 'approved' : 'rejected'}.`);
    setReviewNotes((current) => ({ ...current, [order.id]: '' }));
    await loadApprovals();
  }

  async function createSuggestionOrder(suggestion: Suggestion) {
    setSavingId(suggestion.stock_item_id);
    setError(null);
    const branch = (userDetails?.branch ?? 'national') as Branch;
    const { data, error: createError } = await getSupabaseClient().rpc('create_replenishment_purchase_order', { p_stock_item_id: suggestion.stock_item_id, p_branch: branch });
    setSavingId(null);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage(`Draft replenishment purchase order created: ${data}.`);
    await loadApprovals();
  }

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      const viewMatch = view === 'all'
        || (view === 'pending' && order.approval_status === 'pending')
        || (view === 'draft' && order.status === 'draft' && order.approval_status !== 'pending');
      const text = [order.po_number, order.supplier_name, order.branch, order.status, order.approval_status].join(' ').toLowerCase();
      return viewMatch && (!term || text.includes(term));
    });
  }, [orders, search, view]);

  const pendingCount = orders.filter((order) => order.approval_status === 'pending').length;
  const approvedValue = orders.filter((order) => order.approval_status === 'approved').reduce((sum, order) => sum + Number(order.estimated_total ?? 0), 0);
  const suggestedValue = suggestions.reduce((sum, item) => sum + Number(item.estimated_cost ?? 0), 0);

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>Pending approval</span><strong>{pendingCount}</strong></div>
        <div className="minimal-metric"><span>Approved value</span><strong>R {approvedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
        <div className="minimal-metric"><span>Replenishment suggestions</span><strong>{suggestions.length}</strong></div>
        <div className="minimal-metric"><span>Suggested spend</span><strong>R {suggestedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
      </div>

      <section className="neo-card">
        <div className="minimal-toolbar"><div><h2>Purchase approvals</h2><p>Submit draft orders and review controlled purchasing requests.</p></div><div className="action-row"><Link className="button secondary" href="/warehouse/purchasing">Open purchasing</Link><button className="button secondary" onClick={loadApprovals} type="button">Refresh</button></div></div>
        <div className="form-grid">
          <label>Queue<select value={view} onChange={(event) => setView(event.target.value as 'pending' | 'draft' | 'all')}><option value="pending">Pending approval</option><option value="draft">Draft orders</option><option value="all">All orders</option></select></label>
          <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PO number, supplier or branch" /></label>
          {lastUpdated ? <div style={{ alignSelf: 'end' }}><small>Updated {lastUpdated.toLocaleTimeString()}</small></div> : null}
        </div>
        <div className="minimal-list minimal-form-section">
          {filteredOrders.length === 0 ? <div className="minimal-empty">No purchase orders match this queue.</div> : filteredOrders.map((order) => (
            <article className="minimal-list-item" key={order.id}>
              <div>
                <div className="feature-list"><StatusBadge value={order.status} /><StatusBadge value={order.approval_status} /></div>
                <h3>{order.po_number}</h3>
                <p>{order.supplier_name} • {order.branch.toUpperCase()} • R {Number(order.estimated_total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                <small>{order.expected_date ? `Expected ${order.expected_date}` : 'No expected date'}{order.submitted_at ? ` • Submitted ${new Date(order.submitted_at).toLocaleString()}` : ''}</small>
                {order.approval_status === 'pending' ? <label className="minimal-form-section">Review note<input value={reviewNotes[order.id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [order.id]: event.target.value }))} /></label> : null}
              </div>
              <div className="action-row">
                {canCreate && order.status === 'draft' && order.approval_status !== 'pending' && order.approval_status !== 'approved' ? <button className="button secondary" disabled={savingId === order.id} onClick={() => submit(order)} type="button">Submit</button> : null}
                {canReview && order.approval_status === 'pending' ? <><button className="button" disabled={savingId === order.id} onClick={() => review(order, true)} type="button">Approve</button><button className="button secondary" disabled={savingId === order.id} onClick={() => review(order, false)} type="button">Reject</button></> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="neo-card">
        <div className="minimal-toolbar"><div><h2>Replenishment suggestions</h2><p>Low-stock items calculated from reorder levels and preferred order quantities.</p></div></div>
        <div className="minimal-list">
          {suggestions.length === 0 ? <div className="minimal-empty">No replenishment suggestions.</div> : suggestions.map((item) => (
            <article className="minimal-list-item" key={item.stock_item_id}>
              <div>
                <div className="feature-list"><StatusBadge value="critical" label="Low stock" /></div>
                <h3>{item.stock_name}</h3>
                <p>{item.sku ?? item.item_barcode} • {item.supplier_name ?? 'Supplier not assigned'}</p>
                <small>{item.available_units} available • reorder level {item.reorder_level} • suggested {item.suggested_quantity} • estimated R {Number(item.estimated_cost).toLocaleString(undefined, { maximumFractionDigits: 2 })}</small>
              </div>
              {canCreate ? <button className="button secondary" disabled={savingId === item.stock_item_id} onClick={() => createSuggestionOrder(item)} type="button">Create draft PO</button> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
