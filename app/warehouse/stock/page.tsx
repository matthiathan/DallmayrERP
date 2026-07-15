'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DocumentHub } from '@/components/features/DocumentHub';
import { StockScannerPanel } from '@/components/features/StockScannerPanel';
import { AppShell } from '@/components/layout/AppShell';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { StockItem } from '@/types/dallmayrerp';

const emptyForm = {
  stock_name: '', item_barcode: '', box_barcode: '', item_quantity: 0, box_quantity: 0,
  items_per_box: 1, category: '', supplier_name: '', warehouse_location: '', reorder_level: 0, notes: '',
};

export default function WarehouseStockPage() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<StockItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStock() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('stock_items')
      .select('*')
      .order('stock_name', { ascending: true })
      .limit(1000);
    if (loadError) setError(loadError.message);
    else {
      setItems((data ?? []) as StockItem[]);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStock().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load stock.');
      setLoading(false);
    });
  }, []);

  async function addStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload = {
      stock_name: form.stock_name.trim(),
      item_barcode: form.item_barcode.trim(),
      box_barcode: form.box_barcode.trim() || null,
      item_quantity: Number(form.item_quantity),
      box_quantity: Number(form.box_quantity),
      items_per_box: Number(form.items_per_box) || null,
      category: form.category.trim() || null,
      supplier_name: form.supplier_name.trim() || null,
      warehouse_location: form.warehouse_location.trim() || null,
      reorder_level: Number(form.reorder_level),
      notes: form.notes.trim() || null,
    };
    const { error: upsertError } = await getSupabaseClient().from('stock_items').upsert(payload, { onConflict: 'item_barcode' });
    setSaving(false);
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setSuccess('Stock item saved.');
    setForm(emptyForm);
    await loadStock();
  }

  const lowStockCount = items.filter((item) => item.item_quantity <= item.reorder_level).length;
  const columns = useMemo<EnterpriseColumn<StockItem>[]>(() => [
    { id: 'name', header: 'Stock name', value: (row) => row.stock_name, render: (row) => <strong>{row.stock_name}</strong>, sortable: true },
    { id: 'item_barcode', header: 'Item barcode', value: (row) => row.item_barcode, sortable: true },
    { id: 'box_barcode', header: 'Box barcode', value: (row) => row.box_barcode ?? '', sortable: true },
    { id: 'items', header: 'Items', value: (row) => row.item_quantity, sortable: true },
    { id: 'boxes', header: 'Boxes', value: (row) => row.box_quantity, sortable: true },
    { id: 'per_box', header: 'Items / box', value: (row) => row.items_per_box ?? 0, sortable: true },
    { id: 'location', header: 'Location', value: (row) => row.warehouse_location ?? '', sortable: true },
    { id: 'reorder', header: 'Reorder', value: (row) => row.reorder_level, sortable: true },
    { id: 'risk', header: 'Stock status', value: (row) => row.item_quantity <= row.reorder_level ? 'low' : 'active', render: (row) => <StatusBadge label={row.item_quantity <= row.reorder_level ? 'Low stock' : 'Healthy'} value={row.item_quantity <= row.reorder_level ? 'critical' : 'active'} />, sortable: true },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div><div className="badge">Warehouse</div><h1>Warehouse Stock</h1><p>Add shipment stock, scan barcodes, share documentation and prepare inventory for deliveries.</p></div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="card"><div className="nav-heading">Stock rows</div><div className="kpi-value">{items.length}</div></div>
        <div className="card"><div className="nav-heading">Low stock</div><div className="kpi-value">{lowStockCount}</div></div>
        <div className="card"><div className="nav-heading">Loose items</div><div className="kpi-value">{items.reduce((sum, item) => sum + item.item_quantity, 0)}</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <StockScannerPanel />
        <div className="card">
          <h2>Add or update stock manually</h2>
          <form className="form-grid" onSubmit={addStock}>
            <label>Stock name<input required value={form.stock_name} onChange={(event) => setForm({ ...form, stock_name: event.target.value })} /></label>
            <label>Item barcode<input required value={form.item_barcode} onChange={(event) => setForm({ ...form, item_barcode: event.target.value })} /></label>
            <label>Box barcode<input value={form.box_barcode} onChange={(event) => setForm({ ...form, box_barcode: event.target.value })} /></label>
            <label>Item quantity<input min="0" type="number" value={form.item_quantity} onChange={(event) => setForm({ ...form, item_quantity: Number(event.target.value) })} /></label>
            <label>Box quantity<input min="0" type="number" value={form.box_quantity} onChange={(event) => setForm({ ...form, box_quantity: Number(event.target.value) })} /></label>
            <label>Items per box<input min="1" type="number" value={form.items_per_box} onChange={(event) => setForm({ ...form, items_per_box: Number(event.target.value) })} /></label>
            <label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
            <label>Supplier<input value={form.supplier_name} onChange={(event) => setForm({ ...form, supplier_name: event.target.value })} /></label>
            <label>Warehouse location<input value={form.warehouse_location} onChange={(event) => setForm({ ...form, warehouse_location: event.target.value })} /></label>
            <label>Reorder level<input min="0" type="number" value={form.reorder_level} onChange={(event) => setForm({ ...form, reorder_level: Number(event.target.value) })} /></label>
            <label>Notes<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <div style={{ alignSelf: 'end' }}><button className="button" disabled={saving}>{saving ? 'Saving...' : 'Save stock'}</button></div>
          </form>
        </div>
      </div>

      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadStock} type="button">{loading ? 'Refreshing...' : 'Refresh stock'}</button>} description="Search, sort and page through current stock records." lastUpdated={lastUpdated} title="Stock register" />
      <EnterpriseDataTable
        columns={columns}
        emptyMessage={loading ? 'Loading stock records...' : 'No matching stock items found.'}
        getSearchText={(row) => [row.id, row.stock_name, row.item_barcode, row.box_barcode, row.category, row.supplier_name, row.warehouse_location].join(' ')}
        initialSearch={searchParams.get('stock') ?? ''}
        rowKey={(row) => row.id}
        rows={items}
        searchPlaceholder="Search stock name, barcode, category, supplier or location"
      />
      <div style={{ marginTop: 20 }}><DocumentHub department="warehouse" branch="all" /></div>
    </AppShell>
  );
}
