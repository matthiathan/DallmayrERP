'use client';

import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  normaliseTableFilter,
  rowMatchesColumnFilters,
  type EnterpriseColumn,
  type TableColumnFilters,
} from '@/components/ui/EnterpriseDataTable';
import {
  MobileFilterChips,
  MobileFilterSheet,
  MobileRecordList,
  type MobileFilterChip,
} from '@/components/ui/MobileDataViews';
import { TableScrollFrame } from '@/components/ui/TableScrollFrame';
import { useResizableColumns } from '@/components/ui/useResizableColumns';

type RemoteDataTableProps<T> = {
  rows: T[];
  columns: EnterpriseColumn<T>[];
  rowKey: (row: T) => string;
  totalRows: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  search: string;
  searchPlaceholder?: string;
  loading?: boolean;
  emptyMessage?: string;
  actions?: ReactNode;
  filters?: ReactNode;
  tableId?: string;
  columnFilters?: TableColumnFilters;
  mobileFilterChips?: MobileFilterChip[];
  onClearMobileFilters?: () => void;
  onColumnFiltersChange?: (filters: TableColumnFilters) => void;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

function handleColumnResizeKey(
  event: KeyboardEvent<HTMLButtonElement>,
  columnId: string,
  nudgeColumn: (columnId: string, delta: number) => void,
  resetColumn: (columnId: string) => void,
) {
  const step = event.shiftKey ? 64 : 24;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    nudgeColumn(columnId, -step);
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    nudgeColumn(columnId, step);
    return;
  }
  if (event.key === 'Home' || event.key === 'Enter') {
    event.preventDefault();
    resetColumn(columnId);
  }
}

