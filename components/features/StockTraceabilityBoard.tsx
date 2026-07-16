'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type TrackingMode = 'none' | 'lot' | 'serial' | 'lot_serial';
type StockItem = {
  id: string;
  stock_name: string;
  sku: string | null;
  item_barcode: string;
  box_barcode: string | null;
  item_quantity: number;
  box_quantity: number;
  tracking_mode: TrackingMode;
  shelf_life_days: number | null;
};
type Location = { id: string; location_code: string; description: string | null; warehouses?: { branch: string; warehouse_name: string } | Array<{ branch: string; warehouse_name: string }> | null };
type LotRow = { id: string; lot_number: string; manufacture_date: string | null; expiry_date: string | null; quantity_items: number; quantity_boxes: number; location_id: string | null; status: string; notes: string | null; updated_at: string };
type SerialRow = { id: string; serial_number: string; lot_id: string | null; location_id: string | null; work_item_id: string | null; customer_id: string | null; machine_id: string | null; status: string; received_at: string; issued_at: string | null; notes: string | null };
type WorkOption = { id: string; work_number: string; title: string; assigned_to: string | null; status: string };

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function StockTraceabilityBoard() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [workItems, setWorkItems] = useState<WorkOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [lots, setLots] = useState<LotRow[]>([]);
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('none');
  const [shelfLifeDays, setShelfLifeDays] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [lotQuantity, setLotQuantity] = useState(1);
  const [lotUnit, setLotUnit] = useState<'item' | 'box'>('item');
  const [lotLocationId, setLotLocationId] = useState('');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [lotNotes, setLotNotes] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [serialLotId, setSerialLotId] = useState('');
  const [serialLocationId, setSerialLocationId] = useState('');
  const [serialNotes, setSerialNotes] = useState('');
  const [issueLotId, setIssueLotId] = useState('');
  const [issueSerialId, setIssueSerialId] = useState('');
  const [issueWorkId, setIssueWorkId] = useState('');
  const [issueQuantity, setIssueQuantity] = useState(1);
  const [issueUnit, setIssueUnit] = useState<'item' | 'box'>('item');
  const [issueNotes, setIssueNotes] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function loadReferenceData() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [itemResult, locationResult, workResult] = await Promise.all([
      client.from('stock_items').select('id, stock_name, sku, item_barcode, box_barcode, item_quantity, box_quantity, tracking_mode, shelf_life_days').eq('is_active', true).order('stock_name').limit(2500),
      client.from('stock_locations').select('id, location_code, description, warehouses(branch, warehouse_name)').eq('status', 'active').order('location_code'),
      client.from('work_items').select('id, work_number, title, assigned_to, status').not('status', 'in', '(completed,cancelled)').order('created_at', { ascending: false }).limit(500),
    ]);
    const firstError = itemResult.error ?? locationResult.error ?? workResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      const rows = (itemResult.data ?? []) as StockItem[];
      setItems(rows);
      setLocations((locationResult.data ?? []) as Location[]);
      setWorkItems((workResult.data ?? []) as WorkOption[]);
      const initialId = selectedId || rows[0]?.id || '';
      setSelectedId(initialId);
      const initial = rows.find((item) => item.id === initialId);
      if (initial) {
        setTrackingMode(initial.tracking_mode);
        setShelfLifeDays(initial.shelf_life_days ? String(initial.shelf_life_days) : '');
      }
    }
    setLoading(false);
  }

  async function loadTraceability(stockItemId: string) {
    if (!stockItemId) {
      setLots([]);
      setSerials([]);
      return;
    }
    const client = getSupabaseClient();
    const [lotResult, serialResult] = await Promise.all([
      client.from('stock_lots').select('id, lot_number, manufacture_date, expiry_date, quantity_items, quantity_boxes, location_id, status, notes, updated_at').eq('stock_item_id', stockItemId).order('expiry_date', { ascending: true, nullsFirst: false }),
      client.from('stock_serials').select('id, serial_number, lot_id, location_id, work_item_id, customer_id, machine_id, status, received_at, issued_at, notes').eq('stock_item_id', stockItemId).order('created_at', { ascending: false }),
    ]);
    const firstError = lotResult.error ?? serialResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    setLots((lotResult.data ?? []) as LotRow[]);
    setSerials((serialResult.data ?? []) as SerialRow[]);
  }

  useEffect(() => {
    loadReferenceData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load traceability.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const item = items.find((row) => row.id === selectedId);
    if (item) {
      setTrackingMode(item.tracking_mode);
      setShelfLifeDays(item.shelf_life_days ? String(item.shelf_life_days) : '');
    }
    loadTraceability(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load traceability records.'));
  }, [selectedId, items]);

  async function saveTracking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await getSupabaseClient().from('stock_items').update({ tracking_mode: trackingMode, shelf_life_days: shelfLifeDays ? Number(shelfLifeDays) : null, updated_at: new Date().toISOString() }).eq('id', selected.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage('Tracking configuration saved.');
    await loadReferenceData();
  }

  async function receiveLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    const { error: receiveError } = await getSupabaseClient().rpc('receive_stock_lot', {
      p_stock_item_id: selected.id,
      p_lot_number: lotNumber.trim(),
      p_quantity: Number(lotQuantity),
      p_quantity_unit: lotUnit,
      p_location_id: lotLocationId || null,
      p_manufacture_date: manufactureDate || null,
      p_expiry_date: expiryDate || null,
      p_purchase_order_id: null,
      p_notes: lotNotes.trim() || null,
    });
    setSaving(false);
    if (receiveError) {
      setError(receiveError.message);
      return;
    }
    setMessage('Lot received and stock updated.');
    setLotNumber('');
    setLotQuantity(1);
    setManufactureDate('');
    setExpiryDate('');
    setLotNotes('');
    await loadReferenceData();
    await loadTraceability(selected.id);
  }

  async function receiveSerial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    const { error: receiveError } = await getSupabaseClient().rpc('receive_stock_serial', {
      p_stock_item_id: selected.id,
      p_serial_number: serialNumber.trim(),
      p_lot_id: serialLotId || null,
      p_location_id: serialLocationId || null,
      p_purchase_order_id: null,
      p_notes: serialNotes.trim() || null,
    });
    setSaving(false);
    if (receiveError) {
      setError(receiveError.message);
      return;
    }
    setMessage('Serialized unit received and stock updated.');
    setSerialNumber('');
    setSerialNotes('');
    await loadReferenceData();
    await loadTraceability(selected.id);
  }

  async function issueLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issueLotId || !issueWorkId) return;
    setSaving(true);
    const { error: issueError } = await getSupabaseClient().rpc('issue_stock_lot', { p_lot_id: issueLotId, p_work_item_id: issueWorkId, p_quantity: Number(issueQuantity), p_quantity_unit: issueUnit, p_notes: issueNotes.trim() || null });
    setSaving(false);
    if (issueError) {
      setError(issueError.message);
      return;
    }
    setMessage('Lot quantity issued to work.');
    setIssueLotId('');
    setIssueQuantity(1);
    setIssueNotes('');
    if (selected) await loadTraceability(selected.id);
    await loadReferenceData();
  }

  async function issueSerial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issueSerialId || !issueWorkId) return;
    setSaving(true);
    const { error: issueError } = await getSupabaseClient().rpc('issue_stock_serial', { p_serial_id: issueSerialId, p_work_item_id: issueWorkId, p_customer_id: null, p_machine_id: null, p_notes: issueNotes.trim() || null });
    setSaving(false);
    if (issueError) {
      setError(issueError.message);
      return;
    }
    setMessage('Serialized unit issued to work.');
    setIssueSerialId('');
    setIssueNotes('');
    if (selected) await loadTraceability(selected.id);
    await loadReferenceData();
  }

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => !term || [item.stock_name, item.sku, item.item_barcode, item.box_barcode].join(' ').toLowerCase().includes(term));
  }, [items, search]);
  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const expiringLots = lots.filter((lot) => lot.expiry_date && new Date(lot.expiry_date).getTime() <= Date.now() + 60 * 86400000 && lot.status === 'active').length;
  const availableSerials = serials.filter((serial) => serial.status === 'in_stock').length;

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-split">
        <aside className="neo-card">
          <div className="minimal-toolbar"><div><h2>Stock items</h2><p>Select an item to manage traceability.</p></div></div>
          <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, SKU or barcode" /></label>
          <div className="minimal-list minimal-form-section">
            {filteredItems.length === 0 ? <div className="minimal-empty">{loading ? 'Loading stock...' : 'No matching stock items.'}</div> : filteredItems.slice(0, 100).map((item) => <button className={`minimal-list-item ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)} type="button"><div><h3>{item.stock_name}</h3><p>{item.sku ?? item.item_barcode}</p></div><StatusBadge value={item.tracking_mode} /></button>)}
          </div>
        </aside>

        <section className="grid">
          {!selected ? <div className="minimal-empty">Select a stock item.</div> : <>
            <section className="neo-card">
              <div className="minimal-toolbar"><div><h2>{selected.stock_name}</h2><p>{selected.sku ?? 'No SKU'} • {selected.item_barcode}</p></div><div className="feature-list"><StatusBadge value={selected.tracking_mode} /><span className="feature-pill">{selected.item_quantity} items</span><span className="feature-pill">{selected.box_quantity} boxes</span></div></div>
              <form className="form-grid" onSubmit={saveTracking}>
                <label>Tracking mode<select value={trackingMode} onChange={(event) => setTrackingMode(event.target.value as TrackingMode)}><option value="none">No traceability</option><option value="lot">Lot / batch</option><option value="serial">Serial number</option><option value="lot_serial">Lot and serial</option></select></label>
                <label>Shelf life days<input min="1" type="number" value={shelfLifeDays} onChange={(event) => setShelfLifeDays(event.target.value)} /></label>
                <div style={{ alignSelf: 'end' }}><button className="button secondary" disabled={saving} type="submit">Save tracking</button></div>
              </form>
            </section>

            <div className="minimal-metric-grid">
              <div className="minimal-metric"><span>Lots</span><strong>{lots.length}</strong></div>
              <div className="minimal-metric"><span>Expiring in 60 days</span><strong>{expiringLots}</strong></div>
              <div className="minimal-metric"><span>Serialized units</span><strong>{serials.length}</strong></div>
              <div className="minimal-metric"><span>Available serials</span><strong>{availableSerials}</strong></div>
            </div>

            {(trackingMode === 'lot' || trackingMode === 'lot_serial') ? <section className="neo-card"><div className="minimal-toolbar"><div><h2>Receive lot</h2><p>Receiving updates the lot and on-hand balance atomically.</p></div></div><form className="grid" onSubmit={receiveLot}><div className="form-grid"><label>Lot number<input required value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} /></label><label>Quantity<input min="1" type="number" value={lotQuantity} onChange={(event) => setLotQuantity(Number(event.target.value))} /></label><label>Unit<select value={lotUnit} onChange={(event) => setLotUnit(event.target.value as 'item' | 'box')}><option value="item">Items</option><option value="box">Boxes</option></select></label><label>Location<select value={lotLocationId} onChange={(event) => setLotLocationId(event.target.value)}><option value="">Unassigned</option>{locations.map((location) => { const warehouse = firstRelation(location.warehouses); return <option key={location.id} value={location.id}>{warehouse?.branch.toUpperCase() ?? '-'} • {location.location_code}</option>; })}</select></label><label>Manufactured<input type="date" value={manufactureDate} onChange={(event) => setManufactureDate(event.target.value)} /></label><label>Expiry<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label></div><label>Notes<input value={lotNotes} onChange={(event) => setLotNotes(event.target.value)} /></label><button className="button" disabled={saving || !lotNumber.trim()} type="submit">Receive lot</button></form></section> : null}

            {(trackingMode === 'serial' || trackingMode === 'lot_serial') ? <section className="neo-card"><div className="minimal-toolbar"><div><h2>Receive serialized unit</h2><p>Each serial adds one item to stock.</p></div></div><form className="grid" onSubmit={receiveSerial}><div className="form-grid"><label>Serial number<input required value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>{trackingMode === 'lot_serial' ? <label>Lot<select value={serialLotId} onChange={(event) => setSerialLotId(event.target.value)}><option value="">No lot selected</option>{lots.filter((lot) => lot.status === 'active').map((lot) => <option key={lot.id} value={lot.id}>{lot.lot_number}</option>)}</select></label> : null}<label>Location<select value={serialLocationId} onChange={(event) => setSerialLocationId(event.target.value)}><option value="">Unassigned</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.location_code}</option>)}</select></label></div><label>Notes<input value={serialNotes} onChange={(event) => setSerialNotes(event.target.value)} /></label><button className="button" disabled={saving || !serialNumber.trim()} type="submit">Receive serial</button></form></section> : null}

            <div className="minimal-split">
              <section className="neo-card"><div className="minimal-toolbar"><div><h2>Lots</h2><p>Batch, expiry and available quantities.</p></div></div><div className="minimal-list">{lots.length === 0 ? <div className="minimal-empty">No lots recorded.</div> : lots.map((lot) => <div className="minimal-list-item" key={lot.id}><div><h3>{lot.lot_number}</h3><p>{lot.quantity_items} items • {lot.quantity_boxes} boxes • {lot.location_id ? locationMap.get(lot.location_id)?.location_code ?? 'Location' : 'Unassigned'}</p><small>{lot.expiry_date ? `Expires ${lot.expiry_date}` : 'No expiry'}{lot.notes ? ` • ${lot.notes}` : ''}</small></div><StatusBadge value={lot.expiry_date && new Date(lot.expiry_date).getTime() < Date.now() ? 'expired' : lot.status} /></div>)}</div></section>
              <section className="neo-card"><div className="minimal-toolbar"><div><h2>Serials</h2><p>Unit-level custody and issue status.</p></div></div><div className="minimal-list">{serials.length === 0 ? <div className="minimal-empty">No serials recorded.</div> : serials.slice(0, 100).map((serial) => <div className="minimal-list-item" key={serial.id}><div><h3>{serial.serial_number}</h3><p>{serial.location_id ? locationMap.get(serial.location_id)?.location_code ?? 'Location' : 'Unassigned'}{serial.work_item_id ? ` • Work ${serial.work_item_id.slice(0, 8)}` : ''}</p><small>Received {new Date(serial.received_at).toLocaleDateString()}</small></div><StatusBadge value={serial.status} /></div>)}</div></section>
            </div>

            {(lots.some((lot) => lot.status === 'active') || serials.some((serial) => serial.status === 'in_stock')) ? <section className="neo-card"><div className="minimal-toolbar"><div><h2>Issue traceable stock to work</h2><p>Only assigned or authorized users can consume parts.</p></div></div><div className="minimal-split"><form className="grid" onSubmit={issueLot}><h3>Issue lot quantity</h3><label>Lot<select value={issueLotId} onChange={(event) => setIssueLotId(event.target.value)}><option value="">Select lot</option>{lots.filter((lot) => lot.status === 'active').map((lot) => <option key={lot.id} value={lot.id}>{lot.lot_number}</option>)}</select></label><label>Work item<select value={issueWorkId} onChange={(event) => setIssueWorkId(event.target.value)}><option value="">Select work</option>{workItems.map((work) => <option key={work.id} value={work.id}>{work.work_number} — {work.title}</option>)}</select></label><div className="form-grid"><label>Quantity<input min="1" type="number" value={issueQuantity} onChange={(event) => setIssueQuantity(Number(event.target.value))} /></label><label>Unit<select value={issueUnit} onChange={(event) => setIssueUnit(event.target.value as 'item' | 'box')}><option value="item">Items</option><option value="box">Boxes</option></select></label></div><label>Notes<input value={issueNotes} onChange={(event) => setIssueNotes(event.target.value)} /></label><button className="button secondary" disabled={saving || !issueLotId || !issueWorkId} type="submit">Issue lot</button></form><form className="grid" onSubmit={issueSerial}><h3>Issue serialized unit</h3><label>Serial<select value={issueSerialId} onChange={(event) => setIssueSerialId(event.target.value)}><option value="">Select serial</option>{serials.filter((serial) => serial.status === 'in_stock').map((serial) => <option key={serial.id} value={serial.id}>{serial.serial_number}</option>)}</select></label><label>Work item<select value={issueWorkId} onChange={(event) => setIssueWorkId(event.target.value)}><option value="">Select work</option>{workItems.map((work) => <option key={work.id} value={work.id}>{work.work_number} — {work.title}</option>)}</select></label><label>Notes<input value={issueNotes} onChange={(event) => setIssueNotes(event.target.value)} /></label><button className="button secondary" disabled={saving || !issueSerialId || !issueWorkId} type="submit">Issue serial</button></form></div></section> : null}
          </>}
        </section>
      </div>
    </div>
  );
}
