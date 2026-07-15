'use client';

import { FormEvent, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { recordAuditEvent } from '@/lib/data/audit';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type TaskType = 'technician' | 'road_technician' | 'service_call' | 'preventive_service';
type Outcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';
type CustomerRelation = { customer_name: string | null; address: string | null; branch: Branch | null };
type SiteRelation = { site_name: string | null; address: string | null; branch: Branch | null };
type MachineLookup = {
  id: string;
  branch: Branch;
  machine_name: string | null;
  serial_number: string | null;
  status: string | null;
  customers?: CustomerRelation | CustomerRelation[] | null;
  customer_sites?: SiteRelation | SiteRelation[] | null;
};

const outcomes: Outcome[] = ['completed', 'follow_up_required', 'parts_required', 'customer_unavailable'];

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

export function TaskClosurePanel({ taskType, defaultBranch }: { taskType: TaskType; defaultBranch?: Branch }) {
  const { businessUser, userDetails } = useAuth();
  const [branch, setBranch] = useState<Branch>(defaultBranch ?? userDetails?.branch ?? 'jhb');
  const [machineBarcode, setMachineBarcode] = useState('');
  const [machineLookup, setMachineLookup] = useState<MachineLookup | null>(null);
  const [machineLookupMessage, setMachineLookupMessage] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function applyCustomer(customer: CustomerOption | null) {
    if (!customer) {
      setCustomerName('');
      return;
    }

    setCustomerName(customer.customer_name);
    setBranch(customer.branch);
    if (customer.address) setSiteAddress(customer.address);
  }

  async function resolveMachine(value: string) {
    const cleanValue = value.trim();
    setMachineBarcode(cleanValue);
    setMachineLookup(null);
    setMachineLookupMessage(null);
    if (!cleanValue) return;

    const { data, error: lookupError } = await getSupabaseClient()
      .from('machines')
      .select('id, branch, machine_name, serial_number, status, customers(customer_name, address, branch), customer_sites(site_name, address, branch)')
      .eq('machine_barcode', cleanValue)
      .maybeSingle();

    if (lookupError) {
      setMachineLookupMessage(`Machine lookup failed: ${lookupError.message}`);
      return;
    }

    if (data) {
      const machine = data as MachineLookup;
      const customer = firstRelation(machine.customers);
      const site = firstRelation(machine.customer_sites);
      setMachineLookup(machine);
      setBranch((site?.branch ?? customer?.branch ?? machine.branch) as Branch);
      if (customer?.customer_name) setCustomerName(customer.customer_name);
      if (site?.address || customer?.address) setSiteAddress(site?.address ?? customer?.address ?? '');
      setMachineLookupMessage(`Machine found: ${machine.machine_name ?? machine.serial_number ?? cleanValue}. Customer and site details were auto-filled where available.`);
      return;
    }

    setMachineLookupMessage('Machine QR/barcode not found yet. You can still close the task, then create the machine from Operations → Machine Assets.');
  }

  async function closeTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    const client = getSupabaseClient();
    let photoPath: string | null = null;

    if (photo) {
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      photoPath = `${taskType}/${businessUser.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await client.storage.from('dallmayrerp-task-photos').upload(photoPath, photo, { upsert: false });
      if (uploadError) {
        setSaving(false);
        setError(uploadError.message);
        return;
      }
    }

    const { data: closure, error: closureError } = await client
      .from('task_closures')
      .insert({
        task_type: taskType,
        branch,
        machine_barcode: machineBarcode.trim(),
        customer_name: customerName.trim() || null,
        site_address: siteAddress.trim() || null,
        outcome,
        notes: notes.trim() || null,
        photo_bucket: photoPath ? 'dallmayrerp-task-photos' : null,
        photo_path: photoPath,
        closed_by: businessUser.id,
      })
      .select('*')
      .single();

    if (closureError) {
      setSaving(false);
      setError(closureError.message);
      return;
    }

    const { error: scanError } = await client.from('stock_scan_events').insert({
      barcode: machineBarcode.trim(),
      scan_type: 'task_close',
      branch,
      quantity: 1,
      related_task_closure_id: closure.id,
      scanned_by: businessUser.id,
      notes: `Task closure outcome: ${outcome}`,
    });

    if (scanError) {
      setSaving(false);
      setError(`Task closed, but the machine scan event failed: ${scanError.message}`);
      return;
    }

    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch,
      entityType: 'task_closure',
      entityId: closure.id,
      action: 'task_closed',
      summary: `${taskType} task closed for machine ${machineBarcode.trim()} with outcome ${outcome}.`,
      afterPayload: {
        task_type: taskType,
        machine_barcode: machineBarcode.trim(),
        machine_id: machineLookup?.id ?? null,
        serial_number: machineLookup?.serial_number ?? null,
        customer_name: customerName.trim() || null,
        site_address: siteAddress.trim() || null,
        outcome,
        photo_path: photoPath,
      },
    });

    setSaving(false);
    setMachineBarcode('');
    setMachineLookup(null);
    setMachineLookupMessage(null);
    setCustomerName('');
    setSiteAddress('');
    setOutcome('completed');
    setNotes('');
    setPhoto(null);
    setSuccess('Task closed, machine scan recorded, and audit event captured.');
  }

  return (
    <div className="neo-card">
      <h2>Close task with machine scan and photo</h2>
      <p>Scan the machine QR/barcode, capture proof/photo evidence, and close the job from mobile or desktop.</p>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}
      <form className="grid" onSubmit={closeTask}>
        <div className="form-grid">
          <label>Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
              <option value="jhb">jhb</option><option value="cpt">cpt</option><option value="kzn">kzn</option><option value="national">national</option>
            </select>
          </label>
          <CustomerSelect value={customerName} onSelect={applyCustomer} />
          <label>Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
              {outcomes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <BarcodeCapture label="Machine QR / barcode" value={machineBarcode} onChange={resolveMachine} />
        {machineLookupMessage ? <div className={machineLookup ? 'success' : 'badge warning'}>{machineLookupMessage}</div> : null}
        <label>Site address<input value={siteAddress} onChange={(event) => setSiteAddress(event.target.value)} /></label>
        <label>Closure notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>Closure photo<input accept="image/*" capture="environment" type="file" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
        <button className="button pulse-button" disabled={saving || !machineBarcode.trim()} type="submit">{saving ? 'Closing task...' : 'Close task'}</button>
      </form>
    </div>
  );
}
