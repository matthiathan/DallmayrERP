'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type Mode = 'received' | 'issued' | 'adjustment_in' | 'adjustment_out' | 'cycle_count' | 'transferred';
type QuantityUnit = 'item' | 'box';
type StockLookup = { id: string; stock_name: string; item_barcode: string; box_barcode: string | null; item_quantity: number; box_quantity: number; items_per_box: number | null; reorder_level: number; warehouse_location: string | null; default_location_id: string | null };
type Warehouse = { id: string; branch: Branch; warehouse_name: string };
type Location = { id: string; warehouse_id: string; location_code: string; description: string | null };

const modes: Array<{ value: Mode; label: string; helper: string }> = [
  { value: 'received', label: 'Receive', helper: 'Add delivered or returned stock.' },
  { value: 'issued', label: 'Issue / ship', helper: 'Remove stock for jobs, deliveries or internal use.' },
  { value: 'adjustment_in', label: 'Adjust up', helper: 'Correct stock upward with an audit reason.' },
  { value: 'adjustment_out', label: 'Adjust down', helper: 'Correct stock downward with an audit reason.' },
  { value: 'cycle_count', label: 'Cycle count', helper: 'Set the counted quantity for an item or box.' },
  { value: 'transferred', label: 'Transfer', helper: 'Move stock between warehouse locations.' },
];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

