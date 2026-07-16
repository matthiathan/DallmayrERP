'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DocumentHub } from '@/components/features/DocumentHub';
import { StockControlPanel } from '@/components/features/StockControlPanel';
import { AppShell } from '@/components/layout/AppShell';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';

type StockRow = {
  id: string; stock_name: string; sku: string | null; description: string | null; item_barcode: string; box_barcode: string | null;
  item_quantity: number; box_quantity: number; items_per_box: number | null; category: string | null; supplier_name: string | null;
  warehouse_location: string | null; reorder_level: number; preferred_reorder_quantity: number; unit_cost: number | null; sales_price: number | null;
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
};

const emptyForm = {
  stock_name: '', sku: '', description: '', item_barcode: '', box_barcode: '', items_per_box: 1, category: '', supplier_name: '',
  warehouse_location: '', reorder_level: 0, preferred_reorder_quantity: 0, unit_cost: '', sales_price: '', notes: '',
};

export default function WarehouseStockPage() {
  const focusedStockId = useClientQueryParam('stock');
  const [items, setItems] = useState<StockRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStock() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().from('stock_items').select('id, stock_name, sku, description, item_barcode, box_barcode, item_quantity, box_quantity, items_per_box, category, supplier_name, warehouse_location, reorder_level, preferred_reorder_quantity, unit_cost, sales_price, is_active, notes, created_at, updated_at').order('stock_name').limit(2000);
    if (loadError) setError(loadError.message);
    else {
      setItems((data ?? []) as StockRow[]);
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

  async function saveItemMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload = {
      stock_name: form.stock_name.trim(),
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      item_barcode: form.item_barcode.trim(),
      box_barcode: form.box_barcode.trim() || null,
      items_per_box: Number(form.items_per_box) || null,
      category: form.category.trim() || null,
      supplier_name: form.supplier_name.trim() || null,
      warehouse_location: form.warehouse_location.trim() || null,
      reorder_level: Number(form.reorder_level),
      preferred_reorder_quantity: Number(form.preferred_reorder_quantity),
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      sales_price: form.sales_price ? Number(form.sales_price) : null,
      notes: form.notes.trim() || null,
      is_active: true,
    };
    const { error: upsertError } = await getSupabaseClient().from('stock_items').upsert(payload, { onConflict: 'item_barcode' });
    setSaving(false);
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setSuccess('Stock item master saved. Use the scanner transaction centre to change quantities.');
    setForm(emptyForm);
    await loadStock();
  }

  const lowStockItems = items.filter((item) => item.item_quantity + item.box_quantity * (item.items_per_box ?? 1) <= item.reorder_level);
  const totalEquivalentUnits = items.reduce((sum, item) => sum + item.item_quantity + item.box_quantity * (item.items_per_box ?? 1), 0);
  const stockValue = items.reduce((sum, item) => sum + (item.item_quantity + item.box_quantity * (item.items_per_box ?? 1)) * Number(item.unit_cost ?? 0), 0);

  const columns = useMemo<EnterpriseColumn<StockRow>[]>(() => [
    { id: 'name', header: 'Stock item', value: (row) => row.stock_name, render: (row) => <Link href={`/warehouse/stock/${row.id}`}><strong>{row.stock_name}</strong></Link>, sortable: true },
    { id: 'sku', header: 'SKU', value: (row) => row.sku ?? '', sortable: true },
    { id: 'barcode', header: 'Item barcode', value: (row) => row.item_barcode, sortable: true },
    { id: 'items', header: 'Items', value: (row) => row.item_quantity, sortable: true },
    { id: 'boxes', header: 'Boxes', value: (row) => row.box_quantity, sortable: true },
    { id: 'equivalent', header: 'Total units', value: (row) => row.item_quantity + row.box_quantity * (row.items_per_box ?? 1), sortable: true },
    { id: 'location', header: 'Default location', value: (row) => row.warehouse_location ?? '', sortable: true },
    { id: 'reorder', header: 'Reorder', value: (row) => row.reorder_level, sortable: true },
    { id: 'value', header: 'Stock value', value: (row) => Math.round((row.item_quantity + row.box_quantity * (row.items_per_box ?? 1)) * Number(row.unit_cost ?? 0) * 100) / 100, sortable: true },
    { id: 'risk', header: 'Status', value: (row) => row.item_quantity + row.box_quantity * (row.items_per_box ?? 1) <= row.reorder_level ? 'critical' : 'active', render: (row) => <StatusBadge label={row.item_quantity + row.box_quantity * (row.items_per_box ?? 1) <= row.reorder_level ? 'Low stock' : 'Healthy'} value={row.item_quantity + row.box_quantity * (row.items_per_box ?? 1) <= row.reorder_level ? 'critical' : 'active'} />, sortable: true },
  ], []);

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><div className="badge">Stock control centre</div><h1>Warehouse Inventory</h1><p>Phone scanning, visual item records, location balances, purchasing, receiving, issuing, transfers and low-stock control.</p></div><div className="action-row"><Link className="button" href="/warehouse/purchasing">Purchase orders</Link><Link className="button secondary" href="/warehouse/locations">Locations</Link><Link className="button secondary" href="/warehouse/ledger">Movement ledger</Link></div></div>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}><div className="card"><div className="nav-heading">Active items</div><div className="kpi-value">{items.filter((item) => item.is_active).length}</div></div><div className="card"><div className="nav-heading">Low-stock alerts</div><div className="kpi-value">{lowStockItems.length}</div></div><div className="card"><div className="nav-heading">Total equivalent units</div><div className="kpi-value">{totalEquivalentUnits}</div></div><div className="card"><div className="nav-heading">Estimated stock value</div><div className="kpi-value">R {stockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div></div>

      {lowStockItems.length ? <section className="neo-card low-stock-alerts"><div className="page-toolbar-heading"><div><div className="badge danger">Action required</div><h2>Low-stock alerts</h2><p>Items at or below their reorder level.</p></div><Link className="button" href="/warehouse/purchasing">Create purchase order</Link></div><div className="grid grid-3">{lowStockItems.slice(0, 12).map((item) => <Link className="card low-stock-card" href={`/warehouse/stock/${item.id}`} key={item.id}><div className="page-toolbar-heading"><strong>{item.stock_name}</strong><StatusBadge value="critical" label="Low stock" /></div><p>{item.item_quantity + item.box_quantity * (item.items_per_box ?? 1)} available • reorder at {item.reorder_level}<br />Suggested order: {item.preferred_reorder_quantity || Math.max(item.reorder_level * 2, 1)}</p></Link>)}</div></section> : null}

      <StockControlPanel onCommitted={loadStock} />

      <section className="neo-card"><h2>Create or update item master</h2><p>Maintain item identity, barcodes, supplier, pricing and reorder settings. Quantities are controlled only through audited transactions.</p><form className="grid" onSubmit={saveItemMaster}><div className="form-grid"><label>Stock name<input required value={form.stock_name} onChange={(event) => setForm({ ...form, stock_name: event.target.value })} /></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label><label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label></div><div className="form-grid"><label>Item barcode<input required value={form.item_barcode} onChange={(event) => setForm({ ...form, item_barcode: event.target.value })} /></label><label>Box barcode<input value={form.box_barcode} onChange={(event) => setForm({ ...form, box_barcode: event.target.value })} /></label><label>Items per box<input min="1" type="number" value={form.items_per_box} onChange={(event) => setForm({ ...form, items_per_box: Number(event.target.value) })} /></label></div><div className="form-grid"><label>Supplier<input value={form.supplier_name} onChange={(event) => setForm({ ...form, supplier_name: event.target.value })} /></label><label>Default location label<input value={form.warehouse_location} onChange={(event) => setForm({ ...form, warehouse_location: event.target.value })} /></label><label>Reorder level<input min="0" type="number" value={form.reorder_level} onChange={(event) => setForm({ ...form, reorder_level: Number(event.target.value) })} /></label><label>Preferred reorder quantity<input min="0" type="number" value={form.preferred_reorder_quantity} onChange={(event) => setForm({ ...form, preferred_reorder_quantity: Number(event.target.value) })} /></label><label>Unit cost<input min="0" step="0.01" type="number" value={form.unit_cost} onChange={(event) => setForm({ ...form, unit_cost: event.target.value })} /></label><label>Sales price<input min="0" step="0.01" type="number" value={form.sales_price} onChange={(event) => setForm({ ...form, sales_price: event.target.value })} /></label></div><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><button className="button" disabled={saving || !form.stock_name.trim() || !form.item_barcode.trim()} type="submit">{saving ? 'Saving item...' : 'Save item master'}</button></form></section>

      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadStock} type="button">{loading ? 'Refreshing...' : 'Refresh stock'}</button>} description="Search, sort and open detailed visual stock profiles." lastUpdated={lastUpdated} title="Stock register" />
      <EnterpriseDataTable columns={columns} emptyMessage={loading ? 'Loading stock records...' : 'No matching stock items found.'} getSearchText={(row) => [row.id, row.stock_name, row.sku, row.item_barcode, row.box_barcode, row.category, row.supplier_name, row.warehouse_location].join(' ')} initialSearch={focusedStockId} rowKey={(row) => row.id} rows={items} searchPlaceholder="Search stock, SKU, barcode, category, supplier or location" />
      <div style={{ marginTop: 20 }}><DocumentHub department="warehouse" branch="all" /></div>
    </AppShell>
  );
}
