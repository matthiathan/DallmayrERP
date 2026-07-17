'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { MachineStatus } from '@/types/enterprise-records';

type DuplicateGroup = { value: string; count: number };

type DataQualitySummary = {
  customer_count?: number;
  active_customer_count?: number;
  machine_count?: number;
  machines_without_customer?: number;
  machines_without_site?: number;
  duplicate_customer_codes?: number;
  duplicate_customer_names?: number;
  duplicate_machine_barcodes?: number;
  duplicate_serial_numbers?: number;
  top_duplicate_customer_codes?: DuplicateGroup[];
  top_duplicate_customer_names?: DuplicateGroup[];
  top_duplicate_machine_barcodes?: DuplicateGroup[];
  top_duplicate_serial_numbers?: DuplicateGroup[];
};

type MachineRow = {
  id: string;
  branch: Branch;
  customer_id: string | null;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  machine_name: string | null;
  model: string | null;
  status: MachineStatus;
  condition: string;
  criticality: string;
  custody_status: string;
  current_custodian: string | null;
  next_audit_at: string | null;
  created_at: string;
  customer_name: string | null;
  site_name: string | null;
  site_address: string | null;
  total_count: number | null;
};

const metricCards: Array<{ key: keyof DataQualitySummary; label: string; tone?: string }> = [
  { key: 'customer_count', label: 'Customer records' },
  { key: 'machine_count', label: 'Machine records' },
  { key: 'machines_without_customer', label: 'Machines without customer', tone: 'warning' },
  { key: 'machines_without_site', label: 'Machines without site', tone: 'warning' },
  { key: 'duplicate_customer_codes', label: 'Duplicate account-code groups', tone: 'risk' },
  { key: 'duplicate_customer_names', label: 'Duplicate customer-name groups', tone: 'risk' },
  { key: 'duplicate_machine_barcodes', label: 'Duplicate barcode groups', tone: 'risk' },
  { key: 'duplicate_serial_numbers', label: 'Duplicate serial-number groups', tone: 'risk' },
];

function numberValue(value: unknown) {
  return typeof value === 'number' ? value.toLocaleString() : '0';
}

function DuplicateList({ title, groups }: { title: string; groups?: DuplicateGroup[] }) {
  return (
    <section className="neo-card">
      <h3>{title}</h3>
      {!groups || groups.length === 0 ? <p>No duplicate groups found.</p> : (
        <div className="record-timeline">
          {groups.map((group) => (
            <article className="record-timeline-item" key={`${title}-${group.value}`}>
              <div>
                <strong>{group.value || 'Blank value'}</strong>
                <small>{group.count.toLocaleString()} matching records</small>
              </div>
              <StatusBadge value="review" label="Review" />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DataMatchingWorkbench() {
  const [summary, setSummary] = useState<DataQualitySummary | null>(null);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSummary() {
    const { data, error: summaryError } = await getSupabaseClient().rpc('get_master_data_quality_summary');
    if (summaryError) throw summaryError;
    setSummary((data ?? {}) as DataQualitySummary);
  }

  async function loadUnlinkedMachines() {
    const { data, error: machineError } = await getSupabaseClient().rpc('search_machine_assets', {
      p_search: search.trim() || null,
      p_branch: 'all',
      p_status: 'all',
      p_unlinked: true,
      p_offset: (page - 1) * pageSize,
      p_limit: pageSize,
    });
    if (machineError) throw machineError;
    const rows = (data ?? []) as MachineRow[];
    setMachines(rows);
    setTotalRows(rows[0]?.total_count ?? 0);
  }

  async function loadWorkbench() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadSummary(), loadUnlinkedMachines()]);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load data quality workbench.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadWorkbench();
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, page, pageSize]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setPage(1);
  }

  const columns = useMemo<EnterpriseColumn<MachineRow>[]>(() => [
    { id: 'machine', header: 'Machine', value: (row) => row.machine_name ?? '', render: (row) => <Link href={`/operations/assets/${row.id}`}><strong>{row.machine_name ?? row.serial_number ?? row.machine_barcode ?? 'Unnamed machine'}</strong></Link> },
    { id: 'serial', header: 'Serial', value: (row) => row.serial_number ?? '' },
    { id: 'barcode', header: 'QR / Barcode', value: (row) => row.machine_barcode ?? '' },
    { id: 'model', header: 'Model', value: (row) => row.model ?? '' },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <StatusBadge value={row.status} /> },
  ], []);

  return (
    <div className="grid professional-ops-stage">
      {error ? <div className="error">{error}</div> : null}
      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={loadWorkbench} type="button">{loading ? 'Refreshing...' : 'Refresh workbench'}</button>}
        description="Find unlinked machines, duplicate account codes, repeated customer names, duplicate asset barcodes and duplicate serial numbers."
        lastUpdated={lastUpdated}
        title="Master data quality"
      />

      <div className="grid grid-4 spatial-kpi-grid">
        {metricCards.map((metric) => (
          <div className="card" key={metric.key}>
            <div className="nav-heading">{metric.label}</div>
            <div className="kpi-value">{numberValue(summary?.[metric.key])}</div>
            {metric.tone ? <StatusBadge value={metric.tone} /> : null}
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <DuplicateList title="Duplicate customer account codes" groups={summary?.top_duplicate_customer_codes} />
        <DuplicateList title="Duplicate customer names" groups={summary?.top_duplicate_customer_names} />
        <DuplicateList title="Duplicate machine barcodes" groups={summary?.top_duplicate_machine_barcodes} />
        <DuplicateList title="Duplicate serial numbers" groups={summary?.top_duplicate_serial_numbers} />
      </div>

      <PageToolbar
        description="Machines with no linked customer. Search by asset name, serial, barcode, model, status or branch, then open the machine workspace to correct the record."
        title="Unlinked machine records"
      />
      <RemoteDataTable
        columns={columns}
        emptyMessage="No unlinked machines found."
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={updatePageSize}
        onSearchChange={updateSearch}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => row.id}
        rows={machines}
        search={search}
        searchPlaceholder="Search unlinked machine, serial, barcode, model or branch"
        totalRows={totalRows}
      />
    </div>
  );
}

export default DataMatchingWorkbench;
