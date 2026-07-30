'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { BoardGroupHeader } from '@/components/boards/BoardWorkspace';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TableScrollFrame } from '@/components/ui/TableScrollFrame';
import { useResizableColumns } from '@/components/ui/useResizableColumns';
import type { EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import type { CustomerRecord } from '@/types/enterprise-records';

export type CustomerColumnId = 'name' | 'code' | 'branch' | 'status' | 'phone' | 'email' | 'address';
export type CustomerSortDirection = 'asc' | 'desc';
export type CustomerGroupBy = 'none' | 'branch' | 'status';

export const CUSTOMER_BOARD_COLUMNS: Array<{
  id: CustomerColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  required?: boolean;
}> = [
  { id: 'name', label: 'Customer', defaultWidth: 260, minWidth: 210, required: true },
  { id: 'code', label: 'Account code', defaultWidth: 150, minWidth: 120 },
  { id: 'branch', label: 'Branch', defaultWidth: 120, minWidth: 100 },
  { id: 'status', label: 'Status', defaultWidth: 140, minWidth: 120 },
  { id: 'phone', label: 'Phone', defaultWidth: 170, minWidth: 140 },
  { id: 'email', label: 'Email', defaultWidth: 240, minWidth: 190 },
  { id: 'address', label: 'Address', defaultWidth: 320, minWidth: 240 },
];

function valueForColumn(row: CustomerRecord, columnId: CustomerColumnId) {
  switch (columnId) {
    case 'name': return row.customer_name;
    case 'code': return row.customer_code ?? '';
    case 'branch': return row.branch.toUpperCase();
    case 'status': return row.status ?? 'unknown';
    case 'phone': return row.phone ?? '';
    case 'email': return row.email ?? '';
    case 'address': return row.address ?? '';
    default: return '';
  }
}

function renderCell(row: CustomerRecord, columnId: CustomerColumnId, onOpenCustomer: (customer: CustomerRecord) => void) {
  if (columnId === 'name') {
    return (
      <button className="monday-board-record-link" onClick={() => onOpenCustomer(row)} type="button">
        <strong>{row.customer_name}</strong>
        <small>{row.customer_code || 'No account code'}</small>
      </button>
    );
  }
  if (columnId === 'status') return <StatusBadge value={row.status ?? 'unknown'} />;
  if (columnId === 'branch') return <span className="monday-board-branch-cell">{row.branch.toUpperCase()}</span>;
  return valueForColumn(row, columnId) || <span className="monday-board-empty-value">—</span>;
}

function resizeKeyHandler(
  event: KeyboardEvent<HTMLButtonElement>,
  columnId: string,
  nudgeColumn: (columnId: string, delta: number) => void,
  resetColumn: (columnId: string) => void,
) {
  const step = event.shiftKey ? 64 : 24;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    nudgeColumn(columnId, -step);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    nudgeColumn(columnId, step);
  } else if (event.key === 'Home' || event.key === 'Enter') {
    event.preventDefault();
    resetColumn(columnId);
  }
}

function groupLabel(groupBy: CustomerGroupBy, value: string) {
  if (groupBy === 'branch') return value.toUpperCase();
  if (groupBy === 'status') return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  return value;
}

