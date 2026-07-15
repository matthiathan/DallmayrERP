'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { getSupabaseClient } from '@/lib/supabase/client';
import { recordAuditEvent } from '@/lib/data/audit';
import type { Branch } from '@/types/dallmayrerp';

type MachineStatus = 'active' | 'inactive' | 'in_service' | 'removed' | 'archived';
type MachineRow = {
  id: string;
  branch: Branch;
  asset_number: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  machine_name: string | null;
  status: MachineStatus;
  created_at: string;
};

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const statuses: MachineStatus[] = ['active', 'inactive', 'in_service', 'removed', 'archived'];

export function MachineAssetBoard() {
  const { businessUser, userDetails } = useAuth();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [machineName, setMachineName] = useState('');
  const [assetNumber, setAssetNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [machineBarcode, setMachineBarcode] = useState('');
  const [status, setStatus] = useState<MachineStatus>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadMachines() {
    const { data, error: loadError } = await getSupabaseClient()
      .from('machines')
      .select('id, branch, asset_number, serial_number, machine_barcode, machine_name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(150);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setMachines((data ?? []) as MachineRow[]);
  }

  useEffect(() => {
    loadMachines();
  }, []);

  async function createMachine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const client = getSupabaseClient();
    const { data, error: createError } = await client.from('machines').insert({
      branch,
      machine_name: machineName.trim() || null,
      asset_number: assetNumber.trim() || null,
      serial_number: serialNumber.trim() || null,
      machine_barcode: machineBarcode.trim() || null,
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
      summary: `Machine asset created: ${machineName || machineBarcode || assetNumber || 'Unnamed machine'}.`,
      afterPayload: { branch, machine_name: machineName, asset_number: assetNumber, serial_number: serialNumber, machine_barcode: machineBarcode, status },
    });

    setMessage('Machine asset created.');
    setMachineName('');
    setAssetNumber('');
    setSerialNumber('');
    setMachineBarcode('');
    setStatus('active');
    await loadMachines();
  }

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="neo-card spatial-machine-panel spatial-card">
        <h2>Machine / asset profiles</h2>
        <p>Create machine profile records that can later link to customers, sites, contracts, service history and technician closure evidence.</p>
        <form className="grid" onSubmit={createMachine}>
          <div className="form-grid">
            <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Machine name<input value={machineName} onChange={(event) => setMachineName(event.target.value)} /></label>
            <label>Asset number<input value={assetNumber} onChange={(event) => setAssetNumber(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Serial number<input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label>
            <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MachineStatus)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <BarcodeCapture label="Machine barcode" value={machineBarcode} onChange={setMachineBarcode} />
          <button className="button pulse-button" disabled={saving || (!machineName.trim() && !machineBarcode.trim() && !assetNumber.trim())} type="submit">{saving ? 'Creating asset...' : 'Create machine asset'}</button>
        </form>
      </div>
      <div className="table-wrap">
        <table><thead><tr><th>Machine</th><th>Branch</th><th>Barcode</th><th>Asset number</th><th>Serial</th><th>Status</th></tr></thead>
          <tbody>{machines.length === 0 ? <tr><td colSpan={6}>No machine assets yet.</td></tr> : machines.map((machine) => <tr key={machine.id}><td>{machine.machine_name ?? 'Unnamed machine'}</td><td>{machine.branch}</td><td>{machine.machine_barcode ?? '-'}</td><td>{machine.asset_number ?? '-'}</td><td>{machine.serial_number ?? '-'}</td><td>{machine.status}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
