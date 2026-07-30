'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  CUSTOMER_BOARD_COLUMNS,
  type CustomerColumnId,
  type CustomerGroupBy,
  type CustomerSortDirection,
} from '@/components/boards/CustomerBoardTable';
import { downloadCsv, toCsv } from '@/lib/data/export';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CustomerRecord } from '@/types/enterprise-records';

export const CUSTOMER_BRANCHES = ['all', 'jhb', 'cpt', 'kzn', 'national'] as const;
export const CUSTOMER_STATUSES = ['all', 'active', 'inactive', 'unknown'] as const;
const DEFAULT_HIDDEN_COLUMNS: CustomerColumnId[] = ['email', 'address'];

export type CustomerBranchFilter = (typeof CUSTOMER_BRANCHES)[number];
export type CustomerStatusFilter = (typeof CUSTOMER_STATUSES)[number];
export type CustomerColumnFilters = Partial<Record<CustomerColumnId, string>>;

export type CustomerBoardView = {
  id: string;
  name: string;
  search: string;
  branch: CustomerBranchFilter;
  status: CustomerStatusFilter;
  columnFilters: CustomerColumnFilters;
  groupBy: CustomerGroupBy;
  sortColumn: CustomerColumnId;
  sortDirection: CustomerSortDirection;
  hiddenColumns: CustomerColumnId[];
  builtIn?: boolean;
};

const sortColumnMap: Record<CustomerColumnId, string> = {
  name: 'customer_name',
  code: 'customer_code',
  branch: 'branch',
  status: 'status',
  phone: 'phone',
  email: 'email',
  address: 'address',
};

function normaliseSearch(value: string) {
  return value.trim().replace(/[,()]/g, ' ');
}

function containsPattern(value: string | undefined) {
  const clean = normaliseSearch(value ?? '').replace(/[%_\\]/g, '');
  return clean ? `%${clean}%` : null;
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeReadViews(key: string): CustomerBoardView[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((view): view is CustomerBoardView => Boolean(view && typeof view.id === 'string' && typeof view.name === 'string'));
  } catch {
    return [];
  }
}

function safeWriteViews(key: string, views: CustomerBoardView[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(views));
  } catch {
    // Saved views remain available in memory when browser storage is restricted.
  }
}