export function RemoteDataTable<T>({
  rows,
  columns,
  rowKey,
  totalRows,
  page,
  pageSize,
  pageSizeOptions = [50, 100, 250, 500],
  search,
  searchPlaceholder = 'Search records',
  loading = false,
  emptyMessage = 'No matching records found.',
  actions,
  filters,
  tableId = 'remote',
  columnFilters,
  mobileFilterChips = [],
  onClearMobileFilters,
  onColumnFiltersChange,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
}: RemoteDataTableProps<T>) {
  const [localColumnFilters, setLocalColumnFilters] = useState<TableColumnFilters>({});
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const effectiveColumnFilters = columnFilters ?? localColumnFilters;
  const hasColumnFilters = Object.values(effectiveColumnFilters).some((value) => normaliseTableFilter(value));
  const visibleRows = useMemo(
    () => rows.filter((row) => rowMatchesColumnFilters(row, columns, effectiveColumnFilters)),
    [columns, effectiveColumnFilters, rows],
  );
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const firstVisible = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min((page - 1) * pageSize + visibleRows.length, totalRows);
  const {
    activeColumnId,
    getColumnWidth,
    nudgeColumn,
    resetColumn,
    resetWidths,
    startResize,
    totalWidth,
  } = useResizableColumns(columns, tableId);

  const updateColumnFilter = useCallback((columnId: string, value: string) => {
    const next = { ...effectiveColumnFilters };
    if (value) next[columnId] = value;
    else delete next[columnId];

    if (onColumnFiltersChange) onColumnFiltersChange(next);
    else setLocalColumnFilters(next);
  }, [effectiveColumnFilters, onColumnFiltersChange]);

  const clearColumnFilters = useCallback(() => {
    if (onColumnFiltersChange) onColumnFiltersChange({});
    else setLocalColumnFilters({});
  }, [onColumnFiltersChange]);

  const closeMobileFilters = useCallback(() => setMobileFiltersOpen(false), []);
  const clearAllMobileFilters = useCallback(() => {
    clearColumnFilters();
    onClearMobileFilters?.();
  }, [clearColumnFilters, onClearMobileFilters]);

  const columnFilterChips = useMemo<MobileFilterChip[]>(() => Object.entries(effectiveColumnFilters)
    .filter(([, value]) => normaliseTableFilter(value))
    .map(([columnId, value]) => {
      const column = columns.find((item) => item.id === columnId);
      return {
        id: `column-${columnId}`,
        label: `${column?.header ?? columnId}: ${value}`,
        onRemove: () => updateColumnFilter(columnId, ''),
      };
    }), [columns, effectiveColumnFilters, updateColumnFilter]);

  const allMobileFilterChips = useMemo(
    () => [...mobileFilterChips, ...columnFilterChips],
    [columnFilterChips, mobileFilterChips],
  );
  const filterableColumns = columns.filter((column) => column.filterable !== false);

  return (
    <section className="enterprise-table-shell remote-table-shell">
      <div className="enterprise-table-toolbar remote-table-toolbar">
        <label className="enterprise-table-search">
          <span className="sr-only">Search table</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
          />
        </label>
        <div className="enterprise-table-count">
          <strong>{totalRows.toLocaleString()}</strong> matching record(s)
        </div>
        {actions ? <div className="enterprise-table-actions">{actions}</div> : null}
        {hasColumnFilters ? <button className="button secondary enterprise-table-desktop-filter-clear" disabled={loading} onClick={clearColumnFilters} type="button">Clear column filters</button> : null}
        <button className="button secondary column-width-reset" onClick={resetWidths} type="button">Reset columns</button>
        <button className="mobile-table-filter-button" disabled={loading} onClick={() => setMobileFiltersOpen(true)} type="button">
          <span>Filters</span><span>{allMobileFilterChips.length}</span>
        </button>
      </div>

      {filters ? <div className="remote-table-filters">{filters}</div> : null}
      <MobileFilterChips chips={allMobileFilterChips} />

      <div className="enterprise-table-desktop-view">
        <TableScrollFrame totalWidth={totalWidth}>
          <table className="resizable-enterprise-table" style={{ minWidth: `${totalWidth}px`, width: `${totalWidth}px` }}>
            <colgroup>
              {columns.map((column) => <col key={column.id} style={{ width: `${getColumnWidth(column.id)}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                {columns.map((column) => {
                  const columnWidth = getColumnWidth(column.id);
                  const filterable = column.filterable !== false;
                  return (
                    <th className={column.className} key={column.id} style={{ width: `${columnWidth}px` }}>
                      <div className="resizable-th-stack">
                        <div className="resizable-th-content">
                          <span className="table-header-label">{column.header}</span>
                        </div>
                        {filterable ? (
                          <input
                            aria-label={`Filter ${column.header} column`}
                            autoComplete="off"
                            className="table-column-filter-input"
                            disabled={loading}
                            onChange={(event) => updateColumnFilter(column.id, event.target.value)}
                            placeholder={column.filterPlaceholder ?? `Filter ${column.header}`}
                            spellCheck={false}
                            type="search"
                            value={effectiveColumnFilters[column.id] ?? ''}
                          />
                        ) : <span aria-hidden="true" className="table-column-filter-spacer" />}
                        <button
                          aria-label={`Resize ${column.header} column. Drag, use arrow keys, or double click to reset.`}
                          className="table-column-resizer"
                          data-active={activeColumnId === column.id ? 'true' : undefined}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            resetColumn(column.id);
                          }}
                          onKeyDown={(event) => handleColumnResizeKey(event, column.id, nudgeColumn, resetColumn)}
                          onPointerDown={(event) => startResize(column.id, event)}
                          title="Drag to resize. Arrow keys resize. Double-click or Enter resets this column."
                          type="button"
                        />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td className="enterprise-table-empty-cell" colSpan={columns.length}>{loading ? 'Loading records...' : emptyMessage}</td></tr>
              ) : visibleRows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => {
                    const columnWidth = getColumnWidth(column.id);
                    return <td className={column.className} key={column.id} style={{ width: `${columnWidth}px` }}>{column.render ? column.render(row) : column.value(row) ?? '-'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollFrame>
      </div>

      <MobileRecordList columns={columns} emptyMessage={emptyMessage} loading={loading} rowKey={rowKey} rows={visibleRows} />

      <MobileFilterSheet activeCount={allMobileFilterChips.length} onClear={clearAllMobileFilters} onClose={closeMobileFilters} open={mobileFiltersOpen} title="Filter records">
        {filters ? (
          <section className="mobile-filter-group">
            <h3>Quick filters</h3>
            <div className="mobile-filter-field-grid">{filters}</div>
          </section>
        ) : null}

        <section className="mobile-filter-group">
          <h3>Column filters</h3>
          <div className="mobile-filter-column-grid">
            {filterableColumns.map((column) => (
              <label key={column.id}>{column.header}
                <input
                  autoComplete="off"
                  disabled={loading}
                  onChange={(event) => updateColumnFilter(column.id, event.target.value)}
                  placeholder={column.filterPlaceholder ?? `Contains ${column.header.toLowerCase()}`}
                  spellCheck={false}
                  type="search"
                  value={effectiveColumnFilters[column.id] ?? ''}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="mobile-filter-group">
          <h3>Records per page</h3>
          <label>Rows
            <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
              {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </section>
      </MobileFilterSheet>

      <div className="enterprise-table-pagination">
        <div>{loading ? 'Refreshing...' : `Showing ${firstVisible.toLocaleString()}-${lastVisible.toLocaleString()} of ${totalRows.toLocaleString()}`}</div>
        <label>Rows
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="enterprise-pagination-buttons">
          <button className="button secondary" disabled={page <= 1 || loading} onClick={() => onPageChange(1)} type="button">First</button>
          <button className="button secondary" disabled={page <= 1 || loading} onClick={() => onPageChange(Math.max(1, page - 1))} type="button">Previous</button>
          <span>Page {page.toLocaleString()} of {pageCount.toLocaleString()}</span>
          <button className="button secondary" disabled={page >= pageCount || loading} onClick={() => onPageChange(Math.min(pageCount, page + 1))} type="button">Next</button>
          <button className="button secondary" disabled={page >= pageCount || loading} onClick={() => onPageChange(pageCount)} type="button">Last</button>
        </div>
      </div>
    </section>
  );
}

export default RemoteDataTable;
