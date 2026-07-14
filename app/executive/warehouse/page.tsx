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
      <div className="page-header"><div><h1>Warehouse Risk</h1><p>Executive view of stock exposure and barcode readiness.</p></div></div>
      <div className="grid grid-3"><KpiCard label="Stock items" value={items.length} /><KpiCard label="Low stock" value={lowStock.length} /><KpiCard label="Zero stock" value={zeroStock.length} /></div>
      <div className="card" style={{ marginTop: 20 }}><h2>Barcode readiness</h2><p>{missingBoxBarcode.length} stock items do not yet have a box barcode.</p></div>
      <div className="table-wrap" style={{ marginTop: 20 }}><table><thead><tr><th>Stock</th><th>Items</th><th>Reorder level</th><th>Location</th></tr></thead><tbody>{lowStock.length === 0 ? <tr><td colSpan={4}>No low-stock items based on the current reorder levels.</td></tr> : lowStock.map((item) => <tr key={item.id}><td>{item.stock_name}</td><td>{item.item_quantity}</td><td>{item.reorder_level}</td><td>{item.warehouse_location || '-'}</td></tr>)}</tbody></table></div>
    </AppShell>
  );
}
