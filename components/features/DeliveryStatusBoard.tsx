'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import { recordAuditEvent } from '@/lib/data/audit';
import type { Branch } from '@/types/dallmayrerp';

type DeliveryStatus = 'draft' | 'picked' | 'dispatched' | 'delivered' | 'closed';
type DeliveryOrderRow = {
  id: string;
  order_number: string;
  branch: Branch;
  customer_name: string;
  delivery_address: string | null;
  status: DeliveryStatus;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
};

const statuses: DeliveryStatus[] = ['draft', 'picked', 'dispatched', 'delivered', 'closed'];

export function DeliveryStatusBoard() {
  const { businessUser, userDetails } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrderRow[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadOrders() {
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('delivery_orders')
      .select('id, order_number, branch, customer_name, delivery_address, status, created_at, dispatched_at, delivered_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setOrders((data ?? []) as DeliveryOrderRow[]);
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const grouped = useMemo(() => statuses.map((status) => ({ status, orders: orders.filter((order) => order.status === status) })), [orders]);

  async function updateStatus(order: DeliveryOrderRow, status: DeliveryStatus) {
    if (!businessUser || order.status === status) return;
    setUpdatingId(order.id);
    setError(null);
    setMessage(null);
    const now = new Date().toISOString();
    const patch: Record<string, string | null> = { status };
    if (status === 'dispatched') patch.dispatched_at = now;
    if (status === 'delivered') patch.delivered_at = now;

    const client = getSupabaseClient();
    const { error: updateError } = await client.from('delivery_orders').update(patch).eq('id', order.id);
    setUpdatingId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch: order.branch,
      entityType: 'delivery_order',
      entityId: order.id,
      action: 'delivery_status_changed',
      summary: `${order.order_number} changed from ${order.status} to ${status}.`,
      beforePayload: { status: order.status },
      afterPayload: { status },
    });

    setMessage(`${order.order_number} updated to ${status}.`);
    await loadOrders();
  }

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="card spatial-route-panel spatial-card">
        <h2>Delivery order status board</h2>
        <p>Move delivery orders through draft, picked, dispatched, delivered and closed. Every status change is written to the activity trail.</p>
        <button className="button secondary" onClick={loadOrders} type="button">Refresh board</button>
      </div>
      <div className="grid grid-3">
        {grouped.map((group) => (
          <div className="neo-card spatial-card" key={group.status}>
            <h3>{group.status}</h3>
            <p>{group.orders.length} order(s)</p>
            <div className="grid">
              {group.orders.length === 0 ? <div className="feature-pill">No orders</div> : null}
              {group.orders.map((order) => (
                <div className="card" key={order.id}>
                  <strong>{order.order_number}</strong>
                  <p>{order.customer_name}<br />{order.branch.toUpperCase()}</p>
                  <label>Move status
                    <select disabled={updatingId === order.id} value={order.status} onChange={(event) => updateStatus(order, event.target.value as DeliveryStatus)}>
                      {statuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
