'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type EnterpriseColumn<T> = {
  id: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
};

type SortState = { columnId: string; direction: 'asc' | 'desc' } | null;

function compareValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

export function EnterpriseDataTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'Search records',
  emptyMessage = 'No matching records found.',
  pageSizeOptions = [10, 20, 50],
  defaultPageSize = 20,
  initialSearch = '',
  getSearchText,
  actions,
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
}) {
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((row) => {
      const searchable = getSearchText
        ? getSearchText(row)
        : columns.map((column) => String(column.value(row) ?? '')).join(' ');
      return searchable.toLowerCase().includes(term);
    });
  }, [columns, getSearchText, rows, search]);

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
  }, [search, pageSize]);

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

  const firstVisible = sortedRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, sortedRows.length);

  return (
    <section className="enterprise-table-shell">
      <div className="enterprise-table-toolbar">
        <label className="enterprise-table-search">
          <span className="sr-only">Search table</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} type="search" />
        </label>
        <div className="enterprise-table-count">{filteredRows.length} record(s)</div>
        {actions ? <div className="enterprise-table-actions">{actions}</div> : null}
      </div>

      <div className="table-wrap enterprise-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const activeSort = sort?.columnId === column.id ? sort.direction : null;
                return (
                  <th aria-sort={activeSort === 'asc' ? 'ascending' : activeSort === 'desc' ? 'descending' : 'none'} className={column.className} key={column.id}>
                    {column.sortable ? (
                      <button className="table-sort-button" onClick={() => toggleSort(column)} type="button">
                        <span>{column.header}</span>
                        <span aria-hidden="true">{activeSort === 'asc' ? '↑' : activeSort === 'desc' ? '↓' : '↕'}</span>
                      </button>
                    ) : column.header}
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
                {columns.map((column) => <td className={column.className} key={column.id}>{column.render ? column.render(row) : column.value(row) ?? '-'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="enterprise-table-pagination">
        <div>Showing {firstVisible}-{lastVisible} of {sortedRows.length}</div>
        <label>Rows
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="enterprise-pagination-buttons">
          <button className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
          <span>Page {page} of {pageCount}</span>
          <button className="button secondary" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next</button>
        </div>
      </div>
    </section>
  );
}