export function useCustomerBoard() {
  const querySearch = useClientQueryParam('q');
  const customerSearch = useClientQueryParam('customer');
  const initialSearch = querySearch || customerSearch || '';
  const { authUser, businessUser, userDetails } = useAuth();

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [columnFilters, setColumnFilters] = useState<CustomerColumnFilters>({});
  const [branch, setBranch] = useState<CustomerBranchFilter>('all');
  const [status, setStatus] = useState<CustomerStatusFilter>('all');
  const [groupBy, setGroupBy] = useState<CustomerGroupBy>('none');
  const [sortColumn, setSortColumn] = useState<CustomerColumnId>('name');
  const [sortDirection, setSortDirection] = useState<CustomerSortDirection>('asc');
  const [hiddenColumns, setHiddenColumns] = useState<CustomerColumnId[]>(DEFAULT_HIDDEN_COLUMNS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [customViews, setCustomViews] = useState<CustomerBoardView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>('main');
  const requestSequenceRef = useRef(0);

  const currentUserKey = businessUser?.id ?? authUser?.id ?? 'signed-out';
  const storageKey = `dallmayrerp-customer-board-views-v1-${currentUserKey}`;
  const rawProfileBranch = (userDetails?.branch ?? 'all') as CustomerBranchFilter;
  const profileBranch = CUSTOMER_BRANCHES.includes(rawProfileBranch) ? rawProfileBranch : 'all';

  const builtInViews = useMemo<CustomerBoardView[]>(() => [
    { id: 'main', name: 'Main table', search: '', branch: 'all', status: 'all', columnFilters: {}, groupBy: 'none', sortColumn: 'name', sortDirection: 'asc', hiddenColumns: DEFAULT_HIDDEN_COLUMNS, builtIn: true },
    { id: 'active', name: 'Active accounts', search: '', branch: 'all', status: 'active', columnFilters: {}, groupBy: 'none', sortColumn: 'name', sortDirection: 'asc', hiddenColumns: DEFAULT_HIDDEN_COLUMNS, builtIn: true },
    { id: 'my-branch', name: profileBranch === 'all' ? 'All branches' : `My branch · ${profileBranch.toUpperCase()}`, search: '', branch: profileBranch, status: 'all', columnFilters: {}, groupBy: 'none', sortColumn: 'name', sortDirection: 'asc', hiddenColumns: DEFAULT_HIDDEN_COLUMNS, builtIn: true },
    { id: 'by-branch', name: 'By branch', search: '', branch: 'all', status: 'all', columnFilters: {}, groupBy: 'branch', sortColumn: 'name', sortDirection: 'asc', hiddenColumns: DEFAULT_HIDDEN_COLUMNS, builtIn: true },
    { id: 'by-status', name: 'By status', search: '', branch: 'all', status: 'all', columnFilters: {}, groupBy: 'status', sortColumn: 'name', sortDirection: 'asc', hiddenColumns: DEFAULT_HIDDEN_COLUMNS, builtIn: true },
  ], [profileBranch]);

  const allViews = useMemo(() => [...builtInViews, ...customViews], [builtInViews, customViews]);
  const currentCustomView = activeViewId ? customViews.find((view) => view.id === activeViewId) ?? null : null;
  const visibleColumnIds = useMemo(
    () => CUSTOMER_BOARD_COLUMNS.map((column) => column.id).filter((columnId) => !hiddenColumns.includes(columnId)),
    [hiddenColumns],
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; clear: () => void }> = [];
    if (branch !== 'all') chips.push({ id: 'branch', label: `Branch: ${branch.toUpperCase()}`, clear: () => { setBranch('all'); setPage(1); setActiveViewId(null); } });
    if (status !== 'all') chips.push({ id: 'status', label: `Status: ${status}`, clear: () => { setStatus('all'); setPage(1); setActiveViewId(null); } });
    Object.entries(columnFilters).forEach(([columnId, value]) => {
      if (!value?.trim()) return;
      const column = CUSTOMER_BOARD_COLUMNS.find((item) => item.id === columnId);
      chips.push({
        id: `column-${columnId}`,
        label: `${column?.label ?? columnId}: ${value}`,
        clear: () => {
          setColumnFilters((current) => {
            const next = { ...current };
            delete next[columnId as CustomerColumnId];
            return next;
          });
          setPage(1);
          setActiveViewId(null);
        },
      });
    });
    return chips;
  }, [branch, columnFilters, status]);

  async function loadCustomers() {
    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);

    try {
      const client = getSupabaseClient();
      const offset = (page - 1) * pageSize;
      let query = client
        .from('customers')
        .select('id, customer_name, customer_code, branch, phone, email, address, status', { count: 'exact' })
        .range(offset, offset + pageSize - 1);

      if (branch !== 'all') query = query.eq('branch', branch);
      if (status !== 'all') query = query.eq('status', status);

      const cleanSearch = normaliseSearch(search);
      if (cleanSearch) {
        const pattern = `%${cleanSearch}%`;
        query = query.or([
          `customer_name.ilike.${pattern}`,
          `customer_code.ilike.${pattern}`,
          `phone.ilike.${pattern}`,
          `email.ilike.${pattern}`,
          `address.ilike.${pattern}`,
        ].join(','));
      }

      const filters: Array<[CustomerColumnId, string]> = [
        ['name', 'customer_name'], ['code', 'customer_code'], ['branch', 'branch'], ['status', 'status'],
        ['phone', 'phone'], ['email', 'email'], ['address', 'address'],
      ];
      filters.forEach(([columnId, databaseColumn]) => {
        const pattern = containsPattern(columnFilters[columnId]);
        if (pattern) query = query.ilike(databaseColumn, pattern);
      });

      const groupColumn = groupBy === 'branch' ? 'branch' : groupBy === 'status' ? 'status' : null;
      const sortDatabaseColumn = sortColumnMap[sortColumn];
      if (groupColumn && groupColumn !== sortDatabaseColumn) query = query.order(groupColumn, { ascending: true, nullsFirst: false });
      query = query.order(sortDatabaseColumn, { ascending: sortDirection === 'asc', nullsFirst: false });
      if (sortDatabaseColumn !== 'customer_name') query = query.order('customer_name', { ascending: true });

      const { data, count, error: loadError } = await query;
      if (requestId !== requestSequenceRef.current) return;
      if (loadError) throw loadError;

      const nextRows = (data ?? []) as CustomerRecord[];
      setCustomers(nextRows);
      setTotalRows(count ?? 0);
      setSelectedIds((current) => new Set(Array.from(current).filter((id) => nextRows.some((row) => row.id === id))));
      setLastUpdated(new Date());
    } catch (loadError) {
      if (requestId === requestSequenceRef.current) setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => { loadCustomers().catch(() => undefined); }, 220);
    return () => window.clearTimeout(handle);
  }, [search, columnFilters, branch, status, groupBy, sortColumn, sortDirection, page, pageSize]);

  useEffect(() => {
    setSearch(initialSearch);
    if (initialSearch) {
      setPage(1);
      setActiveViewId(null);
    }
  }, [initialSearch]);

  useEffect(() => {
    setCustomViews(safeReadViews(storageKey));
  }, [storageKey]);

  function applyView(viewId: string) {
    const view = allViews.find((item) => item.id === viewId);
    if (!view) return;
    setSearch(view.search);
    setBranch(view.branch);
    setStatus(view.status);
    setColumnFilters({ ...view.columnFilters });
    setGroupBy(view.groupBy);
    setSortColumn(view.sortColumn);
    setSortDirection(view.sortDirection);
    setHiddenColumns([...view.hiddenColumns]);
    setSelectedIds(new Set());
    setPage(1);
    setActiveViewId(view.id);
  }

  function clearAllFilters() {
    setSearch('');
    setBranch('all');
    setStatus('all');
    setColumnFilters({});
    setPage(1);
    setActiveViewId(null);
  }

  function updateColumnFilter(columnId: CustomerColumnId, value: string) {
    setColumnFilters((current) => ({ ...current, [columnId]: value }));
    setPage(1);
    setActiveViewId(null);
  }

  function toggleColumn(columnId: CustomerColumnId) {
    if (columnId === 'name') return;
    setHiddenColumns((current) => current.includes(columnId) ? current.filter((item) => item !== columnId) : [...current, columnId]);
    setActiveViewId(null);
  }

  function handleSort(columnId: CustomerColumnId) {
    if (sortColumn === columnId) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
    setPage(1);
    setActiveViewId(null);
  }

  function saveCurrentView() {
    const name = saveViewName.trim();
    if (!name) return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `view-${Date.now()}`;
    const nextView: CustomerBoardView = { id, name, search, branch, status, columnFilters: { ...columnFilters }, groupBy, sortColumn, sortDirection, hiddenColumns: [...hiddenColumns] };
    const nextViews = [...customViews, nextView];
    setCustomViews(nextViews);
    safeWriteViews(storageKey, nextViews);
    setActiveViewId(id);
    setSaveViewName('');
    setSaveViewOpen(false);
  }

  function deleteCurrentView() {
    if (!currentCustomView) return;
    const nextViews = customViews.filter((view) => view.id !== currentCustomView.id);
    setCustomViews(nextViews);
    safeWriteViews(storageKey, nextViews);
    setActiveViewId(null);
  }

  function exportRows() {
    const selectedRows = customers.filter((row) => selectedIds.has(row.id));
    const rowsToExport = selectedRows.length > 0 ? selectedRows : customers;
    const csv = toCsv(rowsToExport.map((row) => ({
      customer: row.customer_name,
      account_code: row.customer_code,
      branch: row.branch,
      status: row.status,
      phone: row.phone,
      email: row.email,
      address: row.address,
    })), ['customer', 'account_code', 'branch', 'status', 'phone', 'email', 'address']);
    downloadCsv(`customers-${selectedRows.length > 0 ? 'selected' : 'visible'}-${formatLocalDate()}.csv`, csv);
  }

  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const firstVisible = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min((page - 1) * pageSize + customers.length, totalRows);
  const selectedCount = selectedIds.size;
  const activeViewLabel = allViews.find((view) => view.id === activeViewId)?.name ?? 'Current view';

  function changePage(nextPage: number) {
    setPage(Math.min(pageCount, Math.max(1, nextPage)));
    setSelectedIds(new Set());
  }

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(1);
    setSelectedIds(new Set());
  }

  return {
    customers, search, setSearch, columnFilters, branch, setBranch, status, setStatus,
    groupBy, setGroupBy, sortColumn, sortDirection, hiddenColumns, selectedIds, setSelectedIds,
    page, pageSize, totalRows, loading, lastUpdated, error, filtersOpen, setFiltersOpen,
    saveViewOpen, setSaveViewOpen, saveViewName, setSaveViewName, customViews, activeViewId,
    setActiveViewId, builtInViews, allViews, currentCustomView, visibleColumnIds, activeFilterChips,
    loadCustomers, applyView, clearAllFilters, updateColumnFilter, toggleColumn, handleSort,
    saveCurrentView, deleteCurrentView, exportRows, pageCount, firstVisible, lastVisible,
    selectedCount, activeViewLabel, changePage, changePageSize,
  };
}

export type CustomerBoardController = ReturnType<typeof useCustomerBoard>;
