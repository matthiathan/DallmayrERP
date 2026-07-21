'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { AssetTicketCard } from '@/components/ui/AssetTicketCard';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { RemoteDataTable } from '@/components/ui/RemoteDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { recordAuditEvent } from '@/lib/data/audit';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isExactMachineMatch, machineSearchLabel, normaliseLookupTerm, rankMachineMatches } from '@/lib/search/machineSearch';
import type { Branch } from '@/types/dallmayrerp';
import type { MachineStatus } from '@/types/enterprise-records';

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

const branches: Array<'all' | Branch> = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const statuses: Array<'all' | MachineStatus> = ['all', 'active', 'inactive', 'repair', 'retired', 'unknown'];
const linkFilters = ['all', 'linked', 'unlinked'] as const;

function getCustomerName(machine: MachineRow) {
  return machine.customer_name ?? 'Unassigned';
}

function linkFilterToRpc(value: (typeof linkFilters)[number]) {
  if (value === 'linked') return false;
  if (value === 'unlinked') return true;
  return null;
}

export function MachineAssetBoard() {
  const focusedMachineId = useClientQueryParam('machine');
  const { businessUser, userDetails } = useAuth();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [machineName, setMachineName] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [machineBarcode, setMachineBarcode] = useState('');
  const [status, setStatus] = useState<MachineStatus>('active');
  const [search, setSearch] = useState(focusedMachineId ?? '');
  const [branchFilter, setBranchFilter] = useState<'all' | Branch>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | MachineStatus>('all');
  const [linkFilter, setLinkFilter] = useState<(typeof linkFilters)[number]>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalRows, setTotalRows] = useState(0);
  const [scannedAsset, setScannedAsset] = useState<MachineRow | null>(null);
  const [scanCandidates, setScanCandidates] = useState<MachineRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMachines() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('search_machine_assets', {
      p_search: search.trim() || null,
      p_branch: branchFilter,
      p_status: statusFilter,
      p_unlinked: linkFilterToRpc(linkFilter),
      p_offset: (page - 1) * pageSize,
      p_limit: pageSize,
    });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as MachineRow[];
    setMachines(rows);
    setTotalRows(rows[0]?.total_count ?? 0);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadMachines().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load machines.');
        setLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [search, branchFilter, statusFilter, linkFilter, page, pageSize]);

  useEffect(() => {
    if (focusedMachineId) {
      setSearch(focusedMachineId);
      setPage(1);
    }
  }, [focusedMachineId]);

  useEffect(() => {
    const cleanBarcode = normaliseLookupTerm(machineBarcode);
    if (!cleanBarcode) {
      setScannedAsset(null);
      setScanCandidates([]);
      return;
    }

    if (cleanBarcode.length < 2) {
      setScannedAsset(null);
      setScanCandidates([]);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const { data, error: scanError } = await getSupabaseClient().rpc('search_machine_assets', {
        p_search: cleanBarcode,
        p_branch: 'all',
        p_status: 'all',
        p_unlinked: null,
        p_offset: 0,
        p_limit: 12,
      });

      if (cancelled) return;
      if (scanError) {
        setError(`Machine lookup failed: ${scanError.message}`);
        setScannedAsset(null);
        setScanCandidates([]);
        return;
      }

      const rankedMatches = rankMachineMatches((data ?? []) as MachineRow[], cleanBarcode);
      const exactMatch = rankedMatches.find((machine) => isExactMachineMatch(machine, cleanBarcode));
      const selectedMatch = exactMatch ?? (rankedMatches.length === 1 ? rankedMatches[0] : null);

      setScannedAsset(selectedMatch);
      setScanCandidates(selectedMatch ? [] : rankedMatches);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [machineBarcode]);

  function applyCustomer(customer: CustomerOption | null) {
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    if (customer) setBranch(customer.branch);
  }

  function selectScannedAsset(machine: MachineRow) {
    setScannedAsset(machine);
    setScanCandidates([]);
    setMachineBarcode(machine.machine_barcode ?? machine.serial_number ?? machine.id);
  }

  function clearScan() {
    setMachineBarcode('');
    setScannedAsset(null);
    setScanCandidates([]);
  }

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setPage(1);
  }

  async function createMachine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || scannedAsset || scanCandidates.length > 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const cleanSerialNumber = serialNumber.trim();
    const cleanBarcode = machineBarcode.trim();
    const client = getSupabaseClient();
    const { data, error: createError } = await client.from('machines').insert({
      branch,
      customer_id: customerId,
      machine_name: machineName.trim() || null,
      model: model.trim() || null,
      serial_number: cleanSerialNumber,
      machine_barcode: cleanBarcode,
      status,
    }).select('id').single();
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch,
      entityType: 'machine',
      entityId: data.id,
      action: 'machine_created',
      summary: `Machine created: ${machineName.trim() || cleanSerialNumber || cleanBarcode}.`,
      afterPayload: { branch, customer_id: customerId, machine_name: machineName.trim() || null, model: model.trim() || null, serial_number: cleanSerialNumber, machine_barcode: cleanBarcode, status },
    });
    setMessage('Machine created. Open its lifecycle workspace to set condition, custody and audit dates.');
    setCustomerId(null);
    setCustomerName('');
    setMachineName('');
    setModel('');
    setSerialNumber('');
    setMachineBarcode('');
    setStatus('active');
    setScannedAsset(null);
    setScanCandidates([]);
    await loadMachines();
  }

  const columns = useMemo<EnterpriseColumn<MachineRow>[]>(() => [
    { id: 'machine', header: 'Machine', value: (row) => row.machine_name ?? '', render: (row) => <Link href={`/operations/assets/${row.id}`}><strong>{row.machine_name ?? row.serial_number ?? 'Unnamed machine'}</strong></Link> },
    { id: 'customer', header: 'Customer', value: getCustomerName },
    { id: 'model', header: 'Model', value: (row) => row.model ?? '' },
    { id: 'serial', header: 'Serial number', value: (row) => row.serial_number ?? '' },
    { id: 'barcode', header: 'QR / Barcode', value: (row) => row.machine_barcode ?? '' },
    { id: 'condition', header: 'Condition', value: (row) => row.condition, render: (row) => <StatusBadge value={row.condition} /> },
    { id: 'criticality', header: 'Criticality', value: (row) => row.criticality, render: (row) => <StatusBadge value={row.criticality} /> },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase() },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <StatusBadge value={row.status} /> },
  ], []);

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="neo-card spatial-machine-panel spatial-card">
        <div className="page-toolbar-heading"><div><h2>Machine profiles</h2><p>Create customer-linked machines or enter any distinctive part of an existing QR/barcode or serial number to prevent duplicate records.</p></div><Link className="button secondary" href="/work">Open Action Centre</Link></div>
        <form className="grid" onSubmit={createMachine}>
          <div className="form-grid">
            <CustomerSelect label="Customer" onSelect={applyCustomer} value={customerName} />
            <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.filter((item): item is Branch => item !== 'all').map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Machine name<input value={machineName} onChange={(event) => setMachineName(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label>Serial number<input required value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
            <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MachineStatus)}>{statuses.filter((item): item is MachineStatus => item !== 'all').map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <BarcodeCapture label="Machine QR / barcode / serial lookup" value={machineBarcode} onChange={setMachineBarcode} />
          {scannedAsset ? <p className="field-note danger">Existing asset found. Open the asset ticket instead of creating a duplicate.</p> : null}
          {scanCandidates.length > 0 ? (
            <div className="machine-match-options">
              <p>{scanCandidates.length} existing machines contain this partial code. Select the correct asset or enter more characters before creating anything.</p>
              <div className="machine-match-list">
                {scanCandidates.map((machine) => (
                  <button className="machine-match-option" key={machine.id} onClick={() => selectScannedAsset(machine)} type="button">
                    <strong>{machineSearchLabel(machine)}</strong>
                    <span>{machine.serial_number ?? 'No serial'} • {machine.machine_barcode ?? 'No barcode'}</span>
                    <small>{getCustomerName(machine)} • {machine.branch.toUpperCase()}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <button className="button pulse-button" disabled={saving || Boolean(scannedAsset) || scanCandidates.length > 0 || !serialNumber.trim() || !machineBarcode.trim()} type="submit">{saving ? 'Creating machine...' : 'Create machine'}</button>
        </form>
      </div>

      {scannedAsset ? (
        <AssetTicketCard
          asset={{
            id: scannedAsset.id,
            machineName: scannedAsset.machine_name,
            model: scannedAsset.model,
            serialNumber: scannedAsset.serial_number,
            barcode: scannedAsset.machine_barcode,
            branch: scannedAsset.branch,
            status: scannedAsset.status,
            condition: scannedAsset.condition,
            criticality: scannedAsset.criticality,
            custodyStatus: scannedAsset.custody_status,
            customerName: getCustomerName(scannedAsset),
            siteName: scannedAsset.site_name,
            siteAddress: scannedAsset.site_address,
            custodian: scannedAsset.current_custodian,
            nextAuditAt: scannedAsset.next_audit_at,
          }}
          compact
          eyebrow="Matched asset"
          action={<><Link className="button" href={`/operations/assets/${scannedAsset.id}`}>Open asset workspace</Link><button className="button secondary" onClick={clearScan} type="button">Clear scan</button></>}
        />
      ) : null}

      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadMachines} type="button">{loading ? 'Refreshing...' : 'Refresh register'}</button>} description="Contains search across machine, customer, site, serial, barcode, status and branch. Enter any distinctive portion of a code." lastUpdated={lastUpdated} title="Machine register" />
      <RemoteDataTable
        columns={columns}
        emptyMessage="No matching machines found. Try fewer characters from the serial number or barcode."
        filters={(
          <>
            <label>Branch<select value={branchFilter} onChange={(event) => { setBranchFilter(event.target.value as 'all' | Branch); setPage(1); }}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
            <label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as 'all' | MachineStatus); setPage(1); }}>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label>Link status<select value={linkFilter} onChange={(event) => { setLinkFilter(event.target.value as (typeof linkFilters)[number]); setPage(1); }}>{linkFilters.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </>
        )}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={updatePageSize}
        onSearchChange={updateSearch}
        page={page}
        pageSize={pageSize}
        rowKey={(row) => row.id}
        rows={machines}
        search={search}
        searchPlaceholder="Enter part of a machine, customer, serial, barcode, site, status or branch"
        totalRows={totalRows}
      />
    </div>
  );
}
