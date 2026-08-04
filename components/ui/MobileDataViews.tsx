'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

export type MobileRecordColumn<T> = {
  id: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  mobileHidden?: boolean;
  mobileLabel?: string;
  mobilePriority?: number;
  mobileTitle?: boolean;
};

export type MobileFilterChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

const utilityColumnPattern = /^(action|actions|control|controls|manage|select|selection)$/i;

function isUtilityColumn<T>(column: MobileRecordColumn<T>) {
  return utilityColumnPattern.test(column.id) || utilityColumnPattern.test(column.header);
}

function renderColumnValue<T>(column: MobileRecordColumn<T>, row: T) {
  return column.render ? column.render(row) : column.value(row) ?? '-';
}

export function MobileRecordList<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  emptyMessage,
  maxDetails = 4,
}: {
  rows: T[];
  columns: MobileRecordColumn<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage: string;
  maxDetails?: number;
}) {
  const visibleColumns = useMemo(
    () => columns.filter((column) => !column.mobileHidden),
    [columns],
  );
  const titleColumn = visibleColumns.find((column) => column.mobileTitle)
    ?? visibleColumns.find((column) => !isUtilityColumn(column))
    ?? visibleColumns[0];
  const detailColumns = useMemo(
    () => visibleColumns
      .filter((column) => column.id !== titleColumn?.id)
      .map((column, index) => ({ column, index }))
      .sort((left, right) => {
        const leftPriority = left.column.mobilePriority
          ?? (isUtilityColumn(left.column) ? 0 : left.index + 100);
        const rightPriority = right.column.mobilePriority
          ?? (isUtilityColumn(right.column) ? 0 : right.index + 100);
        return leftPriority - rightPriority;
      })
      .slice(0, maxDetails)
      .map(({ column }) => column),
    [maxDetails, titleColumn?.id, visibleColumns],
  );

  return (
    <div aria-busy={loading} aria-label="Records" className="mobile-record-list" role="list">
      {rows.length === 0 ? (
        <div aria-live="polite" className="mobile-record-empty" role="status">
          {loading ? 'Loading records...' : emptyMessage}
        </div>
      ) : rows.map((row) => (
        <article className="mobile-record-card" key={rowKey(row)} role="listitem">
          {titleColumn ? (
            <header className="mobile-record-card-title">
              <span>{titleColumn.mobileLabel ?? titleColumn.header}</span>
              <div>{renderColumnValue(titleColumn, row)}</div>
            </header>
          ) : null}
          {detailColumns.length > 0 ? (
            <dl className="mobile-record-card-details">
              {detailColumns.map((column) => (
                <div key={column.id}>
                  <dt>{column.mobileLabel ?? column.header}</dt>
                  <dd>{renderColumnValue(column, row)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function MobileFilterChips({ chips }: { chips: MobileFilterChip[] }) {
  if (chips.length === 0) return null;

  return (
    <div aria-label="Active filters" className="mobile-filter-chips">
      {chips.map((chip) => (
        <button aria-label={`Remove ${chip.label} filter`} key={chip.id} onClick={chip.onRemove} type="button">
          <span>{chip.label}</span>
          <span aria-hidden="true">&times;</span>
        </button>
      ))}
    </div>
  );
}

export function MobileFilterSheet({
  activeCount,
  children,
  onClear,
  onClose,
  open,
  title = 'Filters',
}: {
  activeCount: number;
  children: ReactNode;
  onClear?: () => void;
  onClose: () => void;
  open: boolean;
  title?: string;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      const restoreTarget = restoreFocusRef.current;
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="mobile-filter-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="mobile-filter-sheet-title"
        aria-modal="true"
        className="mobile-filter-sheet"
        ref={panelRef}
        role="dialog"
      >
        <header className="mobile-filter-sheet-header">
          <div>
            <span>{activeCount > 0 ? `${activeCount} active` : 'No active filters'}</span>
            <h2 id="mobile-filter-sheet-title">{title}</h2>
          </div>
          <button aria-label="Close filters" className="mobile-filter-sheet-close" onClick={onClose} ref={closeButtonRef} type="button">&times;</button>
        </header>
        <div className="mobile-filter-sheet-body">{children}</div>
        <footer className="mobile-filter-sheet-footer">
          {onClear ? <button className="button secondary" disabled={activeCount === 0} onClick={onClear} type="button">Clear filters</button> : <span />}
          <button className="button" onClick={onClose} type="button">Show results</button>
        </footer>
      </section>
    </div>
  );
}
