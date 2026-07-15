'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { recordAuditEvent } from '@/lib/data/audit';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

export function StockScannerPanel({ defaultBranch }: { defaultBranch?: Branch }) {
  const { businessUser, userDetails } = useAuth();
  const [branch, setBranch] = useState<Branch>(defaultBranch ?? userDetails?.branch ?? 'jhb');
  const [barcode, setBarcode] = useState('');
  const [stockName, setStockName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addStockScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const client = getSupabaseClient();
    const cleanBarcode = barcode.trim();

    const { data: stockItem } = await client
      .from('stock_items')
      .select('*')
      .or(`item_barcode.eq.${cleanBarcode},box_barcode.eq.${cleanBarcode}`)
      .maybeSingle();

    let stockItemId = stockItem?.id ?? null;

    if (!stockItemId && stockName.trim()) {
      const { data: newItem, error: itemError } = await client
        .from('stock_items')
        .insert({
          stock_name: stockName.trim(),
          item_barcode: cleanBarcode,
          item_quantity: quantity,
          box_quantity: 0,
          reorder_level: 0,
          is_active: true,
        })
        .select('*')
        .single();

      if (itemError) {
        setSaving(false);
        setError(itemError.message);
        return;
      }

      stockItemId = newItem.id;
    }

    const { error: scanError } = await client.from('stock_scan_events').insert({
      barcode: cleanBarcode,
      scan_type: 'stock_add',
      branch,
      quantity,
      stock_item_id: stockItemId,
      scanned_by: businessUser.id,
      notes: notes.trim() || null,
    });

    if (scanError) {
      setSaving(false);
      setError(scanError.message);
      return;
    }

    const { data: movement } = await client.from('inventory_movements').insert({
      stock_item_id: stockItemId,
      branch,
      movement_type: 'received',
      quantity,
      reference_type: 'stock_scan',
      notes: notes.trim() || `Stock scan ${cleanBarcode}`,
      created_by: businessUser.id,
    }).select('id').single();

    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch,
      entityType: 'stock',
      entityId: stockItemId,
      action: 'stock_scan_recorded',
      summary: `Stock scan recorded for ${cleanBarcode} with quantity ${quantity}.`,
      afterPayload: { barcode: cleanBarcode, quantity, stock_item_id: stockItemId, inventory_movement_id: movement?.id ?? null },
    });

    setSaving(false);
    setMessage(stockItemId ? 'Stock scan and inventory movement recorded.' : 'Stock scan recorded without linked stock item.');
    setBarcode('');
    setStockName('');
    setQuantity(1);
    setNotes('');
  }

  return (
    <div className="neo-card">
      <h2>Scan stock into warehouse</h2>
      <p>Warehouse and admins can scan item/box barcodes, create missing stock records, and record inbound stock events.</p>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <form className="grid" onSubmit={addStockScan}>
        <div className="form-grid">
          <label>Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
              <option value="jhb">jhb</option><option value="cpt">cpt</option><option value="kzn">kzn</option><option value="national">national</option>
            </select>
          </label>
          <label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <label>Stock name when new<input value={stockName} onChange={(event) => setStockName(event.target.value)} /></label>
        </div>
        <BarcodeCapture label="Stock barcode" value={barcode} onChange={setBarcode} />
        <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button className="button pulse-button" disabled={saving || !barcode.trim()} type="submit">{saving ? 'Recording scan...' : 'Record stock scan'}</button>
      </form>
    </div>
  );
}
