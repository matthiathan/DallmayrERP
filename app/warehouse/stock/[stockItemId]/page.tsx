'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type StockItemProfile = {
  id: string; stock_name: string; sku: string | null; description: string | null; item_barcode: string; box_barcode: string | null;
  item_quantity: number; box_quantity: number; items_per_box: number | null; category: string | null; supplier_name: string | null;
  warehouse_location: string | null; reorder_level: number; preferred_reorder_quantity: number; unit_cost: number | null; sales_price: number | null;
  is_active: boolean; notes: string | null; default_location_id: string | null;
};
type PhotoRow = { id: string; file_path: string; file_name: string; is_primary: boolean; created_at: string; signed_url?: string };
type BalanceRow = { id: string; location_id: string; item_quantity: number; box_quantity: number; updated_at: string };
type MovementRow = { id: string; branch: string; movement_type: string; quantity: number; quantity_unit: string; source_location_id: string | null; destination_location_id: string | null; reference_type: string | null; notes: string | null; balance_after_items: number | null; balance_after_boxes: number | null; created_at: string };
type LocationRow = { id: string; warehouse_id: string; location_code: string; description: string | null };
type WarehouseRow = { id: string; warehouse_name: string; branch: string };

export default function StockItemProfilePage() {
  const { stockItemId } = useParams<{ stockItemId: string }>();
  const [item, setItem] = useState<StockItemProfile | null>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadProfile() {
    setError(null);
    const client = getSupabaseClient();
    const [itemResult, photoResult, balanceResult, movementResult, locationResult, warehouseResult] = await Promise.all([
      client.from('stock_items').select('id, stock_name, sku, description, item_barcode, box_barcode, item_quantity, box_quantity, items_per_box, category, supplier_name, warehouse_location, reorder_level, preferred_reorder_quantity, unit_cost, sales_price, is_active, notes, default_location_id').eq('id', stockItemId).single(),
      client.from('stock_item_photos').select('id, file_path, file_name, is_primary, created_at').eq('stock_item_id', stockItemId).order('is_primary', { ascending: false }).order('created_at', { ascending: false }),
      client.from('stock_balances').select('id, location_id, item_quantity, box_quantity, updated_at').eq('stock_item_id', stockItemId),
      client.from('inventory_movements').select('id, branch, movement_type, quantity, quantity_unit, source_location_id, destination_location_id, reference_type, notes, balance_after_items, balance_after_boxes, created_at').eq('stock_item_id', stockItemId).order('created_at', { ascending: false }).limit(100),
      client.from('stock_locations').select('id, warehouse_id, location_code, description'),
      client.from('warehouses').select('id, warehouse_name, branch'),
    ]);
    const firstError = itemResult.error ?? photoResult.error ?? balanceResult.error ?? movementResult.error ?? locationResult.error ?? warehouseResult.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    setItem(itemResult.data as StockItemProfile);
    setBalances((balanceResult.data ?? []) as BalanceRow[]);
    setMovements((movementResult.data ?? []) as MovementRow[]);
    setLocations((locationResult.data ?? []) as LocationRow[]);
    setWarehouses((warehouseResult.data ?? []) as WarehouseRow[]);

    const signedPhotos = await Promise.all(((photoResult.data ?? []) as PhotoRow[]).map(async (photo) => {
      const { data } = await client.storage.from('dallmayrerp-stock-photos').createSignedUrl(photo.file_path, 3600);
      return { ...photo, signed_url: data?.signedUrl };
    }));
    setPhotos(signedPhotos);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadProfile().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load stock item.'));
  }, [stockItemId]);

  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const warehouseMap = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const totalEquivalent = item ? item.item_quantity + item.box_quantity * (item.items_per_box ?? 1) : 0;

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !item) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    const client = getSupabaseClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${item.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await client.storage.from('dallmayrerp-stock-photos').upload(path, file, { upsert: false });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { error: recordError } = await client.from('stock_item_photos').insert({ stock_item_id: item.id, file_path: path, file_name: file.name, mime_type: file.type || null, file_size: file.size, is_primary: photos.length === 0 });
    setUploading(false);
    event.target.value = '';
    if (recordError) {
      setError(recordError.message);
      return;
    }
    setMessage('Stock photo uploaded.');
    await loadProfile();
  }

  if (!item && !error) return <AppShell><div className="neo-card"><h2>Loading stock item...</h2></div></AppShell>;

  return (
    <AppShell>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {!item ? <div className="neo-card"><h1>Stock item not found</h1><Link className="button" href="/warehouse/stock">Back to stock</Link></div> : <div className="grid spatial-stage spatial-dashboard">
        <div className="page-header hero-panel spatial-card"><div><div className="badge">Stock item profile</div><h1>{item.stock_name}</h1><p>{item.sku ?? 'No SKU'} • {item.category ?? 'Uncategorised'}</p><div className="feature-list"><StatusBadge value={item.is_active ? 'active' : 'inactive'} /><span className="feature-pill">Item barcode: {item.item_barcode}</span>{item.box_barcode ? <span className="feature-pill">Box barcode: {item.box_barcode}</span> : null}</div><p>{item.description ?? item.notes ?? 'No description recorded.'}</p></div></div>

        <div className="grid grid-3 spatial-kpi-grid"><div className="card"><div className="nav-heading">Loose items</div><div className="kpi-value">{item.item_quantity}</div></div><div className="card"><div className="nav-heading">Boxes</div><div className="kpi-value">{item.box_quantity}</div></div><div className="card"><div className="nav-heading">Total item equivalent</div><div className="kpi-value">{totalEquivalent}</div></div><div className="card"><div className="nav-heading">Reorder level</div><div className="kpi-value">{item.reorder_level}</div></div><div className="card"><div className="nav-heading">Unit cost</div><div className="kpi-value">{item.unit_cost ?? '-'}</div></div></div>

        <PageToolbar actions={<><Link className="button" href={`/warehouse/stock?stock=${item.id}`}>Open stock control</Link><Link className="button secondary" href="/warehouse/purchasing">Purchase orders</Link><button className="button secondary" onClick={loadProfile} type="button">Refresh</button></>} description="Photos, quantities, locations and audited movement history for this item." lastUpdated={lastUpdated} title="Item workspace" />

        <section className="neo-card"><div className="page-toolbar-heading"><div><h2>Item photos</h2><p>Add phone photos for fast visual identification.</p></div><label className="button secondary">{uploading ? 'Uploading...' : 'Add photo'}<input accept="image/*" capture="environment" hidden disabled={uploading} type="file" onChange={uploadPhoto} /></label></div><div className="stock-photo-grid">{photos.length === 0 ? <div className="feature-pill">No photos uploaded.</div> : photos.map((photo) => <figure className="stock-photo-card" key={photo.id}>{photo.signed_url ? <img alt={photo.file_name} src={photo.signed_url} /> : <div>Preview unavailable</div>}<figcaption>{photo.file_name}{photo.is_primary ? ' • Primary' : ''}</figcaption></figure>)}</div></section>

        <section className="neo-card"><h2>Stock by location</h2><div className="table-wrap"><table><thead><tr><th>Warehouse</th><th>Branch</th><th>Location</th><th>Items</th><th>Boxes</th><th>Updated</th></tr></thead><tbody>{balances.length === 0 ? <tr><td colSpan={6}>No location balances recorded yet.</td></tr> : balances.map((balance) => { const location = locationMap.get(balance.location_id); const warehouse = location ? warehouseMap.get(location.warehouse_id) : null; return <tr key={balance.id}><td>{warehouse?.warehouse_name ?? '-'}</td><td>{warehouse?.branch.toUpperCase() ?? '-'}</td><td>{location?.location_code ?? '-'}</td><td>{balance.item_quantity}</td><td>{balance.box_quantity}</td><td>{new Date(balance.updated_at).toLocaleString()}</td></tr>; })}</tbody></table></div></section>

        <section className="neo-card"><h2>Movement history</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Movement</th><th>Quantity</th><th>Branch</th><th>From</th><th>To</th><th>Balance</th><th>Notes</th></tr></thead><tbody>{movements.length === 0 ? <tr><td colSpan={8}>No movements recorded.</td></tr> : movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.created_at).toLocaleString()}</td><td><StatusBadge value={movement.movement_type} /></td><td>{movement.quantity} {movement.quantity_unit}</td><td>{movement.branch.toUpperCase()}</td><td>{movement.source_location_id ? locationMap.get(movement.source_location_id)?.location_code ?? '-' : '-'}</td><td>{movement.destination_location_id ? locationMap.get(movement.destination_location_id)?.location_code ?? '-' : '-'}</td><td>{movement.balance_after_items ?? '-'} items / {movement.balance_after_boxes ?? '-'} boxes</td><td>{movement.notes ?? movement.reference_type ?? '-'}</td></tr>)}</tbody></table></div></section>
      </div>}
    </AppShell>
  );
}
