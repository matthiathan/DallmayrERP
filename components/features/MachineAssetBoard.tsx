'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { AssetTicketCard } from '@/components/ui/AssetTicketCard';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { recordAuditEvent } from '@/lib/data/audit';
import { useClientQueryParam } from '@/lib/navigation/useClientQueryParam';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { MachineRecord, MachineStatus } from '@/types/enterprise-records';

type CustomerRelation = { customer_name: string | null };
type MachineRow = MachineRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  condition: string;
  criticality: string;
  custody_status: string;
  current_custodian: string | null;
  next_audit_at: string | null;
};

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const statuses: MachineStatus[] = ['active', 'inactive', 'repair', 'retired', 'unknown'];
const assetRegisterLimit = 6000;

function getCustomerName(machine: MachineRow) {
  const relation = machine.customers;
  if (Array.isArray(relation)) return relation[0]?.customer_name ?? 'Unassigned';
  return relation?.customer_name ?? 'Unassigned';
}

function matchesScan(machine: MachineRow, scanValue: string) {
  const needle = scanValue.trim().toLowerCase();
  if (!needle) return false;
  return [machine.id, machine.machine_barcode, machine.serial_number]
    .filter(Boolean)
    .some((value) => String(value).trim().toLowerCase() === needle);
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
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMachines() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('machines')
      .select('id, branch, customer_id, site_id, serial_number, machine_barcode, machine_name, model, status, condition, criticality, custody_status, current_custodian, next_audit_at, created_at, customers(customer_name)')
      .order('created_at', { ascending: false })
      .limit(assetRegisterLimit);
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setMachines((data ?? []) as MachineRow[]);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadMachines().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machines.');
      setLoading(false);
    });
  }, []);

  function applyCustomer(customer: CustomerOption | null) {
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    if (customer) setBranch(customer.branch);
  }

  const scannedAsset = useMemo(() => machines.find((machine) => matchesScan(machine, machineBarcode)) ?? null, [machineBarcode, machines]);

  async function createMachine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || scannedAsset) return;
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
    await loadMachines();
  }

  const columns = useMemo<EnterpriseColumn<MachineRow>[]>(() => [
    { id: 'machine', header: 'Machine', value: (row) => row.machine_name ?? '', render: (row) => <Link href={`/operations/assets/${row.id}`}><strong>{row.machine_name ?? row.serial_number ?? 'Unnamed machine'}</strong></Link>, sortable: true },
    { id: 'customer', header: 'Customer', value: getCustomerName, sortable: true },
    { id: 'model', header: 'Model', value: (row) => row.model ?? '', sortable: true },
    { id: 'serial', header: 'Serial number', value: (row) => row.serial_number ?? '', sortable: true },
    { id: 'condition', header: 'Condition', value: (row) => row.condition, render: (row) => <StatusBadge value={row.condition} />, sortable: true },
    { id: 'criticality', header: 'Criticality', value: (row) => row.criticality, render: (row) => <StatusBadge value={row.criticality} />, sortable: true },
    { id: 'custody', header: 'Custody', value: (row) => row.custody_status, render: (row) => <div><StatusBadge value={row.custody_status} />{row.current_custodian ? <small>{row.current_custodian}</small> : null}</div>, sortable: true },
    { id: 'audit', header: 'Next audit', value: (row) => row.next_audit_at ?? '', render: (row) => row.next_audit_at ? <div>{new Date(row.next_audit_at).toLocaleDateString()}{new Date(row.next_audit_at).getTime() < Date.now() ? <StatusBadge value="overdue" /> : null}</div> : 'Not scheduled', sortable: true },
    { id: 'branch', header: 'Branch', value: (row) => row.branch.toUpperCase(), sortable: true },
    { id: 'status', header: 'Status', value: (row) => row.status, render: (row) => <StatusBadge value={row.status} />, sortable: true },
  ], []);

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="neo-card spatial-machine-panel spatial-card">
        <div className="page-toolbar-heading"><div><h2>Machine profiles</h2><p>Create customer-linked machines or scan an existing QR/barcode to view its asset ticket.</p></div><Link className="button secondary" href="/work">Open Action Centre</Link></div>
        <form className="grid" onSubmit={createMachine}>
          <div className="form-grid">
            <CustomerSelect label="Customer" onSelect={applyCustomer} value={customerName} />
            <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Machine name<input value={machineName} onChange={(event) => setMachineName(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label>Serial number<input required value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
            <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MachineStatus)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <BarcodeCapture label="Machine QR / barcode" value={machineBarcode} onChange={setMachineBarcode} />
          {scannedAsset ? <p className="field-note danger">Existing asset found. Open the asset ticket instead of creating a duplicate.</p> : null}
          <button className="button pulse-button" disabled={saving || Boolean(scannedAsset) || !serialNumber.trim() || !machineBarcode.trim()} type="submit">{saving ? 'Creating machine...' : 'Create machine'}</button>
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
            custodian: scannedAsset.current_custodian,
            nextAuditAt: scannedAsset.next_audit_at,
          }}
          compact
          eyebrow="Scanned asset"
          action={<><Link className="button" href={`/operations/assets/${scannedAsset.id}`}>Open asset workspace</Link><button className="button secondary" onClick={() => setMachineBarcode('')} type="button">Clear scan</button></>}
        />
      ) : null}

      <PageToolbar actions={<button className="button secondary" disabled={loading} onClick={loadMachines} type="button">{loading ? 'Refreshing...' : 'Refresh register'}</button>} description={`${machines.length.toLocaleString()} machine records loaded from the fixed asset master.`} lastUpdated={lastUpdated} title="Machine register" />
      <EnterpriseDataTable
        columns={columns}
        emptyMessage={loading ? 'Loading machine records...' : 'No matching machines found.'}
        getSearchText={(row) => [row.id, row.machine_name, row.model, row.serial_number, row.machine_barcode, row.branch, row.status, row.condition, row.criticality, row.custody_status, row.current_custodian, getCustomerName(row)].join(' ')}
        initialSearch={focusedMachineId}
        rowKey={(row) => row.id}
        rows={machines}
        searchPlaceholder="Search machine, customer, model, serial, condition or custodian"
      />
    </div>
  );
}
