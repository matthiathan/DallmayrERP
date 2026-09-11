'use client';

import styles from './DeviceRegisterPagination.module.css';

type DeviceRegisterPaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const PAGE_SIZES = [25, 50, 100] as const;

export function DeviceRegisterPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: DeviceRegisterPaginationProps) {
  const first = total ? ((page - 1) * pageSize) + 1 : 0;
  const last = Math.min(total, page * pageSize);
  const canGoBack = page > 1;
  const canGoForward = page < pageCount;

  return (
    <nav className={styles.pagination} aria-label="Telemetry device pages">
      <div className={styles.summary} aria-live="polite">
        <strong>{first.toLocaleString('en-ZA')}–{last.toLocaleString('en-ZA')}</strong>
        <span>of {total.toLocaleString('en-ZA')} matching controllers</span>
      </div>

      <label className={styles.pageSize}>
        <span>Rows per page</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>

      <div className={styles.controls}>
        <button aria-label="First device page" disabled={!canGoBack} onClick={() => onPageChange(1)} type="button">First</button>
        <button aria-label="Previous device page" disabled={!canGoBack} onClick={() => onPageChange(page - 1)} type="button">Previous</button>
        <span className={styles.pageNumber}>Page {page.toLocaleString('en-ZA')} of {pageCount.toLocaleString('en-ZA')}</span>
        <button aria-label="Next device page" disabled={!canGoForward} onClick={() => onPageChange(page + 1)} type="button">Next</button>
        <button aria-label="Last device page" disabled={!canGoForward} onClick={() => onPageChange(pageCount)} type="button">Last</button>
      </div>
    </nav>
  );
}
