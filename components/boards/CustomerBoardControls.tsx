'use client';

import {
  BoardCommandBar,
  BoardFilterChips,
  BoardFilterDrawer,
  BoardViewTabs,
} from '@/components/boards/BoardWorkspace';
import { CUSTOMER_BOARD_COLUMNS, type CustomerGroupBy } from '@/components/boards/CustomerBoardTable';
import {
  CUSTOMER_BRANCHES,
  CUSTOMER_STATUSES,
  type CustomerBoardController,
  type CustomerBranchFilter,
  type CustomerStatusFilter,
} from '@/components/boards/useCustomerBoard';

export function CustomerBoardControls({ board }: { board: CustomerBoardController }) {
  function deleteCurrentView() {
    if (window.confirm('Delete this saved customer board view? This cannot be undone.')) {
      board.deleteCurrentView();
    }
  }

  return (
    <>
      <BoardViewTabs
        activeId={board.activeViewId}
        onChange={board.applyView}
        views={board.builtInViews.map((view) => ({ id: view.id, label: view.name }))}
      />

      <BoardCommandBar>
        <label className="monday-board-search">
          <span className="sr-only">Search customers</span>
          <input
            onChange={(event) => {
              board.setSearch(event.target.value);
              board.changePage(1);
              board.setActiveViewId(null);
            }}
            placeholder="Search customers, codes, phone, email or address"
            type="search"
            value={board.search}
          />
        </label>

        <button className="monday-board-command-button" data-active={board.activeFilterChips.length > 0 ? 'true' : undefined} onClick={() => board.setFiltersOpen(true)} type="button">
          <span>Filter</span><small>{board.activeFilterChips.length}</small>
        </button>

        <label className="monday-board-inline-select">
          <span>Group</span>
          <select value={board.groupBy} onChange={(event) => { board.setGroupBy(event.target.value as CustomerGroupBy); board.changePage(1); board.setActiveViewId(null); }}>
            <option value="none">No grouping</option>
            <option value="branch">Branch</option>
            <option value="status">Status</option>
          </select>
        </label>

        <details className="monday-board-menu">
          <summary>Columns <small>{board.visibleColumnIds.length}</small></summary>
          <div className="monday-board-menu-panel">
            <header><strong>Visible columns</strong><span>Customer is always shown</span></header>
            {CUSTOMER_BOARD_COLUMNS.map((column) => (
              <label key={column.id}>
                <input
                  checked={!board.hiddenColumns.includes(column.id)}
                  disabled={column.required}
                  onChange={() => board.toggleColumn(column.id)}
                  type="checkbox"
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </details>

        <label className="monday-board-inline-select monday-board-saved-view-select">
          <span>Saved view</span>
          <select value={board.activeViewId ?? ''} onChange={(event) => event.target.value && board.applyView(event.target.value)}>
            <option value="">Current view</option>
            <optgroup label="Default views">
              {board.builtInViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </optgroup>
            {board.customViews.length > 0 ? <optgroup label="My saved views">{board.customViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</optgroup> : null}
          </select>
        </label>

        <div className="monday-board-save-view-control">
          <button className="monday-board-command-button" onClick={() => board.setSaveViewOpen((current) => !current)} type="button">Save view</button>
          {board.saveViewOpen ? (
            <form className="monday-board-save-view-popover" onSubmit={(event) => { event.preventDefault(); board.saveCurrentView(); }}>
              <label>View name<input autoFocus maxLength={60} onChange={(event) => board.setSaveViewName(event.target.value)} placeholder="e.g. Active Gauteng accounts" value={board.saveViewName} /></label>
              <div><button className="button secondary" onClick={() => board.setSaveViewOpen(false)} type="button">Cancel save</button><button className="button" disabled={!board.saveViewName.trim()} type="submit">Save named view</button></div>
            </form>
          ) : null}
        </div>

        {board.currentCustomView ? <button className="monday-board-command-button is-danger" onClick={deleteCurrentView} type="button">Delete saved view</button> : null}

        <div className="monday-board-command-summary">
          <strong>{board.activeViewLabel}</strong>
          <span>{board.lastUpdated ? `Updated ${board.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading board'}</span>
        </div>
      </BoardCommandBar>

      {board.activeFilterChips.length > 0 ? (
        <BoardFilterChips>
          {board.activeFilterChips.map((chip) => <button aria-label={`Remove ${chip.label} filter`} key={chip.id} onClick={chip.clear} type="button"><span>{chip.label}</span><span aria-hidden="true">×</span></button>)}
          <button className="monday-board-clear-chips" onClick={board.clearAllFilters} type="button">Clear all filters</button>
        </BoardFilterChips>
      ) : null}

      <BoardFilterDrawer
        description="Combine quick filters with field-level contains filters. The board remains server-side paginated."
        footer={<><button className="button secondary" onClick={board.clearAllFilters} type="button">Clear filters</button><button className="button" onClick={() => board.setFiltersOpen(false)} type="button">Show results</button></>}
        onClose={() => board.setFiltersOpen(false)}
        open={board.filtersOpen}
        title="Filter customers"
      >
        <section className="monday-board-filter-section">
          <h3>Quick filters</h3>
          <div className="monday-board-filter-grid">
            <label>Branch<select value={board.branch} onChange={(event) => { board.setBranch(event.target.value as CustomerBranchFilter); board.changePage(1); board.setActiveViewId(null); }}>{CUSTOMER_BRANCHES.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Status<select value={board.status} onChange={(event) => { board.setStatus(event.target.value as CustomerStatusFilter); board.changePage(1); board.setActiveViewId(null); }}>{CUSTOMER_STATUSES.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select></label>
          </div>
        </section>

        <section className="monday-board-filter-section">
          <h3>Field filters</h3>
          <div className="monday-board-filter-grid">
            {CUSTOMER_BOARD_COLUMNS.map((column) => (
              <label key={column.id}>{column.label}<input autoComplete="off" onChange={(event) => board.updateColumnFilter(column.id, event.target.value)} placeholder={`Contains ${column.label.toLowerCase()}`} type="search" value={board.columnFilters[column.id] ?? ''} /></label>
            ))}
          </div>
        </section>

        <section className="monday-board-filter-section">
          <h3>Presentation</h3>
          <div className="monday-board-filter-grid">
            <label>Group records<select value={board.groupBy} onChange={(event) => { board.setGroupBy(event.target.value as CustomerGroupBy); board.changePage(1); board.setActiveViewId(null); }}><option value="none">No grouping</option><option value="branch">Branch</option><option value="status">Status</option></select></label>
            <label>Rows per page<select value={board.pageSize} onChange={(event) => board.changePageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option></select></label>
          </div>
        </section>
      </BoardFilterDrawer>
    </>
  );
}