export function CustomerBoardTable({
  rows,
  loading,
  visibleColumnIds,
  selectedIds,
  groupBy,
  sortColumn,
  sortDirection,
  onSort,
  onSelectedIdsChange,
  onOpenCustomer,
}: {
  rows: CustomerRecord[];
  loading: boolean;
  visibleColumnIds: CustomerColumnId[];
  selectedIds: Set<string>;
  groupBy: CustomerGroupBy;
  sortColumn: CustomerColumnId;
  sortDirection: CustomerSortDirection;
  onSort: (columnId: CustomerColumnId) => void;
  onSelectedIdsChange: (next: Set<string>) => void;
  onOpenCustomer: (customer: CustomerRecord) => void;
}) {
  const selectionRef = useRef<HTMLInputElement | null>(null);
  const visibleColumns = useMemo(
    () => CUSTOMER_BOARD_COLUMNS.filter((column) => visibleColumnIds.includes(column.id)),
    [visibleColumnIds],
  );
  const resizeColumns = useMemo<EnterpriseColumn<CustomerRecord>[]>(
    () => visibleColumns.map((column) => ({
      id: column.id,
      header: column.label,
      value: (row) => valueForColumn(row, column.id),
      defaultWidth: column.defaultWidth,
      minWidth: column.minWidth,
    })),
    [visibleColumns],
  );
  const { activeColumnId, getColumnWidth, nudgeColumn, resetColumn, startResize, totalWidth } = useResizableColumns(resizeColumns, 'customer-monday-board');

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  useEffect(() => {
    if (selectionRef.current) selectionRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', rows }];
    const map = new Map<string, CustomerRecord[]>();
    rows.forEach((row) => {
      const key = groupBy === 'branch' ? row.branch : (row.status ?? 'unknown');
      map.set(key, [...(map.get(key) ?? []), row]);
    });
    return Array.from(map.entries()).map(([key, groupedRows]) => ({ key, label: groupLabel(groupBy, key), rows: groupedRows }));
  }, [groupBy, rows]);

  function toggleAll() {
    const next = new Set(selectedIds);
    if (allSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    onSelectedIdsChange(next);
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  }

  const desktopWidth = totalWidth + 48;

  return (
    <div className="monday-customer-board-table">
      <div className="monday-board-desktop-table">
        <TableScrollFrame totalWidth={desktopWidth}>
          <table className="monday-board-table" style={{ minWidth: `${desktopWidth}px`, width: `${desktopWidth}px` }}>
            <colgroup>
              <col style={{ width: '48px' }} />
              {visibleColumns.map((column) => <col key={column.id} style={{ width: `${getColumnWidth(column.id)}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="monday-board-selection-column">
                  <input aria-label="Select all customers on this page" checked={allSelected} onChange={toggleAll} ref={selectionRef} type="checkbox" />
                </th>
                {visibleColumns.map((column) => {
                  const width = getColumnWidth(column.id);
                  const activeSort = sortColumn === column.id;
                  return (
                    <th key={column.id} style={{ width: `${width}px` }}>
                      <button className="monday-board-sort-button" onClick={() => onSort(column.id)} type="button">
                        <span>{column.label}</span>
                        <span aria-hidden="true" className={activeSort ? 'is-active' : undefined}>{activeSort ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>
                        <span className="sr-only">{activeSort ? `Sorted ${sortDirection}` : 'Not sorted'}</span>
                      </button>
                      <button
                        aria-label={`Resize ${column.label} column`}
                        aria-valuenow={width}
                        className="monday-board-column-resizer"
                        data-active={activeColumnId === column.id ? 'true' : undefined}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          resetColumn(column.id);
                        }}
                        onKeyDown={(event) => resizeKeyHandler(event, column.id, nudgeColumn, resetColumn)}
                        onPointerDown={(event) => startResize(column.id, event)}
                        type="button"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.key}>
                {groupBy !== 'none' ? <BoardGroupHeader colSpan={visibleColumns.length + 1} count={group.rows.length} label={group.label} /> : null}
                {group.rows.map((row) => (
                  <tr className={selectedIds.has(row.id) ? 'is-selected' : undefined} key={row.id}>
                    <td className="monday-board-selection-column"><input aria-label={`Select ${row.customer_name}`} checked={selectedIds.has(row.id)} onChange={() => toggleOne(row.id)} type="checkbox" /></td>
                    {visibleColumns.map((column) => <td key={column.id}>{renderCell(row, column.id, onOpenCustomer)}</td>)}
                  </tr>
                ))}
              </tbody>
            ))}
            {rows.length === 0 ? <tbody><tr><td className="monday-board-table-empty" colSpan={visibleColumns.length + 1}>{loading ? 'Loading customers…' : 'No matching customers found.'}</td></tr></tbody> : null}
          </table>
        </TableScrollFrame>
      </div>

      <div className="monday-board-mobile-list">
        {groups.map((group) => (
          <section className="monday-board-mobile-group" key={group.key}>
            {groupBy !== 'none' ? <header><strong>{group.label}</strong><span>{group.rows.length} visible</span></header> : null}
            {group.rows.map((row) => (
              <article className={selectedIds.has(row.id) ? 'monday-board-mobile-card is-selected' : 'monday-board-mobile-card'} key={row.id}>
                <div className="monday-board-mobile-card-heading">
                  <input aria-label={`Select ${row.customer_name}`} checked={selectedIds.has(row.id)} onChange={() => toggleOne(row.id)} type="checkbox" />
                  <button className="monday-board-record-link" onClick={() => onOpenCustomer(row)} type="button"><strong>{row.customer_name}</strong><small>{row.customer_code || 'No account code'}</small></button>
                  <StatusBadge value={row.status ?? 'unknown'} />
                </div>
                <dl>
                  <div><dt>Branch</dt><dd>{row.branch.toUpperCase()}</dd></div>
                  <div><dt>Phone</dt><dd>{row.phone || '—'}</dd></div>
                  <div><dt>Email</dt><dd>{row.email || '—'}</dd></div>
                  <div><dt>Address</dt><dd>{row.address || '—'}</dd></div>
                </dl>
              </article>
            ))}
          </section>
        ))}
        {rows.length === 0 ? <div className="monday-board-mobile-empty">{loading ? 'Loading customers…' : 'No matching customers found.'}</div> : null}
      </div>
    </div>
  );
}
