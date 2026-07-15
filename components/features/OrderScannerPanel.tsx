'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type PickLine = { barcode: string; quantity: number; stock_name?: string | null; stock_item_id?: string | null };

export function OrderScannerPanel({ defaultBranch }: { defaultBranch?: Branch }) {
  const { businessUser, userDetails } = useAuth();
  const [branch, setBranch] = useState<Branch>(defaultBranch ?? userDetails?.branch ?? 'jhb');
  const [customerName, setCustomerName] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<PickLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyCustomer(customer: CustomerOption | null) {
    if (!customer) {
      setCustomerName('');
      return;
    }

    setCustomerName(customer.customer_name);
    setBranch(customer.branch);
    if (customer.address) setDeliveryAddress(customer.address);
  }

  async function addLine() {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    const { data: stockItem } = await getSupabaseClient()
      .from('stock_items')
      .select('id, stock_name')
      .or(`item_barcode.eq.${cleanBarcode},box_barcode.eq.${cleanBarcode}`)
      .maybeSingle();

    setLines((current) => [...current, {
      barcode: cleanBarcode,
      quantity,
      stock_name: stockItem?.stock_name ?? null,
      stock_item_id: stockItem?.id ?? null,
    }]);
    setBarcode('');
    setQuantity(1);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || lines.length === 0) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const client = getSupabaseClient();
    const orderNumber = `DO-${branch.toUpperCase()}-${Date.now()}`;

    const { data: order, error: orderError } = await client
      .from('delivery_orders')
      .insert({
        order_number: orderNumber,
        branch,
        customer_name: customerName.trim(),
        delivery_address: deliveryAddress.trim() || null,
        status: 'draft',
        created_by: businessUser.id,
      })
      .select('*')
      .single();

    if (orderError) {
      setSaving(false);
      setError(orderError.message);
      return;
    }

    const { error: lineError } = await client.from('delivery_order_lines').insert(lines.map((line) => ({
      order_id: order.id,
      barcode: line.barcode,
      quantity: line.quantity,
      stock_name: line.stock_name ?? null,
      stock_item_id: line.stock_item_id ?? null,
    })));

    if (lineError) {
      setSaving(false);
      setError(lineError.message);
      return;
    }

    await client.from('stock_scan_events').insert(lines.map((line) => ({
      barcode: line.barcode,
      scan_type: 'order_pick',
      branch,
      quantity: line.quantity,
      stock_item_id: line.stock_item_id ?? null,
      scanned_by: businessUser.id,
      notes: `Delivery order ${orderNumber}`,
    })));

    setSaving(false);
    setMessage(`Delivery order ${orderNumber} created with ${lines.length} line(s).`);
    setCustomerName('');
    setDeliveryAddress('');
    setLines([]);
  }

  return (
    <div className="neo-card">
      <h2>Create delivery order by scanning stock</h2>
      <p>Operations and admins can scan picked stock to create branch delivery orders.</p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <form className="grid" onSubmit={createOrder}>
        <div className="form-grid">
          <label>Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
              <option value="jhb">jhb</option><option value="cpt">cpt</option><option value="kzn">kzn</option><option value="national">national</option>
            </select>
          </label>
          <CustomerSelect value={customerName} onSelect={applyCustomer} required />
          <label>Delivery address<input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></label>
        </div>
        <BarcodeCapture label="Pick barcode" value={barcode} onChange={setBarcode} />
        <div className="form-grid">
          <label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <div style={{ alignSelf: 'end' }}><button className="button secondary" onClick={addLine} type="button">Add scanned line</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Barcode</th><th>Stock</th><th>Qty</th></tr></thead>
            <tbody>{lines.length === 0 ? <tr><td colSpan={3}>No scanned order lines yet.</td></tr> : lines.map((line, index) => <tr key={`${line.barcode}-${index}`}><td>{line.barcode}</td><td>{line.stock_name ?? 'Unmatched stock'}</td><td>{line.quantity}</td></tr>)}</tbody>
          </table>
        </div>
        <button className="button pulse-button" disabled={saving || lines.length === 0 || !customerName.trim()} type="submit">{saving ? 'Creating order...' : 'Create delivery order'}</button>
      </form>
    </div>
  );
}
