'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { TableScrollFrame } from '@/components/ui/TableScrollFrame';
import { useResizableColumns } from '@/components/ui/useResizableColumns';

export type TableColumnFilters = Record<string, string>;

export type EnterpriseColumn<T> = {
  id: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  filterPlaceholder?: string;
  className?: string;
  minWidth?: number;
  defaultWidth?: number;
  maxWidth?: number;
};

type SortState = { columnId: string; direction: 'asc' | 'desc' } | null;

function compareValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

function normalisePageSize(defaultPageSize: number, options: number[]) {
  if (options.includes(defaultPageSize)) return defaultPageSize;
  return options[0] ?? defaultPageSize;
}

export function normaliseTableFilter(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

export function rowMatchesColumnFilters<T>(
  row: T,
  columns: EnterpriseColumn<T>[],
  filters: TableColumnFilters,
) {
  return Object.entries(filters).every(([columnId, rawTerm]) => {
    const term = normaliseTableFilter(rawTerm);
    if (!term) return true;

    const column = columns.find((item) => item.id === columnId);
    if (!column || column.filterable === false) return true;

    return normaliseTableFilter(column.value(row)).includes(term);
  });
}

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

export function EnterpriseDataTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'Search records',
  emptyMessage = 'No matching records found.',
  pageSizeOptions = [50, 100, 250, 500],
  defaultPageSize = 100,
  initialSearch = '',
  getSearchText,
  actions,
  tableId = 'enterprise',
}: {
  rows: T[];
  columns: EnterpriseColumn<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  initialSearch?: string;
  getSearchText?: (row: T) => string;
  actions?: ReactNode;
  tableId?: string;
}) {
  const pageSizeChoices = useMemo(() => Array.from(new Set(pageSizeOptions)).sort((a, b) => a - b), [pageSizeOptions]);
  const [search, setSearch] = useState(initialSearch);
  const [columnFilters, setColumnFilters] = useState<TableColumnFilters>({});
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => normalisePageSize(defaultPageSize, pageSizeChoices));
  const {
    activeColumnId,
    getColumnWidth,
    nudgeColumn,
    resetColumn,
    resetWidths,
    startResize,
    totalWidth,
  } = useResizableColumns(columns, tableId);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setPageSize((current) => (pageSizeChoices.includes(current) ? current : normalisePageSize(defaultPageSize, pageSizeChoices)));
  }, [defaultPageSize, pageSizeChoices]);

  const filteredRows = useMemo(() => {
    const term = normaliseTableFilter(search);

    return rows.filter((row) => {
      if (term) {
        const searchable = getSearchText
          ? getSearchText(row)
          : columns.map((column) => String(column.value(row) ?? '')).join(' ');
        if (!normaliseTableFilter(searchable).includes(term)) return false;
      }

      return rowMatchesColumnFilters(row, columns, columnFilters);
    });
  }, [columnFilters, columns, getSearchText, rows, search]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const column = columns.find((item) => item.id === sort.columnId);
    if (!column) return filteredRows;

    return [...filteredRows].sort((left, right) => {
      const result = compareValues(column.value(left), column.value(right));
      return sort.direction === 'asc' ? result : -result;
    });
  }, [columns, filteredRows, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [page, pageSize, sortedRows]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, columnFilters]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function toggleSort(column: EnterpriseColumn<T>) {
    if (!column.sortable) return;
    setSort((current) => {
      if (!current || current.columnId !== column.id) return { columnId: column.id, direction: 'asc' };
      return { columnId: column.id, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  }

  function updateColumnFilter(columnId: string, value: string) {
    setColumnFilters((current) => {
      const next = { ...current };
      if (value) next[columnId] = value;
      else delete next[columnId];
      return next;
    });
  }

  const hasColumnFilters = Object.values(columnFilters).some((value) => normaliseTableFilter(value));
  const firstVisible = sortedRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, sortedRows.length);
  const totalPagesLabel = pageCount.toLocaleString();

  return (
    <section className="enterprise-table-shell">
      <div className="enterprise-table-toolbar">
        <label className="enterprise-table-search">
          <span className="sr-only">Search table</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} type="search" />
        </label>
        <div className="enterprise-table-count">
          <strong>{filteredRows.length.toLocaleString()}</strong> of {rows.length.toLocaleString()} record(s)
        </div>
        {actions ? <div className="enterprise-table-actions">{actions}</div> : null}
        {hasColumnFilters ? <button className="button secondary" onClick={() => setColumnFilters({})} type="button">Clear column filters</button> : null}
        <button className="button secondary column-width-reset" onClick={resetWidths} type="button">Reset columns</button>
      </div>

      <TableScrollFrame totalWidth={totalWidth}>
        <table className="resizable-enterprise-table" style={{ minWidth: `${totalWidth}px`, width: `${totalWidth}px` }}>
          <colgroup>
            {columns.map((column) => <col key={column.id} style={{ width: `${getColumnWidth(column.id)}px` }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => {
                const activeSort = sort?.columnId === column.id ? sort.direction : null;
                const columnWidth = getColumnWidth(column.id);
                const filterable = column.filterable !== false;
                return (
                  <th aria-sort={activeSort === 'asc' ? 'ascending' : activeSort === 'desc' ? 'descending' : 'none'} className={column.className} key={column.id} style={{ width: `${columnWidth}px` }}>
                    <div className="resizable-th-stack">
                      <div className="resizable-th-content">
                        {column.sortable ? (
                          <button className="table-sort-button" onClick={() => toggleSort(column)} type="button">
                            <span>{column.header}</span>
                            <span aria-hidden="true">{activeSort === 'asc' ? '↑' : activeSort === 'desc' ? '↓' : '↕'}</span>
                          </button>
                        ) : <span className="table-header-label">{column.header}</span>}
                      </div>
                      {filterable ? (
                        <input
                          aria-label={`Filter ${column.header} column`}
                          autoComplete="off"
                          className="table-column-filter-input"
                          onChange={(event) => updateColumnFilter(column.id, event.target.value)}
                          placeholder={column.filterPlaceholder ?? `Filter ${column.header}`}
                          spellCheck={false}
                          type="search"
                          value={columnFilters[column.id] ?? ''}
                        />
                      ) : <span aria-hidden="true" className="table-column-filter-spacer" />}
                      <button
                        aria-label={`Resize ${column.header} column. Drag, use arrow keys, or double click to reset.`}
                        aria-valuenow={columnWidth}
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
              <tr><td colSpan={columns.length}>{emptyMessage}</td></tr>
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

      <div className="enterprise-table-pagination">
        <div>Showing {firstVisible.toLocaleString()}-{lastVisible.toLocaleString()} of {sortedRows.length.toLocaleString()}</div>
        <label>Rows
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {pageSizeChoices.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="enterprise-pagination-buttons">
          <button className="button secondary" disabled={page <= 1} onClick={() => setPage(1)} type="button">First</button>
          <button className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
          <span>Page {page.toLocaleString()} of {totalPagesLabel}</span>
          <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next</button>
          <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage(pageCount)} type="button">Last</button>
        </div>
      </div>
    </section>
  );
}
