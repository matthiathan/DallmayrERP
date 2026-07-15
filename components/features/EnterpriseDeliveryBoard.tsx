'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { DeliveryOrderRecord, DeliveryStatus } from '@/types/enterprise-records';

const statuses: DeliveryStatus[] = ['draft', 'picked', 'dispatched', 'delivered', 'closed', 'cancelled'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

function nextStatuses(status: DeliveryStatus): DeliveryStatus[] {
  const map: Record<DeliveryStatus, DeliveryStatus[]> = {
    draft: ['draft', 'picked', 'cancelled'],
    picked: ['picked', 'dispatched', 'cancelled'],
    dispatched: ['dispatched', 'delivered', 'cancelled'],
    delivered: ['delivered', 'closed'],
    closed: ['closed'],
    cancelled: ['cancelled'],
  };
  return map[status];
}

export function EnterpriseDeliveryBoard() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [search, setSearch] = useState(searchParams.get('order') ?? '');
  const [branchFilter, setBranchFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadOrders() {
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('delivery_orders')
      .select('id, order_number, branch, customer_name, delivery_address, status, created_at, dispatched_at, delivered_at, closed_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (loadError) throw loadError;
    setOrders((data ?? []) as DeliveryOrderRecord[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadOrders().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load delivery orders.'));
  }, []);

  async function updateStatus(order: DeliveryOrderRecord, status: DeliveryStatus) {
    if (order.status === status) return;
    setUpdatingId(order.id);
    setError(null);
    setMessage(null);
    const { error: updateError } = await getSupabaseClient().rpc('transition_delivery_order', { order_id: order.id, new_status: status });
    setUpdatingId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage(`${order.order_number} moved to ${status}.`);
    await loadOrders();
  }

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      const text = [order.id, order.order_number, order.customer_name, order.delivery_address, order.branch, order.status].join(' ').toLowerCase();
      return (!term || text.includes(term)) && (branchFilter === 'all' || order.branch === branchFilter);
    });
  }, [branchFilter, orders, search]);

  const grouped = useMemo(() => statuses.map((status) => ({ status, orders: filteredOrders.filter((order) => order.status === status) })), [filteredOrders]);

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" onClick={() => loadOrders().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh board</button>}
        description="Search delivery work and move each order only through its valid operating stages."
        lastUpdated={lastUpdated}
        title="Delivery execution"
      >
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer or address" type="search" /></label>
        <label>Branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
      </PageToolbar>

      <div className="grid grid-3">
        {grouped.map((group) => (
          <section className="neo-card spatial-card" key={group.status}>
            <div className="page-toolbar-heading"><h3>{group.status}</h3><StatusBadge value={group.status} /></div>
            <p>{group.orders.length} order(s)</p>
            <div className="grid">
              {group.orders.length === 0 ? <div className="feature-pill">No orders in this stage</div> : null}
              {group.orders.map((order) => (
                <article className="card" key={order.id}>
                  <div className="page-toolbar-heading"><strong>{order.order_number}</strong><StatusBadge value={order.status} /></div>
                  <p><strong>{order.customer_name}</strong><br />{order.branch.toUpperCase()}<br />{order.delivery_address ?? 'No delivery address'}</p>
                  <small>Created {new Date(order.created_at).toLocaleString()}</small>
                  {order.dispatched_at ? <p>Dispatched {new Date(order.dispatched_at).toLocaleString()}</p> : null}
                  {order.delivered_at ? <p>Delivered {new Date(order.delivered_at).toLocaleString()}</p> : null}
                  {order.closed_at ? <p>Closed {new Date(order.closed_at).toLocaleString()}</p> : null}
                  <label>Next status
                    <select disabled={updatingId === order.id} value={order.status} onChange={(event) => updateStatus(order, event.target.value as DeliveryStatus)}>
                      {nextStatuses(order.status).map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </label>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
