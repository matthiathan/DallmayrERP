'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { StockItem } from '@/types/dallmayrerp';

export default function ExecutiveWarehousePage() {
  const [items, setItems] = useState<StockItem[]>([]);

  useEffect(() => {
    getSupabaseClient().from('stock_items').select('*').order('stock_name').then(({ data }) => setItems((data ?? []) as StockItem[]));
  }, []);

  const lowStock = items.filter((item) => item.item_quantity <= item.reorder_level);
  const zeroStock = items.filter((item) => item.item_quantity === 0);
  const missingBoxBarcode = items.filter((item) => !item.box_barcode);

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><h1>Warehouse Risk</h1><p>Executive view of stock exposure and barcode readiness.</p></div></div>
      <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}><KpiCard label="Stock items" value={items.length} /><KpiCard label="Low stock" value={lowStock.length} /><KpiCard label="Zero stock" value={zeroStock.length} /></div>
      <div className="grid grid-2 spatial-stage spatial-dashboard" style={{ marginTop: 20 }}>
        <div className="card spatial-risk-panel spatial-card">
          <h2>Warehouse exposure</h2>
          <p>{lowStock.length} low-stock item(s), {zeroStock.length} zero-stock item(s), and {missingBoxBarcode.length} item(s) missing box barcodes.</p>
          <div className="feature-list">
            <span className="feature-pill">Reorder risk</span>
            <span className="feature-pill">Barcode readiness</span>
            <span className="feature-pill">Branch stock control</span>
          </div>
        </div>
        <div className="card spatial-machine-panel spatial-card">
          <h2>Machine / stock readiness</h2>
          <p>Use barcode completeness and stock levels together to identify where warehouse data may block fast dispatch.</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 20 }}><table><thead><tr><th>Stock</th><th>Items</th><th>Reorder level</th><th>Location</th></tr></thead><tbody>{lowStock.length === 0 ? <tr><td colSpan={4}>No low-stock items based on the current reorder levels.</td></tr> : lowStock.map((item) => <tr key={item.id}><td>{item.stock_name}</td><td>{item.item_quantity}</td><td>{item.reorder_level}</td><td>{item.warehouse_location || '-'}</td></tr>)}</tbody></table></div>
    </AppShell>
  );
}
