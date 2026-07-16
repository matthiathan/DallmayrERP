'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScannerMatchCard } from '@/components/ui/ScannerMatchCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatusTimeline } from '@/components/ui/StatusTimeline';
import { resolveStockBarcode, type ResolvedStockBarcode } from '@/lib/data/stockBarcode';
import { useDuplicateScanGuard } from '@/lib/hooks/useDuplicateScanGuard';
import { getSupabaseClient } from '@/lib/supabase/client';

type Location = { id: string; location_code: string; description: string | null };
type PartRow = { id: string; quantity: number; quantity_unit: 'item' | 'box'; unit_cost: number | null; notes: string | null; created_at: string; stock_items?: { stock_name: string | null } | Array<{ stock_name: string | null }> | null };

function stockName(row: PartRow) {
  const relation = Array.isArray(row.stock_items) ? row.stock_items[0] : row.stock_items;
  return relation?.stock_name ?? 'Stock item';
}

export function WorkPartsPanel({ workItemId }: { workItemId: string }) {
  const [barcode, setBarcode] = useState('');
  const [matched, setMatched] = useState<ResolvedStockBarcode | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState<'item' | 'box'>('item');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isDuplicateScan = useDuplicateScanGuard();

  async function loadParts() {
    const client = getSupabaseClient();
    const [partResult, locationResult] = await Promise.all([
      client.from('work_parts_used').select('id, quantity, quantity_unit, unit_cost, notes, created_at, stock_items(stock_name)').eq('work_item_id', workItemId).order('created_at', { ascending: false }),
      client.from('stock_locations').select('id, location_code, description').eq('status', 'active').order('location_code'),
    ]);
    const firstError = partResult.error ?? locationResult.error;
    if (firstError) throw firstError;
    setParts((partResult.data ?? []) as PartRow[]);
    setLocations((locationResult.data ?? []) as Location[]);
  }

  useEffect(() => {
    loadParts().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load parts used.'));
  }, [workItemId]);

  const totalCost = useMemo(() => parts.reduce((sum, part) => sum + Number(part.unit_cost ?? 0) * part.quantity, 0), [parts]);
  const available = matched ? (unit === 'box' ? matched.box_quantity : matched.item_quantity) : 0;
  const quantityInvalid = quantity <= 0;
  const exceedsAvailable = Boolean(matched && quantity > available);
  const fieldHint = !matched
    ? 'Scan a part barcode to continue.'
    : quantityInvalid
      ? 'Quantity must be greater than zero.'
      : exceedsAvailable
        ? `Only ${available} ${unit}(s) are available.`
        : null;

  async function resolveBarcode(value: string) {
    const clean = value.trim();
    setBarcode(clean);
    setMatched(null);
    setError(null);
    setMessage(null);
    if (!clean) return;
    if (isDuplicateScan(clean)) {
      setMessage('Duplicate scan ignored. Scan again after a moment to confirm repeated use.');
      return;
    }

    try {
      const item = await resolveStockBarcode(clean);
      if (!item) {
        setError('Barcode not found in the stock master.');
        return;
      }
      setMatched(item);
      setUnit(item.matched_unit);
      setLocationId(item.default_location_id ?? '');
      setMessage(`${item.stock_name} selected as ${item.matched_unit}. Confirm quantity before using the part.`);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Barcode lookup failed.');
    }
  }

  async function consumePart() {
    if (!matched) return;
    if (fieldHint) {
      setError(fieldHint);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: consumeError } = await getSupabaseClient().rpc('consume_work_part', {
      p_work_item_id: workItemId,
      p_stock_item_id: matched.id,
      p_quantity: quantity,
      p_quantity_unit: unit,
      p_source_location_id: locationId || null,
      p_notes: notes.trim() || null,
      p_barcode: barcode,
    });
    setSaving(false);
    if (consumeError) {
      setError(consumeError.message);
      return;
    }
    setMessage(`${matched.stock_name} recorded and deducted from stock.`);
    setBarcode('');
    setMatched(null);
    setQuantity(1);
    setNotes('');
    await loadParts();
  }

  return (
    <section className="minimal-panel">
      <div className="minimal-panel-header">
        <div><span className="minimal-kicker">Materials</span><h2>Parts used</h2><p>Scan stock used on this job. The stock ledger and job cost update together.</p></div>
        <div className="minimal-summary"><span>{parts.length} entries</span><strong>R {totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
      </div>
      <StatusTimeline compact currentIndex={!matched ? 0 : fieldHint ? 1 : 2} steps={[{ label: 'Scan' }, { label: 'Confirm' }, { label: 'Use part' }]} />
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-split">
        <div className="minimal-form">
          <BarcodeCapture label="Part barcode" value={barcode} onChange={resolveBarcode} />
          {matched ? <ScannerMatchCard availableBoxes={matched.box_quantity} availableItems={matched.item_quantity} barcode={barcode} location={matched.warehouse_location} title={matched.stock_name} unit={matched.matched_unit} /> : null}
          <div className="minimal-grid-3">
            <label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />{quantityInvalid || exceedsAvailable ? <small className="field-note danger">{fieldHint}</small> : null}</label>
            <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value as 'item' | 'box')}><option value="item">Items</option><option value="box">Boxes</option></select></label>
            <label>Source location<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Unassigned stock</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.location_code}{location.description ? ` — ${location.description}` : ''}</option>)}</select></label>
          </div>
          <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason or installation note" /></label>
          <button className="button" disabled={saving || !matched || Boolean(fieldHint)} onClick={consumePart} type="button">{saving ? 'Recording...' : 'Use part'}</button>
        </div>

        <div className="minimal-list">
          {parts.length === 0 ? <EmptyState title="No parts used yet" message="Scan a part barcode to deduct stock and attach the cost to this work item." /> : parts.map((part) => <article className="minimal-list-item" key={part.id}><div><strong>{stockName(part)}</strong><p>{part.quantity} {part.quantity_unit}{part.notes ? ` • ${part.notes}` : ''}</p><small>{new Date(part.created_at).toLocaleString()}</small></div><StatusBadge value="issued" label={part.unit_cost === null ? 'Cost not set' : `R ${(Number(part.unit_cost) * part.quantity).toFixed(2)}`} /></article>)}
        </div>
      </div>
    </section>
  );
}
