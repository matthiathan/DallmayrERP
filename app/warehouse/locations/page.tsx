'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type Warehouse = { id: string; branch: Branch; warehouse_name: string; address: string | null; status: string };
type Location = { id: string; warehouse_id: string; location_code: string; description: string | null; status: string };
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

export default function WarehouseLocationsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [branch, setBranch] = useState<Branch>('jhb');
  const [warehouseName, setWarehouseName] = useState('');
  const [address, setAddress] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadData() {
    const client = getSupabaseClient();
    const [warehouseResult, locationResult] = await Promise.all([
      client.from('warehouses').select('id, branch, warehouse_name, address, status').order('warehouse_name'),
      client.from('stock_locations').select('id, warehouse_id, location_code, description, status').order('location_code'),
    ]);
    const firstError = warehouseResult.error ?? locationResult.error;
    if (firstError) throw firstError;
    setWarehouses((warehouseResult.data ?? []) as Warehouse[]);
    setLocations((locationResult.data ?? []) as Location[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load locations.'));
  }, []);

  const warehouseMap = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);

  async function createWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: createError } = await getSupabaseClient().from('warehouses').insert({ branch, warehouse_name: warehouseName.trim(), address: address.trim() || null, status: 'active' });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage('Warehouse created.');
    setWarehouseName('');
    setAddress('');
    await loadData();
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: createError } = await getSupabaseClient().from('stock_locations').insert({ warehouse_id: selectedWarehouseId, location_code: locationCode.trim().toUpperCase(), description: description.trim() || null, status: 'active' });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage('Stock location created.');
    setLocationCode('');
    setDescription('');
    await loadData();
  }

  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card"><div><div className="badge">Warehouse setup</div><h1>Warehouses & Locations</h1><p>Create branches, stockrooms, shelves, cages, bins and receiving areas used by scanning and transfers.</p></div></div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="grid grid-2">
        <section className="neo-card"><h2>Create warehouse</h2><form className="grid" onSubmit={createWarehouse}><div className="form-grid"><label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label><label>Warehouse name<input required value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} /></label></div><label>Address<input value={address} onChange={(event) => setAddress(event.target.value)} /></label><button className="button" disabled={saving || !warehouseName.trim()} type="submit">Create warehouse</button></form></section>
        <section className="neo-card"><h2>Create bin / location</h2><form className="grid" onSubmit={createLocation}><label>Warehouse<select required value={selectedWarehouseId} onChange={(event) => setSelectedWarehouseId(event.target.value)}><option value="">Select warehouse</option>{warehouses.filter((warehouse) => warehouse.status === 'active').map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.warehouse_name} — {warehouse.branch.toUpperCase()}</option>)}</select></label><div className="form-grid"><label>Location code<input required placeholder="A-01-03" value={locationCode} onChange={(event) => setLocationCode(event.target.value)} /></label><label>Description<input placeholder="Shelf, cage, receiving bay..." value={description} onChange={(event) => setDescription(event.target.value)} /></label></div><button className="button" disabled={saving || !selectedWarehouseId || !locationCode.trim()} type="submit">Create location</button></form></section>
      </div>
      <PageToolbar actions={<button className="button secondary" onClick={() => loadData().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh</button>} description="Active storage locations used by receipts, transfers and cycle counts." lastUpdated={lastUpdated} title="Location register" />
      <div className="table-wrap"><table><thead><tr><th>Warehouse</th><th>Branch</th><th>Location</th><th>Description</th><th>Status</th></tr></thead><tbody>{locations.length === 0 ? <tr><td colSpan={5}>No locations found.</td></tr> : locations.map((location) => { const warehouse = warehouseMap.get(location.warehouse_id); return <tr key={location.id}><td>{warehouse?.warehouse_name ?? 'Unknown warehouse'}</td><td>{warehouse?.branch.toUpperCase() ?? '-'}</td><td><strong>{location.location_code}</strong></td><td>{location.description ?? '-'}</td><td><StatusBadge value={location.status} /></td></tr>; })}</tbody></table></div>
    </AppShell>
  );
}