export function StockControlPanel({ onCommitted }: { onCommitted?: () => void }) {
  const [mode, setMode] = useState<Mode>('received');
  const [branch, setBranch] = useState<Branch>('jhb');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnit>('item');
  const [stock, setStock] = useState<StockLookup | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [referenceType, setReferenceType] = useState('manual');
  const [referenceId, setReferenceId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLocations() {
    const client = getSupabaseClient();
    const [warehouseResult, locationResult] = await Promise.all([
      client.from('warehouses').select('id, branch, warehouse_name').eq('status', 'active').order('warehouse_name'),
      client.from('stock_locations').select('id, warehouse_id, location_code, description').eq('status', 'active').order('location_code'),
    ]);
    if (warehouseResult.error || locationResult.error) {
      setError(warehouseResult.error?.message ?? locationResult.error?.message ?? 'Could not load warehouse locations.');
      return;
    }
    setWarehouses((warehouseResult.data ?? []) as Warehouse[]);
    setLocations((locationResult.data ?? []) as Location[]);
  }

  useEffect(() => {
    loadLocations().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load warehouse locations.'));
  }, []);

  const branchWarehouseIds = useMemo(() => new Set(warehouses.filter((warehouse) => warehouse.branch === branch || branch === 'national').map((warehouse) => warehouse.id)), [branch, warehouses]);
  const availableLocations = useMemo(() => locations.filter((location) => branchWarehouseIds.has(location.warehouse_id)), [branchWarehouseIds, locations]);

  async function resolveBarcode(value: string) {
    const cleanValue = value.trim();
    setBarcode(cleanValue);
    setStock(null);
    setMessage(null);
    setError(null);
    if (!cleanValue) return;

    const { data, error: lookupError } = await getSupabaseClient().from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, box_quantity, items_per_box, reorder_level, warehouse_location, default_location_id').or(`item_barcode.eq.${cleanValue},box_barcode.eq.${cleanValue}`).maybeSingle();
    if (lookupError) {
      setError(lookupError.message);
      return;
    }
    if (!data) {
      setError('Barcode not found. Create the stock item in the stock register first.');
      return;
    }

    const matched = data as StockLookup;
    setStock(matched);
    setQuantityUnit(matched.box_barcode === cleanValue ? 'box' : 'item');
    if (matched.default_location_id) {
      setSourceLocationId(matched.default_location_id);
      setDestinationLocationId(matched.default_location_id);
    }
    setMessage(`${matched.stock_name} found. On hand: ${matched.item_quantity} item(s) and ${matched.box_quantity} box(es).`);
  }

  function resetForm() {
    setBarcode('');
    setStock(null);
    setQuantity(1);
    setNotes('');
    setReferenceId('');
    setMessage(null);
  }

  async function commitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stock) return;
    if (mode === 'transferred' && (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId)) {
      setError('Select different source and destination locations.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    const referenceNote = referenceId.trim() ? `${referenceType}: ${referenceId.trim()}` : '';
    const transactionNotes = [notes.trim(), referenceNote].filter(Boolean).join(' • ') || null;
    const { data, error: transactionError } = await getSupabaseClient().rpc('apply_stock_transaction', {
      p_stock_item_id: stock.id,
      p_movement_type: mode,
      p_quantity: Number(quantity),
      p_quantity_unit: quantityUnit,
      p_branch: branch,
      p_source_location_id: mode === 'transferred' || ['issued', 'adjustment_out'].includes(mode) ? sourceLocationId || null : null,
      p_destination_location_id: mode === 'transferred' || ['received', 'adjustment_in'].includes(mode) ? destinationLocationId || null : null,
      p_reference_type: referenceType || null,
      p_reference_id: null,
      p_notes: transactionNotes,
      p_barcode: barcode,
    });
    setSaving(false);

    if (transactionError) {
      setError(transactionError.message);
      return;
    }

    const result = data as { item_quantity?: number; box_quantity?: number } | null;
    setMessage(`${stock.stock_name} updated. New balance: ${result?.item_quantity ?? stock.item_quantity} item(s), ${result?.box_quantity ?? stock.box_quantity} box(es).`);
    onCommitted?.();
    window.setTimeout(resetForm, 1200);
  }

  const selectedMode = modes.find((item) => item.value === mode) ?? modes[0];
  const showSource = mode === 'issued' || mode === 'adjustment_out' || mode === 'transferred';
  const showDestination = mode === 'received' || mode === 'adjustment_in' || mode === 'transferred';

  return (
    <section className="neo-card stock-control-centre">
      <div className="page-toolbar-heading"><div><div className="badge">Phone stock control</div><h2>Scan and transact stock</h2><p>{selectedMode.helper}</p></div><StatusBadge value={stock ? 'active' : 'unknown'} label={stock ? 'Item matched' : 'Awaiting scan'} /></div>
      <div className="stock-mode-grid" role="tablist" aria-label="Stock transaction type">{modes.map((item) => <button aria-selected={mode === item.value} className={`stock-mode-button ${mode === item.value ? 'is-active' : ''}`} key={item.value} onClick={() => { setMode(item.value); setError(null); setMessage(null); }} role="tab" type="button"><strong>{item.label}</strong><span>{item.helper}</span></button>)}</div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <form className="grid" onSubmit={commitTransaction}>
        <div className="form-grid"><label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label><label>Quantity unit<select value={quantityUnit} onChange={(event) => setQuantityUnit(event.target.value as QuantityUnit)}><option value="item">Items</option><option value="box">Boxes</option></select></label><label>{mode === 'cycle_count' ? 'Counted quantity' : 'Quantity'}<input min={mode === 'cycle_count' ? 0 : 1} type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label></div>
        <BarcodeCapture label="Stock QR / barcode" value={barcode} onChange={resolveBarcode} />
        {stock ? <div className="stock-match-card"><div><strong>{stock.stock_name}</strong><span>{stock.item_barcode}{stock.box_barcode ? ` • Box ${stock.box_barcode}` : ''}</span></div><div><span>Items</span><strong>{stock.item_quantity}</strong></div><div><span>Boxes</span><strong>{stock.box_quantity}</strong></div><div><span>Reorder</span><strong>{stock.reorder_level}</strong></div></div> : null}
        <div className="form-grid">{showSource ? <label>Source location<select required value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)}><option value="">Select source</option>{availableLocations.map((location) => <option key={location.id} value={location.id}>{location.location_code}{location.description ? ` — ${location.description}` : ''}</option>)}</select></label> : null}{showDestination ? <label>Destination location<select required={mode === 'transferred'} value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="">Unassigned / total stock</option>{availableLocations.map((location) => <option key={location.id} value={location.id}>{location.location_code}{location.description ? ` — ${location.description}` : ''}</option>)}</select></label> : null}<label>Reference type<select value={referenceType} onChange={(event) => setReferenceType(event.target.value)}><option value="manual">Manual transaction</option><option value="purchase_order">Purchase order</option><option value="delivery_order">Delivery order</option><option value="service_job">Service job</option><option value="cycle_count">Cycle count sheet</option></select></label><label>Reference<input placeholder="PO number, order, job or count sheet" value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label></div>
        <label>Reason / notes<textarea required={mode.startsWith('adjustment')} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason, supplier delivery note, job number or stock-count comment" /></label>
        <button className="button pulse-button" disabled={saving || !stock || !barcode || (mode !== 'cycle_count' && quantity <= 0)} type="submit">{saving ? 'Updating stock...' : `${selectedMode.label} stock`}</button>
      </form>
    </section>
  );
}
