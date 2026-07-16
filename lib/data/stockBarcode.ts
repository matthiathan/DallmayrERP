import { getSupabaseClient } from '@/lib/supabase/client';

export type ResolvedStockBarcode = {
  id: string;
  stock_name: string;
  item_barcode: string;
  box_barcode: string | null;
  matched_unit: 'item' | 'box';
  item_quantity: number;
  box_quantity: number;
  items_per_box: number | null;
  reorder_level: number;
  warehouse_location: string | null;
  default_location_id: string | null;
  unit_cost: number | null;
};

export async function resolveStockBarcode(barcode: string): Promise<ResolvedStockBarcode | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;

  const { data, error } = await getSupabaseClient().rpc('resolve_stock_barcode', { p_barcode: cleanBarcode });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const matchedUnit = row.matched_unit === 'box' ? 'box' : 'item';
  return {
    id: row.id,
    stock_name: row.stock_name,
    item_barcode: row.item_barcode,
    box_barcode: row.box_barcode,
    matched_unit: matchedUnit,
    item_quantity: Number(row.item_quantity ?? 0),
    box_quantity: Number(row.box_quantity ?? 0),
    items_per_box: row.items_per_box === null ? null : Number(row.items_per_box),
    reorder_level: Number(row.reorder_level ?? 0),
    warehouse_location: row.warehouse_location,
    default_location_id: row.default_location_id,
    unit_cost: row.unit_cost === null ? null : Number(row.unit_cost),
  };
}
