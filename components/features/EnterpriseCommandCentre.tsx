'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadCsv, toCsv } from '@/lib/data/export';
import { getSupabaseClient } from '@/lib/supabase/client';

type Metrics = {
  auditEvents: number;
  stockItems: number;
  lowStock: number;
  deliveryOrders: number;
  openDeliveryOrders: number;
  serviceJobs: number;
  openServiceJobs: number;
  machines: number;
  inventoryMovements: number;
};

const emptyMetrics: Metrics = {
  auditEvents: 0,
  stockItems: 0,
  lowStock: 0,
  deliveryOrders: 0,
  openDeliveryOrders: 0,
  serviceJobs: 0,
  openServiceJobs: 0,
  machines: 0,
  inventoryMovements: 0,
};

async function countRows(table: string, filter?: { column: string; values: string[] }) {
  let query = getSupabaseClient().from(table).select('*', { count: 'exact', head: true });
  if (filter) query = query.in(filter.column, filter.values);
  const { count } = await query;
  return count ?? 0;
}

export function EnterpriseCommandCentre() {
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    try {
      const [auditEvents, stockItems, deliveryOrders, openDeliveryOrders, serviceJobs, openServiceJobs, machines, inventoryMovements, lowStockData] = await Promise.all([
        countRows('audit_events'),
        countRows('stock_items'),
        countRows('delivery_orders'),
        countRows('delivery_orders', { column: 'status', values: ['draft', 'picked', 'dispatched'] }),
        countRows('service_jobs'),
        countRows('service_jobs', { column: 'status', values: ['new', 'assigned', 'in_progress'] }),
        countRows('machines'),
        countRows('inventory_movements'),
        getSupabaseClient().from('stock_items').select('id, item_quantity, reorder_level'),
      ]);
      const lowStock = (lowStockData.data ?? []).filter((item) => Number(item.item_quantity) <= Number(item.reorder_level)).length;
      setMetrics({ auditEvents, stockItems, lowStock, deliveryOrders, openDeliveryOrders, serviceJobs, openServiceJobs, machines, inventoryMovements });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load command-centre metrics.');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMetrics();
  }, []);

  const branchRiskScore = useMemo(() => {
    const stockRisk = metrics.stockItems ? metrics.lowStock / metrics.stockItems : 0;
    const deliveryRisk = metrics.deliveryOrders ? metrics.openDeliveryOrders / metrics.deliveryOrders : 0;
    const serviceRisk = metrics.serviceJobs ? metrics.openServiceJobs / metrics.serviceJobs : 0;
    return Math.round((stockRisk * 35 + deliveryRisk * 30 + serviceRisk * 35) * 100);
  }, [metrics]);

  function exportSnapshot() {
    const csv = toCsv([
      { metric: 'Audit events', value: metrics.auditEvents },
      { metric: 'Stock items', value: metrics.stockItems },
      { metric: 'Low stock items', value: metrics.lowStock },
      { metric: 'Delivery orders', value: metrics.deliveryOrders },
      { metric: 'Open delivery orders', value: metrics.openDeliveryOrders },
      { metric: 'Service jobs', value: metrics.serviceJobs },
      { metric: 'Open service jobs', value: metrics.openServiceJobs },
      { metric: 'Machines', value: metrics.machines },
      { metric: 'Inventory movements', value: metrics.inventoryMovements },
      { metric: 'Enterprise risk score', value: branchRiskScore },
    ], ['metric', 'value']);
    downloadCsv(`dallmayrerp-command-centre-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (loading) return <div className="neo-card spatial-card"><h2>Loading command centre...</h2><p>Preparing enterprise management metrics.</p></div>;

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      <div className="hero-panel spatial-card">
        <div className="badge">Command Centre</div>
        <h1>Enterprise Command Centre</h1>
        <p>Executive management view across auditability, stock risk, delivery execution, service workload and asset readiness.</p>
        <div className="action-row"><button className="button" onClick={exportSnapshot} type="button">Export command snapshot</button><button className="button secondary" onClick={loadMetrics} type="button">Refresh</button></div>
      </div>
      <div className="grid grid-3 spatial-kpi-grid">
        <div className="card"><div className="nav-heading">Enterprise risk score</div><div className="kpi-value">{branchRiskScore}</div><p>Composite of stock, delivery and service pressure.</p></div>
        <div className="card"><div className="nav-heading">Open delivery work</div><div className="kpi-value">{metrics.openDeliveryOrders}</div><p>{metrics.deliveryOrders} delivery order(s) total.</p></div>
        <div className="card"><div className="nav-heading">Open service work</div><div className="kpi-value">{metrics.openServiceJobs}</div><p>{metrics.serviceJobs} service job(s) total.</p></div>
        <div className="card"><div className="nav-heading">Low stock</div><div className="kpi-value">{metrics.lowStock}</div><p>{metrics.stockItems} stocked item(s) tracked.</p></div>
        <div className="card"><div className="nav-heading">Machine profiles</div><div className="kpi-value">{metrics.machines}</div><p>Enterprise asset records created.</p></div>
        <div className="card"><div className="nav-heading">Audit events</div><div className="kpi-value">{metrics.auditEvents}</div><p>Accountability events recorded.</p></div>
      </div>
    </div>
  );
}
