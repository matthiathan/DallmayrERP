'use client';

import type { ReactNode } from 'react';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';

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
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

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
  onSearchChange,
  onPageChange,
  onPageSizeChange,
}: RemoteDataTableProps<T>) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const firstVisible = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, totalRows);

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
      </div>

      {filters ? <div className="remote-table-filters">{filters}</div> : null}

      <div className="table-wrap enterprise-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th className={column.className} key={column.id}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length}>{loading ? 'Loading records...' : emptyMessage}</td></tr>
            ) : rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td className={column.className} key={column.id}>{column.render ? column.render(row) : column.value(row) ?? '-'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
