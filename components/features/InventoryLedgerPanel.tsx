'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import { recordAuditEvent } from '@/lib/data/audit';
import type { Branch } from '@/types/dallmayrerp';

type MovementType = 'received' | 'adjusted' | 'reserved' | 'picked' | 'dispatched' | 'returned' | 'transferred';
type StockOption = { id: string; stock_name: string; item_barcode: string };
type StockRelation = { stock_name: string | null };
type MovementRow = {
  id: string;
  branch: Branch;
  movement_type: MovementType;
  quantity: number;
  notes: string | null;
  created_at: string;
  stock_items?: StockRelation | StockRelation[] | null;
};

const movementTypes: MovementType[] = ['received', 'adjusted', 'reserved', 'picked', 'dispatched', 'returned', 'transferred'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

function getMovementStockName(row: MovementRow) {
  const relation = row.stock_items;
  if (Array.isArray(relation)) return relation[0]?.stock_name ?? 'Unlinked';
  return relation?.stock_name ?? 'Unlinked';
}

export function InventoryLedgerPanel() {
  const { businessUser, userDetails } = useAuth();
  const [stockItems, setStockItems] = useState<StockOption[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [stockItemId, setStockItemId] = useState('');
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [movementType, setMovementType] = useState<MovementType>('received');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadLedger() {
    const client = getSupabaseClient();
    const [{ data: stock, error: stockError }, { data: ledger, error: ledgerError }] = await Promise.all([
      client.from('stock_items').select('id, stock_name, item_barcode').order('stock_name').limit(250),
      client.from('inventory_movements').select('id, branch, movement_type, quantity, notes, created_at, stock_items(stock_name)').order('created_at', { ascending: false }).limit(80),
    ]);

    if (stockError || ledgerError) {
      throw stockError ?? ledgerError ?? new Error('Could not load inventory ledger.');
    }

    setStockItems((stock ?? []) as StockOption[]);
    setMovements((ledger ?? []) as MovementRow[]);
  }

  useEffect(() => {
    loadLedger().catch((err) => setError(err instanceof Error ? err.message : 'Could not load inventory ledger.'));
  }, []);

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const signedQuantity = ['picked', 'dispatched'].includes(movementType) ? -Math.abs(quantity) : quantity;
    const client = getSupabaseClient();
    const { data, error: insertError } = await client.from('inventory_movements').insert({
      stock_item_id: stockItemId || null,
      branch,
      movement_type: movementType,
      quantity: signedQuantity,
      notes: notes.trim() || null,
      created_by: businessUser.id,
    }).select('id').single();

    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch,
      entityType: 'inventory',
      entityId: data.id,
      action: 'inventory_movement_created',
      summary: `${movementType} movement recorded for quantity ${signedQuantity}.`,
      afterPayload: { stock_item_id: stockItemId || null, movement_type: movementType, quantity: signedQuantity, notes },
    });

    setMessage('Inventory movement recorded in the enterprise ledger.');
    setNotes('');
    setQuantity(1);
    await loadLedger();
  }

  return (
    <div className="grid">
      <div className="neo-card spatial-card">
        <h2>Inventory movement ledger</h2>
        <p>Append-only enterprise stock movements. Use this for received, picked, dispatched, returned and adjusted stock evidence.</p>
        {error ? <div className="error">{error}</div> : null}
        {message ? <div className="success">{message}</div> : null}
        <form className="grid" onSubmit={addMovement}>
          <div className="form-grid">
            <label>Stock item
              <select value={stockItemId} onChange={(event) => setStockItemId(event.target.value)}>
                <option value="">Unlinked movement</option>
                {stockItems.map((item) => <option key={item.id} value={item.id}>{item.stock_name} ({item.item_barcode})</option>)}
              </select>
            </label>
            <label>Branch
              <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
                {branches.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Movement
              <select value={movementType} onChange={(event) => setMovementType(event.target.value as MovementType)}>
                {movementTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div style={{ alignSelf: 'end' }}><button className="button pulse-button" disabled={saving || quantity < 1} type="submit">{saving ? 'Recording...' : 'Record movement'}</button></div>
          </div>
        </form>
      </div>
      <div className="table-wrap">
        <table><thead><tr><th>Time</th><th>Stock</th><th>Branch</th><th>Movement</th><th>Qty</th><th>Notes</th></tr></thead>
          <tbody>{movements.length === 0 ? <tr><td colSpan={6}>No inventory movements yet.</td></tr> : movements.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{getMovementStockName(row)}</td><td>{row.branch}</td><td>{row.movement_type}</td><td>{row.quantity}</td><td>{row.notes ?? '-'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
