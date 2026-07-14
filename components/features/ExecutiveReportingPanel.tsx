'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, DonutChart, StatStrip } from '@/components/ui/MiniCharts';
import { getSupabaseClient } from '@/lib/supabase/client';

type Branch = 'jhb' | 'cpt' | 'kzn' | 'national';

type Metrics = {
  customers: Record<Branch, number>;
  contracts: Record<Branch, number>;
  service: Record<Branch, number>;
  taskClosures: Record<Branch, number>;
  orders: Record<Branch, number>;
  stockScans: Record<Branch, number>;
  assets: number;
  documents: number;
};

const emptyMetrics: Metrics = {
  customers: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  contracts: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  service: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  taskClosures: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  orders: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  stockScans: { jhb: 0, cpt: 0, kzn: 0, national: 0 },
  assets: 0,
  documents: 0,
};

async function tableCount(table: string) {
  const { count } = await getSupabaseClient().from(table).select('*', { count: 'exact', head: true });
  return count ?? 0;
}

async function branchCount(table: string, branch: Branch, column = 'branch') {
  const { count } = await getSupabaseClient().from(table).select('*', { count: 'exact', head: true }).eq(column, branch);
  return count ?? 0;
}

export function ExecutiveReportingPanel() {
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    try {
      const [
        jhbCustomers, cptCustomers, kznCustomers,
        jhbContracts, cptContracts, kznContracts,
        jhbService, kznService,
        jhbClosures, cptClosures, kznClosures, nationalClosures,
        jhbOrders, cptOrders, kznOrders, nationalOrders,
        jhbScans, cptScans, kznScans, nationalScans,
        assets, docs,
      ] = await Promise.all([
        tableCount('customer_master_jhb'), tableCount('customer_master_cpt'), tableCount('customer_master_kzn'),
        tableCount('contract_agreement_jhb'), tableCount('contract_agreement_cpt'), tableCount('contract_agreement_kzn'),
        tableCount('service_call_log_jhb'), tableCount('service_call_log_kzn'),
        branchCount('task_closures', 'jhb'), branchCount('task_closures', 'cpt'), branchCount('task_closures', 'kzn'), branchCount('task_closures', 'national'),
        branchCount('delivery_orders', 'jhb'), branchCount('delivery_orders', 'cpt'), branchCount('delivery_orders', 'kzn'), branchCount('delivery_orders', 'national'),
        branchCount('stock_scan_events', 'jhb'), branchCount('stock_scan_events', 'cpt'), branchCount('stock_scan_events', 'kzn'), branchCount('stock_scan_events', 'national'),
        tableCount('fixed_assets'), tableCount('app_documents'),
      ]);

      setMetrics({
        customers: { jhb: jhbCustomers, cpt: cptCustomers, kzn: kznCustomers, national: 0 },
        contracts: { jhb: jhbContracts, cpt: cptContracts, kzn: kznContracts, national: 0 },
        service: { jhb: jhbService, cpt: 0, kzn: kznService, national: 0 },
        taskClosures: { jhb: jhbClosures, cpt: cptClosures, kzn: kznClosures, national: nationalClosures },
        orders: { jhb: jhbOrders, cpt: cptOrders, kzn: kznOrders, national: nationalOrders },
        stockScans: { jhb: jhbScans, cpt: cptScans, kzn: kznScans, national: nationalScans },
        assets,
        documents: docs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load executive reporting metrics.');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMetrics();
  }, []);

  const kpis = useMemo(() => [
    { label: 'Customers', value: metrics.customers.jhb + metrics.customers.cpt + metrics.customers.kzn },
    { label: 'Contracts', value: metrics.contracts.jhb + metrics.contracts.cpt + metrics.contracts.kzn },
    { label: 'Machines / Assets', value: metrics.assets },
    { label: 'Service Logs', value: metrics.service.jhb + metrics.service.kzn },
    { label: 'Task Closures', value: Object.values(metrics.taskClosures).reduce((sum, value) => sum + value, 0) },
    { label: 'Delivery Orders', value: Object.values(metrics.orders).reduce((sum, value) => sum + value, 0) },
    { label: 'Documents', value: metrics.documents },
  ], [metrics]);

  if (loading) {
    return <div className="neo-card spatial-card"><h2>Loading reporting metrics...</h2><p>Preparing branch and department dashboards.</p></div>;
  }

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      <StatStrip data={kpis.slice(0, 3)} />
      <div className="grid grid-2">
        <BarChart title="Customer master by branch" data={[{ label: 'JHB', value: metrics.customers.jhb }, { label: 'CPT', value: metrics.customers.cpt }, { label: 'KZN', value: metrics.customers.kzn }]} />
        <BarChart title="Contract volume by branch" data={[{ label: 'JHB', value: metrics.contracts.jhb }, { label: 'CPT', value: metrics.contracts.cpt }, { label: 'KZN', value: metrics.contracts.kzn }]} />
        <DonutChart title="Operational work captured" data={[{ label: 'Task closures', value: kpis[4].value }, { label: 'Delivery orders', value: kpis[5].value }, { label: 'Stock scans', value: Object.values(metrics.stockScans).reduce((sum, value) => sum + value, 0) }]} />
        <BarChart title="Recent digital activity by branch" data={[{ label: 'JHB', value: metrics.taskClosures.jhb + metrics.orders.jhb + metrics.stockScans.jhb }, { label: 'CPT', value: metrics.taskClosures.cpt + metrics.orders.cpt + metrics.stockScans.cpt }, { label: 'KZN', value: metrics.taskClosures.kzn + metrics.orders.kzn + metrics.stockScans.kzn }, { label: 'National', value: metrics.taskClosures.national + metrics.orders.national + metrics.stockScans.national }]} />
      </div>
    </div>
  );
}
