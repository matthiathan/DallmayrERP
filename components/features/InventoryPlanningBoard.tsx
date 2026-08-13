'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

type BranchFilter = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';
type ExceptionFilter = 'all' | 'stockout' | 'stockout_risk' | 'below_reorder' | 'excess_stock' | 'obsolete_stock' | 'no_recent_demand' | 'non_stock_holding' | 'healthy' | 'not_tracked';
type AbcFilter = 'all' | 'A' | 'B' | 'C';

type Breakdown = {
  abc_class?: string;
  exception_type?: string;
  item_count?: number;
};

type InventorySummary = {
  item_locations?: number;
  stockout_count?: number;
  below_reorder_count?: number;
  stockout_risk_count?: number;
  excess_stock_count?: number;
  obsolete_stock_count?: number;
  no_recent_demand_count?: number;
  healthy_count?: number;
  recommended_order_units?: number;
  recommended_order_value?: number | string;
  stock_value?: number | string;
  abc_breakdown?: Breakdown[];
  exception_breakdown?: Breakdown[];
};

type InventoryRecommendation = {
  stock_item_id: string;
  stock_name: string | null;
  sku: string | null;
  category: string | null;
  supplier_name: string | null;
  branch: string;
  current_quantity: number;
  reorder_level: number;
  min_stock: number;
  max_stock: number | null;
  safety_stock_days: number;
  target_stock_days: number;
  lead_time_days: number;
  abc_class: 'A' | 'B' | 'C';
  criticality: string;
  stocking_policy: string;
  avg_daily_demand: number | string;
  days_on_hand: number | string | null;
  target_stock: number;
  recommended_order_quantity: number;
  projected_stockout_date: string | null;
  exception_type: string;
  exception_reason: string;
  unit_cost: number | string;
  stock_value: number | string;
  recommended_order_value: number | string;
  total_count: number;
};

type TransferSuggestion = {
  stock_item_id: string;
  stock_name: string | null;
  sku: string | null;
  category: string | null;
  source_branch: string;
  destination_branch: string;
  source_quantity: number;
  destination_quantity: number;
  destination_recommended_order: number;
  transferable_quantity: number;
  reason: string;
  total_count: number;
};

const branches: BranchFilter[] = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const exceptionFilters: ExceptionFilter[] = ['all', 'stockout', 'stockout_risk', 'below_reorder', 'excess_stock', 'obsolete_stock', 'no_recent_demand', 'non_stock_holding', 'healthy', 'not_tracked'];
const abcFilters: AbcFilter[] = ['all', 'A', 'B', 'C'];

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(asNumber(value));
}

