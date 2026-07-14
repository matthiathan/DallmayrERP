'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { StockItem } from '@/types/dallmayrerp';

const emptyForm = {
  stock_name: '',
  item_barcode: '',
  box_barcode: '',
  item_quantity: 0,
  box_quantity: 0,
  items_per_box: 1,
  category: '',
  supplier_name: '',
  warehouse_location: '',
  reorder_level: 0,
  notes: '',
};

export default function WarehouseStockPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadStock() {
    setLoading(true);
    setError(null);
    let request = getSupabaseClient().from('stock_items').select('*').order('stock_name', { ascending: true });
    if (query.trim()) {
      const term = `%${query.trim()}%`;
      request = request.or(`stock_name.ilike.${term},item_barcode.ilike.${term},box_barcode.ilike.${term},category.ilike.${term},warehouse_location.ilike.${term}`);
    }
    const { data, error: loadError } = await request;
    if (loadError) {
      setError(loadError.message);
    } else {
      setItems((data ?? []) as StockItem[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const { error: upsertError } = await getSupabaseClient()
      .from('stock_items')
      .upsert(payload, { onConflict: 'item_barcode' });

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

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Warehouse Stock</h1>
          <p>Add shipment stock, maintain barcodes and prepare inventory for deliveries.</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <div className="card"><div className="nav-heading">Stock rows</div><div className="kpi-value">{items.length}</div></div>
        <div className="card"><div className="nav-heading">Low stock</div><div className="kpi-value">{lowStockCount}</div></div>
        <div className="card"><div className="nav-heading">Loose items</div><div className="kpi-value">{items.reduce((sum, item) => sum + item.item_quantity, 0)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Add or update stock</h2>
        <form className="form-grid" onSubmit={addStock}>
          <label>Stock name<input required value={form.stock_name} onChange={(e) => setForm({ ...form, stock_name: e.target.value })} /></label>
          <label>Item barcode<input required value={form.item_barcode} onChange={(e) => setForm({ ...form, item_barcode: e.target.value })} /></label>
          <label>Box barcode<input value={form.box_barcode} onChange={(e) => setForm({ ...form, box_barcode: e.target.value })} /></label>
          <label>Item quantity<input type="number" min="0" value={form.item_quantity} onChange={(e) => setForm({ ...form, item_quantity: Number(e.target.value) })} /></label>
          <label>Box quantity<input type="number" min="0" value={form.box_quantity} onChange={(e) => setForm({ ...form, box_quantity: Number(e.target.value) })} /></label>
          <label>Items per box<input type="number" min="1" value={form.items_per_box} onChange={(e) => setForm({ ...form, items_per_box: Number(e.target.value) })} /></label>
          <label>Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>Supplier<input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} /></label>
          <label>Warehouse location<input value={form.warehouse_location} onChange={(e) => setForm({ ...form, warehouse_location: e.target.value })} /></label>
          <label>Reorder level<input type="number" min="0" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: Number(e.target.value) })} /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ alignSelf: 'end' }}><button className="button" disabled={saving}>{saving ? 'Saving...' : 'Save stock'}</button></div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="form-grid">
          <label>Search stock, item barcode or box barcode<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <div style={{ alignSelf: 'end' }}><button className="button secondary" onClick={loadStock} type="button">Search</button></div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Stock name</th><th>Item barcode</th><th>Box barcode</th><th>Items</th><th>Boxes</th><th>Items / box</th><th>Location</th><th>Reorder</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8}>Loading stock...</td></tr> : items.length === 0 ? <tr><td colSpan={8}>No stock items yet.</td></tr> : items.map((item) => (
              <tr key={item.id}>
                <td>{item.stock_name}</td>
                <td>{item.item_barcode}</td>
                <td>{item.box_barcode || '-'}</td>
                <td>{item.item_quantity}</td>
                <td>{item.box_quantity}</td>
                <td>{item.items_per_box || '-'}</td>
                <td>{item.warehouse_location || '-'}</td>
                <td>{item.reorder_level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
