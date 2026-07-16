'use client';

import { FormEvent, useState } from 'react';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { resolveStockBarcode, type ResolvedStockBarcode } from '@/lib/data/stockBarcode';
import { useDuplicateScanGuard } from '@/lib/hooks/useDuplicateScanGuard';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type QuantityUnit = 'item' | 'box';
type PickLine = { barcode: string; quantity: number; quantity_unit: QuantityUnit; stock_name: string; stock_item_id: string };

export function OrderScannerPanel({ defaultBranch }: { defaultBranch?: Branch }) {
  const [branch, setBranch] = useState<Branch>(defaultBranch ?? 'jhb');
  const [customerName, setCustomerName] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [barcode, setBarcode] = useState('');
  const [stockLookup, setStockLookup] = useState<ResolvedStockBarcode | null>(null);
  const [stockLookupMessage, setStockLookupMessage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnit>('item');
  const [lines, setLines] = useState<PickLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDuplicateScan = useDuplicateScanGuard();

  function applyCustomer(customer: CustomerOption | null) {
    if (!customer) {
      setCustomerName('');
      return;
    }
    setCustomerName(customer.customer_name);
    setBranch(customer.branch);
    if (customer.address) setDeliveryAddress(customer.address);
  }

  async function resolvePickStock(value: string) {
    const cleanValue = value.trim();
    setBarcode(cleanValue);
    setStockLookup(null);
    setStockLookupMessage(null);
    setError(null);
    if (!cleanValue) return;
    if (isDuplicateScan(cleanValue)) {
      setStockLookupMessage('Duplicate scan ignored. Scan again after a moment to confirm a repeated line.');
      return;
    }

    try {
      const item = await resolveStockBarcode(cleanValue);
      if (!item) {
        setError('Barcode not found. Delivery lines must match an active stock item.');
        return;
      }
      setStockLookup(item);
      setQuantityUnit(item.matched_unit);
      setStockLookupMessage(`${item.stock_name} found as ${item.matched_unit}. Available: ${item.item_quantity} item(s), ${item.box_quantity} box(es).`);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Barcode lookup failed.');
    }
  }

  function addLine() {
    if (!stockLookup || !barcode.trim() || quantity <= 0) return;
    const available = quantityUnit === 'box' ? stockLookup.box_quantity : stockLookup.item_quantity;
    if (quantity > available) {
      setError(`Only ${available} ${quantityUnit}(s) are available.`);
      return;
    }
    setLines((current) => [...current, {
      barcode: barcode.trim(),
      quantity,
      quantity_unit: quantityUnit,
      stock_name: stockLookup.stock_name,
      stock_item_id: stockLookup.id,
    }]);
    setBarcode('');
    setStockLookup(null);
    setStockLookupMessage(null);
    setQuantity(1);
    setQuantityUnit('item');
    setError(null);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lines.length === 0 || !customerName.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const { data, error: orderError } = await getSupabaseClient().rpc('create_delivery_order_from_scans', {
      p_customer_name: customerName.trim(),
      p_delivery_address: deliveryAddress.trim() || null,
      p_branch: branch,
      p_lines: lines,
    });
    setSaving(false);

    if (orderError) {
      setError(orderError.message);
      return;
    }

    setMessage(`Delivery order created, ${lines.length} line(s) picked and stock deducted. Reference: ${data}.`);
    setCustomerName('');
    setDeliveryAddress('');
    setLines([]);
  }

  return (
    <div className="neo-card">
      <div className="page-toolbar-heading"><div><h2>Create delivery order by scanning stock</h2><p>Scanned lines are validated, saved and deducted atomically when the order is created.</p></div><StatusBadge value={lines.length ? 'picked' : 'draft'} label={`${lines.length} line(s)`} /></div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <form className="grid" onSubmit={createOrder}>
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}><option value="jhb">JHB</option><option value="cpt">CPT</option><option value="kzn">KZN</option><option value="national">National</option></select></label>
          <CustomerSelect value={customerName} onSelect={applyCustomer} required />
          <label>Delivery address<input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></label>
        </div>
        <BarcodeCapture label="Pick item or box barcode" value={barcode} onChange={resolvePickStock} />
        {stockLookupMessage ? <div className="success">{stockLookupMessage}</div> : null}
        {stockLookup ? <div className="stock-match-card"><div><strong>{stockLookup.stock_name}</strong><span>{stockLookup.matched_unit === 'box' ? 'Box barcode' : 'Item barcode'}</span></div><div><span>Matched</span><strong>{stockLookup.matched_unit}</strong></div><div><span>Items</span><strong>{stockLookup.item_quantity}</strong></div><div><span>Boxes</span><strong>{stockLookup.box_quantity}</strong></div></div> : null}
        <div className="form-grid"><label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><label>Unit<select value={quantityUnit} onChange={(event) => setQuantityUnit(event.target.value as QuantityUnit)}><option value="item">Items</option><option value="box">Boxes</option></select></label><div style={{ alignSelf: 'end' }}><button className="button secondary" disabled={!stockLookup} onClick={addLine} type="button">Add scanned line</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>Barcode</th><th>Stock</th><th>Quantity</th><th>Action</th></tr></thead><tbody>{lines.length === 0 ? <tr><td colSpan={4}>No scanned order lines yet.</td></tr> : lines.map((line, index) => <tr key={`${line.barcode}-${index}`}><td>{line.barcode}</td><td>{line.stock_name}</td><td>{line.quantity} {line.quantity_unit}</td><td><button className="button secondary" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} type="button">Remove</button></td></tr>)}</tbody></table></div>
        <button className="button pulse-button" disabled={saving || lines.length === 0 || !customerName.trim()} type="submit">{saving ? 'Creating and deducting stock...' : 'Create picked delivery order'}</button>
      </form>
    </div>
  );
}