function labelize(value: string) {
  if (value === 'all') return 'All';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function InventoryPlanningBoard() {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [rows, setRows] = useState<InventoryRecommendation[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [transfers, setTransfers] = useState<TransferSuggestion[]>([]);
  const [transferTotal, setTransferTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState<BranchFilter>('all');
  const [exceptionType, setExceptionType] = useState<ExceptionFilter>('all');
  const [abcClass, setAbcClass] = useState<AbcFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [transferPage, setTransferPage] = useState(1);
  const [transferPageSize, setTransferPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPlanning() {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [summaryResult, recommendationResult, transferResult] = await Promise.all([
      client.rpc('get_inventory_planning_summary', { p_branch: branch }),
      client.rpc('search_inventory_recommendations', {
        p_search: search.trim() || null,
        p_branch: branch,
        p_exception: exceptionType,
        p_abc_class: abcClass,
        p_offset: (page - 1) * pageSize,
        p_limit: pageSize,
      }),
      client.rpc('search_inventory_transfer_suggestions', {
        p_branch: branch,
        p_offset: (transferPage - 1) * transferPageSize,
        p_limit: transferPageSize,
      }),
    ]);

    const firstError = summaryResult.error ?? recommendationResult.error ?? transferResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const recommendationRows = (recommendationResult.data ?? []) as InventoryRecommendation[];
    const transferRows = (transferResult.data ?? []) as TransferSuggestion[];
    setSummary((summaryResult.data ?? {}) as InventorySummary);
    setRows(recommendationRows);
    setTotalRows(recommendationRows[0]?.total_count ?? 0);
    setTransfers(transferRows);
    setTransferTotal(transferRows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadPlanning().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load inventory planning.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, branch, exceptionType, abcClass, page, pageSize, transferPage, transferPageSize]);

  function resetRecommendations(setter: () => void) {
    setter();
    setPage(1);
    setTransferPage(1);
  }

  function exportVisibleRows() {
    const header = ['Branch', 'Item', 'SKU', 'Category', 'ABC', 'Criticality', 'Policy', 'Exception', 'Current', 'Min', 'Max', 'Avg daily demand', 'Days on hand', 'Lead time days', 'Recommended order', 'Supplier', 'Stock value', 'Recommended order value', 'Reason'];
    const body = rows.map((row) => [
      row.branch.toUpperCase(),
      row.stock_name,
      row.sku,
      row.category,
      row.abc_class,
      row.criticality,
      row.stocking_policy,
      row.exception_type,
      row.current_quantity,
      row.min_stock,
      row.max_stock,
      row.avg_daily_demand,
      row.days_on_hand,
      row.lead_time_days,
      row.recommended_order_quantity,
      row.supplier_name,
      row.stock_value,
      row.recommended_order_value,
      row.exception_reason,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory-planning-${branch}-${formatLocalDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const recommendationColumns = useMemo<EnterpriseColumn<InventoryRecommendation>[]>(() => [
    { id: 'item', header: 'Item', value: (row) => row.stock_name ?? '', render: (row) => <Link href={`/warehouse/stock/${row.stock_item_id}`}><strong>{row.stock_name ?? 'Unnamed stock item'}</strong><small>{row.sku ?? row.category ?? 'No SKU/category'}</small></Link> },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'classification', header: 'Class', value: (row) => `${row.abc_class} ${row.criticality}`, render: (row) => <span><StatusBadge value={`Class ${row.abc_class}`} /><small>{labelize(row.criticality)} • {labelize(row.stocking_policy)}</small></span> },
    { id: 'exception', header: 'Exception', value: (row) => row.exception_type, render: (row) => <span><StatusBadge value={labelize(row.exception_type)} /><small>{row.exception_reason}</small></span> },
    { id: 'stock', header: 'Stock', value: (row) => row.current_quantity, render: (row) => <span><strong>{row.current_quantity.toLocaleString()}</strong><small>Min {row.min_stock.toLocaleString()} • Target {row.target_stock.toLocaleString()}</small></span> },
    { id: 'forecast', header: 'Forecast', value: (row) => asNumber(row.days_on_hand), render: (row) => <span>{row.days_on_hand === null ? 'No recent demand' : `${asNumber(row.days_on_hand).toLocaleString()} day(s)`}<small>Lead {row.lead_time_days}d • Avg {asNumber(row.avg_daily_demand).toLocaleString()}/day</small></span> },
    { id: 'recommend', header: 'Recommended order', value: (row) => row.recommended_order_quantity, render: (row) => <span><strong>{row.recommended_order_quantity.toLocaleString()}</strong><small>{formatCurrency(row.recommended_order_value)}</small></span> },
    { id: 'supplier', header: 'Supplier', value: (row) => row.supplier_name ?? '' },
    { id: 'value', header: 'Stock value', value: (row) => asNumber(row.stock_value), render: (row) => formatCurrency(row.stock_value) },
  ], []);

  const transferColumns = useMemo<EnterpriseColumn<TransferSuggestion>[]>(() => [
    { id: 'item', header: 'Item', value: (row) => row.stock_name ?? '', render: (row) => <Link href={`/warehouse/stock/${row.stock_item_id}`}><strong>{row.stock_name ?? 'Unnamed stock item'}</strong><small>{row.sku ?? row.category ?? 'No SKU/category'}</small></Link> },
    { id: 'source', header: 'From', value: (row) => row.source_branch.toUpperCase(), render: (row) => <span><strong>{row.source_branch.toUpperCase()}</strong><small>{row.source_quantity.toLocaleString()} on hand</small></span> },
    { id: 'destination', header: 'To', value: (row) => row.destination_branch.toUpperCase(), render: (row) => <span><strong>{row.destination_branch.toUpperCase()}</strong><small>{row.destination_quantity.toLocaleString()} on hand • Needs {row.destination_recommended_order.toLocaleString()}</small></span> },
    { id: 'quantity', header: 'Transfer qty', value: (row) => row.transferable_quantity, render: (row) => <strong>{row.transferable_quantity.toLocaleString()}</strong> },
    { id: 'reason', header: 'Reason', value: (row) => row.reason },
  ], []);

  const immediateRisk = asNumber(summary?.stockout_count) + asNumber(summary?.below_reorder_count) + asNumber(summary?.stockout_risk_count);

  return (
    <div className="grid professional-ops-stage">
      {error ? <div className="error">{error}</div> : null}

      <div className="grid grid-4">
        <KpiCard label="Planning exceptions" value={immediateRisk.toLocaleString()} helper="Stockouts, stockout risks and below-reorder items." />
        <KpiCard label="Recommended orders" value={asNumber(summary?.recommended_order_units).toLocaleString()} helper={formatCurrency(summary?.recommended_order_value)} />
        <KpiCard label="Excess / obsolete" value={`${asNumber(summary?.excess_stock_count).toLocaleString()}/${asNumber(summary?.obsolete_stock_count).toLocaleString()}`} helper="Excess stock and obsolete stock holding." />
        <KpiCard label="Inventory value" value={formatCurrency(summary?.stock_value)} helper={`${asNumber(summary?.item_locations).toLocaleString()} item/location records`} />
      </div>

      <PageToolbar
        actions={<><button className="button secondary" disabled={loading} onClick={loadPlanning} type="button">{loading ? 'Refreshing...' : 'Refresh planning'}</button><button className="button secondary" disabled={rows.length === 0} onClick={exportVisibleRows} type="button">Export visible CSV</button></>}
        description="Exception-based inventory planning: calculate risk, recommend action, and prioritise reorder or transfer decisions before buying stock."
        lastUpdated={lastUpdated}
        title="Inventory planning controls"
      />

      <div className="neo-card">
        <div className="form-grid">
          <label>Branch<select value={branch} onChange={(event) => resetRecommendations(() => setBranch(event.target.value as BranchFilter))}>{branches.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>Exception<select value={exceptionType} onChange={(event) => resetRecommendations(() => setExceptionType(event.target.value as ExceptionFilter))}>{exceptionFilters.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
          <label>ABC class<select value={abcClass} onChange={(event) => resetRecommendations(() => setAbcClass(event.target.value as AbcFilter))}>{abcFilters.map((item) => <option key={item} value={item}>{item === 'all' ? 'All classes' : `Class ${item}`}</option>)}</select></label>
        </div>
        <div className="feature-list" style={{ marginTop: 16 }}>
          {(summary?.exception_breakdown ?? []).map((item) => (
            <button className="feature-pill" key={item.exception_type} onClick={() => resetRecommendations(() => setExceptionType((item.exception_type ?? 'all') as ExceptionFilter))} type="button">
              {labelize(item.exception_type ?? 'unknown')}: {asNumber(item.item_count).toLocaleString()}
            </button>
          ))}
          {(summary?.abc_breakdown ?? []).map((item) => (
            <button className="feature-pill" key={item.abc_class} onClick={() => resetRecommendations(() => setAbcClass((item.abc_class ?? 'all') as AbcFilter))} type="button">
              Class {item.abc_class}: {asNumber(item.item_count).toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <RemoteDataTable
        columns={recommendationColumns}
        emptyMessage="No inventory planning records match this filter."
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => `${row.stock_item_id}-${row.branch}`}
        rows={rows}
        search={search}
        searchPlaceholder="Search item, SKU, category, supplier or exception"
        totalRows={totalRows}
      />

      <PageToolbar
        description="Suggested branch transfers use surplus before purchasing new stock. This list appears when one branch has an exception and another branch has usable surplus."
        title="Branch redistribution suggestions"
      />
      <RemoteDataTable
        columns={transferColumns}
        emptyMessage="No branch transfer suggestions are available for the current data."
        loading={loading}
        onPageChange={setTransferPage}
        onPageSizeChange={(value) => { setTransferPageSize(value); setTransferPage(1); }}
        onSearchChange={() => undefined}
        page={transferPage}
        pageSize={transferPageSize}
        rowKey={(row) => `${row.stock_item_id}-${row.source_branch}-${row.destination_branch}`}
        rows={transfers}
        search=""
        searchPlaceholder="Transfer search is driven by the planning filters above"
        totalRows={transferTotal}
      />
    </div>
  );
}

export default InventoryPlanningBoard;
