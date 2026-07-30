'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardHeader } from '@/components/boards/BoardWorkspace';
import { CustomerBoardControls } from '@/components/boards/CustomerBoardControls';
import { CustomerBoardTable } from '@/components/boards/CustomerBoardTable';
import { CustomerItemCard } from '@/components/boards/CustomerItemCard';
import { useCustomerBoard } from '@/components/boards/useCustomerBoard';
import { AppShell } from '@/components/layout/AppShell';
import type { CustomerRecord } from '@/types/enterprise-records';

export function CustomerBoardWorkspace() {
  const board = useCustomerBoard();
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);
  const [activeCustomerSnapshot, setActiveCustomerSnapshot] = useState<CustomerRecord | null>(null);

  useEffect(() => {
    function syncRecordFromUrl() {
      const recordId = new URL(window.location.href).searchParams.get('record');
      setActiveCustomerId(recordId);
      if (!recordId) setActiveCustomerSnapshot(null);
    }

    syncRecordFromUrl();
    window.addEventListener('popstate', syncRecordFromUrl);
    return () => window.removeEventListener('popstate', syncRecordFromUrl);
  }, []);

  const activeCustomer = useMemo(
    () => activeCustomerSnapshot?.id === activeCustomerId
      ? activeCustomerSnapshot
      : board.customers.find((customer) => customer.id === activeCustomerId) ?? null,
    [activeCustomerId, activeCustomerSnapshot, board.customers],
  );

  const openCustomer = useCallback((customer: CustomerRecord) => {
    setActiveCustomerId(customer.id);
    setActiveCustomerSnapshot(customer);
    const url = new URL(window.location.href);
    url.searchParams.set('record', customer.id);
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.pushState({ ...currentState, dallmayrCustomerCard: customer.id }, '', url);
  }, []);

  const closeCustomer = useCallback(() => {
    if (!activeCustomerId) return;
    if (window.history.state?.dallmayrCustomerCard === activeCustomerId) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('record');
    window.history.replaceState(window.history.state, '', url);
    setActiveCustomerId(null);
    setActiveCustomerSnapshot(null);
  }, [activeCustomerId]);

  return (
    <AppShell>
      <div className="monday-customer-board">
        <BoardHeader
          actions={(
            <>
              <button className="button secondary" disabled={board.loading} onClick={() => board.loadCustomers()} type="button">{board.loading ? 'Refreshing…' : 'Refresh'}</button>
              <button className="button" disabled={board.customers.length === 0} onClick={board.exportRows} type="button">{board.selectedCount > 0 ? `Export selected (${board.selectedCount})` : 'Export visible'}</button>
            </>
          )}
          description="Customer accounts, contact details and operational records across authorised branches. Select a customer to open its item card without leaving the board."
          eyebrow="Customer workspace"
          meta={<span>{board.totalRows.toLocaleString()} records</span>}
          title="Customers"
        />

        {board.error ? <div className="error" role="alert">{board.error}</div> : null}

        <CustomerBoardControls board={board} />

        {board.selectedCount > 0 ? (
          <div className="monday-board-selection-bar">
            <strong>{board.selectedCount.toLocaleString()} selected</strong>
            <span>Selection applies to the visible page.</span>
            <button className="button secondary" onClick={board.exportRows} type="button">Export selected</button>
            <button className="button secondary" onClick={() => board.setSelectedIds(new Set())} type="button">Clear selection</button>
          </div>
        ) : null}

        <section className="monday-board-surface" aria-busy={board.loading}>
          <div className="monday-board-surface-heading">
            <div><span>Board</span><h2>{board.activeViewLabel}</h2></div>
            <div><strong>{board.totalRows.toLocaleString()}</strong><span>matching customer records</span></div>
          </div>

          <CustomerBoardTable
            groupBy={board.groupBy}
            loading={board.loading}
            onOpenCustomer={openCustomer}
            onSelectedIdsChange={board.setSelectedIds}
            onSort={board.handleSort}
            rows={board.customers}
            selectedIds={board.selectedIds}
            sortColumn={board.sortColumn}
            sortDirection={board.sortDirection}
            visibleColumnIds={board.visibleColumnIds}
          />

          <footer className="monday-board-pagination">
            <div>{board.loading ? 'Refreshing…' : `Showing ${board.firstVisible.toLocaleString()}–${board.lastVisible.toLocaleString()} of ${board.totalRows.toLocaleString()}`}</div>
            <label>Rows<select value={board.pageSize} onChange={(event) => board.changePageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option></select></label>
            <div>
              <button className="button secondary" disabled={board.page <= 1 || board.loading} onClick={() => board.changePage(1)} type="button">First</button>
              <button className="button secondary" disabled={board.page <= 1 || board.loading} onClick={() => board.changePage(board.page - 1)} type="button">Previous</button>
              <span>Page {board.page.toLocaleString()} of {board.pageCount.toLocaleString()}</span>
              <button className="button secondary" disabled={board.page >= board.pageCount || board.loading} onClick={() => board.changePage(board.page + 1)} type="button">Next</button>
              <button className="button secondary" disabled={board.page >= board.pageCount || board.loading} onClick={() => board.changePage(board.pageCount)} type="button">Last</button>
            </div>
          </footer>
        </section>
      </div>

      <CustomerItemCard
        customerId={activeCustomerId}
        initialCustomer={activeCustomer}
        onClose={closeCustomer}
        open={Boolean(activeCustomerId)}
      />
    </AppShell>
  );
}
