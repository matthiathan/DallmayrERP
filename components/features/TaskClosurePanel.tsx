'use client';

import { FormEvent, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { recordAuditEvent } from '@/lib/data/audit';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isExactMachineMatch, machineSearchLabel, normaliseLookupTerm, rankMachineMatches } from '@/lib/search/machineSearch';
import type { Branch } from '@/types/dallmayrerp';

type TaskType = 'technician' | 'road_technician' | 'service_call' | 'preventive_service';
type Outcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';
type CustomerRelation = { customer_name: string | null; address: string | null; branch: Branch | null };
type SiteRelation = { site_name: string | null; address: string | null; branch: Branch | null };
type MachineLookup = {
  id: string;
  branch: Branch;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
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
  const [machineCandidates, setMachineCandidates] = useState<MachineLookup[]>([]);
  const [machineLookupMessage, setMachineLookupMessage] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lookupRequestRef = useRef(0);

  function applyCustomer(customer: CustomerOption | null) {
    if (!customer) {
      setCustomerName('');
      return;
    }

    setCustomerName(customer.customer_name);
    setBranch(customer.branch);
    if (customer.address) setSiteAddress(customer.address);
  }

  function applyMachine(machine: MachineLookup, lookupTerm: string) {
    const customer = firstRelation(machine.customers);
    const site = firstRelation(machine.customer_sites);
    const canonicalCode = machine.machine_barcode ?? machine.serial_number ?? lookupTerm;

    setMachineLookup(machine);
    setMachineCandidates([]);
    setMachineBarcode(canonicalCode);
    setBranch((site?.branch ?? customer?.branch ?? machine.branch) as Branch);
    if (customer?.customer_name) setCustomerName(customer.customer_name);
    if (site?.address || customer?.address) setSiteAddress(site?.address ?? customer?.address ?? '');
    setMachineLookupMessage(`Machine selected: ${machineSearchLabel(machine)}. The stored barcode, customer and site details were used where available.`);
  }

  async function resolveMachine(value: string) {
    const cleanValue = normaliseLookupTerm(value);
    const requestId = ++lookupRequestRef.current;
    setMachineBarcode(cleanValue);
    setMachineLookup(null);
    setMachineCandidates([]);
    setMachineLookupMessage(null);
    setError(null);
    if (!cleanValue) return;

    if (cleanValue.length < 2) {
      setMachineLookupMessage('Enter at least two characters from the machine barcode, serial number or name.');
      return;
    }

    const pattern = `%${cleanValue}%`;
    const { data, error: lookupError } = await getSupabaseClient()
      .from('machines')
      .select('id, branch, machine_name, model, serial_number, machine_barcode, status, customers(customer_name, address, branch), customer_sites(site_name, address, branch)')
      .or(`machine_barcode.ilike.${pattern},serial_number.ilike.${pattern},machine_name.ilike.${pattern},model.ilike.${pattern}`)
      .limit(12);

    if (requestId !== lookupRequestRef.current) return;

    if (lookupError) {
      setMachineLookupMessage(`Machine lookup failed: ${lookupError.message}`);
      return;
    }

    const rankedMatches = rankMachineMatches((data ?? []) as MachineLookup[], cleanValue);
    const exactMatch = rankedMatches.find((machine) => isExactMachineMatch(machine, cleanValue));

    if (exactMatch) {
      applyMachine(exactMatch, cleanValue);
      return;
    }

    if (rankedMatches.length === 1) {
      applyMachine(rankedMatches[0], cleanValue);
      return;
    }

    if (rankedMatches.length > 1) {
      setMachineCandidates(rankedMatches);
      setMachineLookupMessage(`${rankedMatches.length} machines contain “${cleanValue}”. Choose the correct machine before closing the task.`);
      return;
    }

    setMachineLookupMessage('No machine contains that barcode, serial number or name. Check the entry, try fewer characters, or create the machine from Operations → Machine Assets.');
  }

  async function closeTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser) return;
    if (machineCandidates.length > 0 && !machineLookup) {
      setError('Choose the correct machine from the partial matches before closing the task.');
      return;
    }

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
    setMachineCandidates([]);
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
      <p>Scan the machine QR/barcode or enter any distinctive part of the barcode, serial number or machine name. Partial matches are shown for confirmation.</p>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}
      <form className="grid" onSubmit={closeTask}>
        <div className="form-grid">
          <label>Branch
            <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>
              <option value="jhb">JHB</option><option value="cpt">CPT</option><option value="kzn">KZN</option><option value="national">National</option>
            </select>
          </label>
          <CustomerSelect value={customerName} onSelect={applyCustomer} />
          <label>Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
              {outcomes.map((item) => <option key={item}>{item.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <BarcodeCapture label="Machine QR / barcode / serial" value={machineBarcode} onChange={resolveMachine} />
        {machineLookupMessage ? <div aria-live="polite" className={machineLookup ? 'success' : 'field-note danger'}>{machineLookupMessage}</div> : null}
        {machineCandidates.length > 0 ? (
          <div className="machine-match-options">
            <p>Several machines match this partial entry. Select one to use its stored barcode and customer details.</p>
            <div className="machine-match-list">
              {machineCandidates.map((machine) => (
                <button className="machine-match-option" key={machine.id} onClick={() => applyMachine(machine, machineBarcode)} type="button">
                  <strong>{machineSearchLabel(machine)}</strong>
                  <span>{machine.serial_number ?? 'No serial'} • {machine.machine_barcode ?? 'No barcode'}</span>
                  <small>{machine.model ?? 'Model not set'} • {machine.branch.toUpperCase()}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <label>Site address<input value={siteAddress} onChange={(event) => setSiteAddress(event.target.value)} /></label>
        <label>Closure notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>Closure photo<input accept="image/*" capture="environment" type="file" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
        <button className="button pulse-button" disabled={saving || !machineBarcode.trim() || machineCandidates.length > 0} type="submit">{saving ? 'Closing task...' : 'Close task'}</button>
      </form>
    </div>
  );
}
