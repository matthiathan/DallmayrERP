'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { localDateAfterDays } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

type MachineRelation = { machine_name: string | null; serial_number: string | null; meter_value: number; meter_unit: string };
type MaintenanceSignal = { id: string; title: string; next_due_at: string | null; next_due_meter: number | null; machine_id: string; is_active: boolean; machines?: MachineRelation | MachineRelation[] | null };
type PurchaseSignal = { id: string; po_number: string; supplier_name: string; branch: string; estimated_total: number | null; submitted_at: string | null; approval_status: string };
type LotSignal = { id: string; stock_item_id: string; lot_number: string; expiry_date: string | null; quantity_items: number; quantity_boxes: number; status: string; stock_items?: { stock_name: string | null } | Array<{ stock_name: string | null }> | null };
type AssetSignal = { id: string; machine_name: string | null; serial_number: string | null; warranty_expires_at: string | null; replacement_due_at: string | null; condition: string; criticality: string };

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function ProfessionalSignalsPanel() {
  const { userDetails } = useAuth();
  const [maintenance, setMaintenance] = useState<MaintenanceSignal[]>([]);
  const [purchases, setPurchases] = useState<PurchaseSignal[]>([]);
  const [lots, setLots] = useState<LotSignal[]>([]);
  const [assets, setAssets] = useState<AssetSignal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function loadSignals() {
    setError(null);
    const client = getSupabaseClient();
    const horizon = localDateAfterDays(60);
    const [maintenanceResult, lotResult, assetResult] = await Promise.all([
      client.from('maintenance_plans').select('id, title, next_due_at, next_due_meter, machine_id, is_active, machines(machine_name, serial_number, meter_value, meter_unit)').eq('is_active', true).order('next_due_at', { ascending: true, nullsFirst: false }).limit(200),
      client.from('stock_lots').select('id, stock_item_id, lot_number, expiry_date, quantity_items, quantity_boxes, status, stock_items(stock_name)').eq('status', 'active').not('expiry_date', 'is', null).lte('expiry_date', horizon).order('expiry_date').limit(100),
      client.from('machines').select('id, machine_name, serial_number, warranty_expires_at, replacement_due_at, condition, criticality').or(`warranty_expires_at.lte.${horizon},replacement_due_at.lte.${horizon}`).limit(100),
    ]);

    const role = userDetails?.role ?? '';
    let purchaseError: { message: string } | null = null;
    let purchaseData: unknown[] = [];
    if (['admin', 'operations', 'warehouse_staff', 'finance', 'executive'].includes(role)) {
      const purchaseResult = await client.from('purchase_orders').select('id, po_number, supplier_name, branch, estimated_total, submitted_at, approval_status').eq('approval_status', 'pending').order('submitted_at').limit(100);
      purchaseError = purchaseResult.error;
      purchaseData = purchaseResult.data ?? [];
    }

    const firstError = maintenanceResult.error ?? lotResult.error ?? assetResult.error ?? purchaseError;
    if (firstError) {
      setError(firstError.message);
      return;
    }

    setMaintenance((maintenanceResult.data ?? []) as MaintenanceSignal[]);
    setPurchases(purchaseData as PurchaseSignal[]);
    setLots((lotResult.data ?? []) as LotSignal[]);
    setAssets((assetResult.data ?? []) as AssetSignal[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadSignals().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load operational signals.'));
  }, [userDetails?.role]);

  const dueMaintenance = useMemo(() => maintenance.filter((plan) => {
    const machine = firstRelation(plan.machines);
    const dateDue = Boolean(plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now());
    const meterDue = Boolean(plan.next_due_meter !== null && machine && Number(machine.meter_value) >= Number(plan.next_due_meter));
    return dateDue || meterDue;
  }), [maintenance]);

  const signals = [
    ...dueMaintenance.slice(0, 8).map((plan) => {
      const machine = firstRelation(plan.machines);
      return { key: `maintenance-${plan.id}`, title: plan.title, detail: `${machine?.machine_name ?? machine?.serial_number ?? 'Machine'} • maintenance due`, href: '/operations/maintenance', status: 'overdue' };
    }),
    ...purchases.slice(0, 8).map((order) => ({ key: `purchase-${order.id}`, title: order.po_number, detail: `${order.supplier_name} • ${order.branch.toUpperCase()} • R ${Number(order.estimated_total ?? 0).toLocaleString()}`, href: '/warehouse/purchasing/approvals', status: 'pending' })),
    ...lots.slice(0, 8).map((lot) => ({ key: `lot-${lot.id}`, title: `${firstRelation(lot.stock_items)?.stock_name ?? 'Stock'} — ${lot.lot_number}`, detail: `Expires ${lot.expiry_date} • ${lot.quantity_items} items / ${lot.quantity_boxes} boxes`, href: '/warehouse/traceability', status: lot.expiry_date && new Date(lot.expiry_date).getTime() < Date.now() ? 'expired' : 'warning' })),
    ...assets.slice(0, 8).map((asset) => ({ key: `asset-${asset.id}`, title: asset.machine_name ?? asset.serial_number ?? 'Asset', detail: asset.replacement_due_at ? `Replacement due ${asset.replacement_due_at}` : `Warranty expires ${asset.warranty_expires_at}`, href: '/operations/assets/lifecycle', status: asset.criticality === 'critical' ? 'critical' : 'warning' })),
  ];

  return (
    <section className="neo-card">
      <div className="minimal-toolbar">
        <div><h2>Operational signals</h2><p>Maintenance, purchasing, expiry and asset-lifecycle exceptions requiring attention.</p></div>
        <div className="action-row">{lastUpdated ? <small>Updated {lastUpdated.toLocaleTimeString()}</small> : null}<button className="button secondary" onClick={loadSignals} type="button">Refresh</button></div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>Maintenance due</span><strong>{dueMaintenance.length}</strong></div>
        <div className="minimal-metric"><span>Purchase approvals</span><strong>{purchases.length}</strong></div>
        <div className="minimal-metric"><span>Lots expiring</span><strong>{lots.length}</strong></div>
        <div className="minimal-metric"><span>Asset lifecycle alerts</span><strong>{assets.length}</strong></div>
      </div>
      <div className="minimal-list minimal-form-section">
        {signals.length === 0 ? <div className="minimal-empty">No professional operations signals are currently due.</div> : signals.slice(0, 20).map((signal) => <Link className="minimal-list-item" href={signal.href} key={signal.key}><div><h3>{signal.title}</h3><p>{signal.detail}</p></div><StatusBadge value={signal.status} /></Link>)}
      </div>
    </section>
  );
}
