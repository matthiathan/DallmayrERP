'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type PurchaseStatus = 'draft' | 'ordered' | 'part_received' | 'received' | 'cancelled';
type PurchaseOrder = { id: string; po_number: string; supplier_name: string; branch: Branch; warehouse_id: string | null; status: PurchaseStatus; order_date: string; expected_date: string | null; notes: string | null; created_at: string };
type PurchaseLine = { id: string; purchase_order_id: string; stock_item_id: string; quantity_ordered: number; quantity_received: number; quantity_unit: 'item' | 'box'; unit_cost: number | null; notes: string | null };
type StockOption = { id: string; stock_name: string; item_barcode: string; box_barcode: string | null; item_quantity: number; box_quantity: number };
type Warehouse = { id: string; branch: Branch; warehouse_name: string };
type Location = { id: string; warehouse_id: string; location_code: string; description: string | null };
type Supplier = { id: string; supplier_name: string };

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

export function PurchaseOrderBoard() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [stockItems, setStockItems] = useState<StockOption[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [branch, setBranch] = useState<Branch>('jhb');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [barcode, setBarcode] = useState('');
  const [matchedStock, setMatchedStock] = useState<StockOption | null>(null);
  const [lineQuantity, setLineQuantity] = useState(1);
  const [lineUnit, setLineUnit] = useState<'item' | 'box'>('item');
  const [unitCost, setUnitCost] = useState('');
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, number>>({});
  const [receiveLocationId, setReceiveLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadReferenceData() {
    const client = getSupabaseClient();
    const [orderResult, stockResult, warehouseResult, locationResult, supplierResult] = await Promise.all([
      client.from('purchase_orders').select('id, po_number, supplier_name, branch, warehouse_id, status, order_date, expected_date, notes, created_at').order('created_at', { ascending: false }).limit(200),
      client.from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, box_quantity').eq('is_active', true).order('stock_name').limit(2000),
      client.from('warehouses').select('id, branch, warehouse_name').eq('status', 'active').order('warehouse_name'),
      client.from('stock_locations').select('id, warehouse_id, location_code, description').eq('status', 'active').order('location_code'),
      client.from('suppliers').select('id, supplier_name').eq('status', 'active').order('supplier_name'),
    ]);
    const firstError = orderResult.error ?? stockResult.error ?? warehouseResult.error ?? locationResult.error ?? supplierResult.error;
    if (firstError) throw firstError;
    setOrders((orderResult.data ?? []) as PurchaseOrder[]);
    setStockItems((stockResult.data ?? []) as StockOption[]);
    setWarehouses((warehouseResult.data ?? []) as Warehouse[]);
    setLocations((locationResult.data ?? []) as Location[]);
    setSuppliers((supplierResult.data ?? []) as Supplier[]);
    setLastUpdated(new Date());
  }

  async function loadLines(orderId: string) {
    setSelectedOrderId(orderId);
    if (!orderId) {
      setLines([]);
      return;
    }
    const { data, error: lineError } = await getSupabaseClient().from('purchase_order_lines').select('id, purchase_order_id, stock_item_id, quantity_ordered, quantity_received, quantity_unit, unit_cost, notes').eq('purchase_order_id', orderId).order('created_at');
    if (lineError) {
      setError(lineError.message);
      return;
    }
    setLines((data ?? []) as PurchaseLine[]);
  }

  useEffect(() => {
    loadReferenceData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load purchasing.'));
  }, []);

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;
  const branchWarehouses = warehouses.filter((warehouse) => warehouse.branch === branch || branch === 'national');
  const selectedWarehouseLocations = locations.filter((location) => location.warehouse_id === (selectedOrder?.warehouse_id ?? warehouseId));
  const stockMap = useMemo(() => new Map(stockItems.map((item) => [item.id, item])), [stockItems]);
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => !term || [order.po_number, order.supplier_name, order.branch, order.status].join(' ').toLowerCase().includes(term));
  }, [orders, search]);

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierName.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const poNumber = `PO-${branch.toUpperCase()}-${Date.now()}`;
    const { data, error: createError } = await getSupabaseClient().from('purchase_orders').insert({
      po_number: poNumber,
      supplier_name: supplierName.trim(),
      branch,
      warehouse_id: warehouseId || null,
      expected_date: expectedDate || null,
      notes: orderNotes.trim() || null,
    }).select('id, po_number').single();
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage(`${data.po_number} created.`);
    setSupplierName('');
    setExpectedDate('');
    setOrderNotes('');
    await loadReferenceData();
    await loadLines(data.id);
  }

  async function resolveStock(value: string) {
    const clean = value.trim();
    setBarcode(clean);
    const item = stockItems.find((stock) => stock.item_barcode === clean || stock.box_barcode === clean) ?? null;
    setMatchedStock(item);
    if (item) {
      setLineUnit(item.box_barcode === clean ? 'box' : 'item');
      setMessage(`${item.stock_name} selected.`);
      setError(null);
    } else if (clean) {
      setError('Barcode not found in the stock master.');
    }
  }

  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder || selectedOrder.status !== 'draft' || !matchedStock) return;
    setSaving(true);
    setError(null);
    const { error: lineError } = await getSupabaseClient().from('purchase_order_lines').upsert({
      purchase_order_id: selectedOrder.id,
      stock_item_id: matchedStock.id,
      quantity_ordered: lineQuantity,
      quantity_unit: lineUnit,
      unit_cost: unitCost ? Number(unitCost) : null,
    }, { onConflict: 'purchase_order_id,stock_item_id,quantity_unit' });
    setSaving(false);
    if (lineError) {
      setError(lineError.message);
      return;
    }
    setMessage(`${matchedStock.stock_name} added to ${selectedOrder.po_number}.`);
    setBarcode('');
    setMatchedStock(null);
    setLineQuantity(1);
    setUnitCost('');
    await loadLines(selectedOrder.id);
  }

  async function changeStatus(status: PurchaseStatus) {
    if (!selectedOrder) return;
    setSaving(true);
    setError(null);
    const { error: statusError } = await getSupabaseClient().rpc('transition_purchase_order', { p_purchase_order_id: selectedOrder.id, p_new_status: status });
    setSaving(false);
    if (statusError) {
      setError(statusError.message);
      return;
    }
    setMessage(`${selectedOrder.po_number} moved to ${status}.`);
    await loadReferenceData();
  }

  async function receiveLine(line: PurchaseLine) {
    const quantity = receiveQuantities[line.id] ?? Math.max(1, line.quantity_ordered - line.quantity_received);
    const stock = stockMap.get(line.stock_item_id);
    setSaving(true);
    setError(null);
    const { error: receiveError } = await getSupabaseClient().rpc('receive_purchase_order_line', {
      p_line_id: line.id,
      p_quantity: quantity,
      p_destination_location_id: receiveLocationId || null,
      p_barcode: line.quantity_unit === 'box' ? stock?.box_barcode ?? stock?.item_barcode ?? null : stock?.item_barcode ?? null,
      p_notes: `Received against ${selectedOrder?.po_number ?? 'purchase order'}`,
    });
    setSaving(false);
    if (receiveError) {
      setError(receiveError.message);
      return;
    }
    setMessage(`${stock?.stock_name ?? 'Stock'} received.`);
    await loadReferenceData();
    if (selectedOrderId) await loadLines(selectedOrderId);
  }

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <section className="neo-card">
        <div className="badge">Purchasing</div><h2>Create purchase order</h2><p>Create supplier orders and receive scanned stock into a warehouse location.</p>
        <form className="grid" onSubmit={createOrder}>
          <div className="form-grid">
            <label>Supplier<input list="supplier-options" required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /><datalist id="supplier-options">{suppliers.map((supplier) => <option key={supplier.id} value={supplier.supplier_name} />)}</datalist></label>
            <label>Branch<select value={branch} onChange={(event) => { const next = event.target.value as Branch; setBranch(next); setWarehouseId(''); }} >{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Warehouse<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">No warehouse selected</option>{branchWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.warehouse_name}</option>)}</select></label>
            <label>Expected date<input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></label>
          </div>
          <label>Notes<textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} /></label>
          <button className="button" disabled={saving || !supplierName.trim()} type="submit">{saving ? 'Creating...' : 'Create purchase order'}</button>
        </form>
      </section>

      <PageToolbar actions={<button className="button secondary" onClick={() => loadReferenceData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh</button>} description="Search purchase orders, open one, add scanned lines and receive deliveries." lastUpdated={lastUpdated} title="Purchase orders">
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PO number, supplier, branch or status" /></label>
      </PageToolbar>

      <div className="grid grid-3">
        {filteredOrders.map((order) => <button className={`purchase-order-card card ${selectedOrderId === order.id ? 'is-selected' : ''}`} key={order.id} onClick={() => loadLines(order.id)} type="button"><div className="page-toolbar-heading"><strong>{order.po_number}</strong><StatusBadge value={order.status} /></div><p>{order.supplier_name}<br />{order.branch.toUpperCase()}<br />Expected {order.expected_date ?? 'not set'}</p></button>)}
        {filteredOrders.length === 0 ? <div className="feature-pill">No purchase orders found.</div> : null}
      </div>

      {selectedOrder ? <section className="neo-card">
        <div className="page-toolbar-heading"><div><h2>{selectedOrder.po_number}</h2><p>{selectedOrder.supplier_name} • {selectedOrder.branch.toUpperCase()}</p></div><StatusBadge value={selectedOrder.status} /></div>
        <div className="action-row">
          {selectedOrder.status === 'draft' ? <><button className="button" disabled={saving || lines.length === 0} onClick={() => changeStatus('ordered')} type="button">Mark ordered</button><button className="button secondary danger-action" disabled={saving} onClick={() => { if (window.confirm(`Cancel purchase order ${selectedOrder.po_number}? This will mark the order as cancelled.`)) void changeStatus('cancelled'); }} type="button">Cancel purchase order</button></> : null}
        </div>

        {selectedOrder.status === 'draft' ? <form className="grid" onSubmit={addLine}>
          <BarcodeCapture label="Scan item for purchase order" value={barcode} onChange={resolveStock} />
          {matchedStock ? <div className="stock-match-card"><div><strong>{matchedStock.stock_name}</strong><span>{matchedStock.item_barcode}</span></div><div><span>Items</span><strong>{matchedStock.item_quantity}</strong></div><div><span>Boxes</span><strong>{matchedStock.box_quantity}</strong></div></div> : null}
          <div className="form-grid"><label>Order quantity<input min="1" type="number" value={lineQuantity} onChange={(event) => setLineQuantity(Number(event.target.value))} /></label><label>Unit<select value={lineUnit} onChange={(event) => setLineUnit(event.target.value as 'item' | 'box')}><option value="item">Items</option><option value="box">Boxes</option></select></label><label>Unit cost<input min="0" step="0.01" type="number" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></label></div>
          <button className="button" disabled={saving || !matchedStock} type="submit">Add line</button>
        </form> : null}

        {['ordered','part_received'].includes(selectedOrder.status) ? <label>Receiving location<select value={receiveLocationId} onChange={(event) => setReceiveLocationId(event.target.value)}><option value="">Unassigned / total stock</option>{selectedWarehouseLocations.map((location) => <option key={location.id} value={location.id}>{location.location_code}{location.description ? ` — ${location.description}` : ''}</option>)}</select></label> : null}

        <div className="table-wrap"><table><thead><tr><th>Stock</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Cost</th><th>Action</th></tr></thead><tbody>{lines.length === 0 ? <tr><td colSpan={6}>No lines added.</td></tr> : lines.map((line) => { const stock = stockMap.get(line.stock_item_id); const remaining = line.quantity_ordered-line.quantity_received; return <tr key={line.id}><td>{stock?.stock_name ?? line.stock_item_id}</td><td>{line.quantity_ordered} {line.quantity_unit}</td><td>{line.quantity_received}</td><td>{remaining}</td><td>{line.unit_cost ?? '-'}</td><td>{remaining > 0 && ['ordered','part_received'].includes(selectedOrder.status) ? <div className="action-row"><input aria-label="Receive quantity" min="1" max={remaining} type="number" value={receiveQuantities[line.id] ?? remaining} onChange={(event) => setReceiveQuantities((current) => ({ ...current, [line.id]: Number(event.target.value) }))} /><button className="button" disabled={saving} onClick={() => receiveLine(line)} type="button">Receive</button></div> : <StatusBadge value="received" />}</td></tr>; })}</tbody></table></div>
      </section> : null}
    </div>
  );
}
