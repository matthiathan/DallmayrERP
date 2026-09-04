'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';

type CustomerRecord = {
  id: string;
  customer_name: string;
  branch: string;
  status: string;
};

type ImportRow = {
  rowNumber: number;
  assetName: string;
  clientName: string;
  serialNumber: string;
  qrCodeNumber: string;
  customerId: string | null;
  branch: string | null;
  errors: string[];
};

type Props = {
  onChanged: () => Promise<void> | void;
};

const CUSTOMER_PAGE_SIZE = 1000;
const MACHINE_PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 100;

function normaliseName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-ZA');
}

function normaliseHeader(value: string) {
  return value.trim().toLocaleLowerCase('en-ZA').replace(/[^a-z0-9]/g, '');
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

async function loadCustomers() {
  const client = getSupabaseClient();
  const rows: CustomerRecord[] = [];
  for (let from = 0; ; from += CUSTOMER_PAGE_SIZE) {
    const { data, error } = await client
      .from('customers')
      .select('id,customer_name,branch,status')
      .eq('status', 'active')
      .order('customer_name', { ascending: true })
      .range(from, from + CUSTOMER_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as CustomerRecord[];
    rows.push(...page);
    if (page.length < CUSTOMER_PAGE_SIZE) break;
  }
  return rows;
}

async function loadExistingIdentifiers() {
  const client = getSupabaseClient();
  const serials = new Set<string>();
  const qrCodes = new Set<string>();
  for (let from = 0; ; from += MACHINE_PAGE_SIZE) {
    const { data, error } = await client
      .from('machines')
      .select('serial_number,machine_barcode')
      .order('id', { ascending: true })
      .range(from, from + MACHINE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as { serial_number: string | null; machine_barcode: string | null }[];
    page.forEach((machine) => {
      if (machine.serial_number?.trim()) serials.add(machine.serial_number.trim().toLocaleLowerCase('en-ZA'));
      if (machine.machine_barcode?.trim()) qrCodes.add(machine.machine_barcode.trim().toLocaleLowerCase('en-ZA'));
    });
    if (page.length < MACHINE_PAGE_SIZE) break;
  }
  return { serials, qrCodes };
}

function customerIndex(customers: CustomerRecord[]) {
  const index = new Map<string, CustomerRecord[]>();
  customers.forEach((customer) => {
    const key = normaliseName(customer.customer_name);
    index.set(key, [...(index.get(key) ?? []), customer]);
  });
  return index;
}

export function MachineCreateImportControls({ onChanged }: Props) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [qrCodeNumber, setQrCodeNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const validImportRows = useMemo(() => importRows.filter((row) => row.errors.length === 0), [importRows]);
  const invalidImportRows = importRows.length - validImportRows.length;

  async function ensureCustomers() {
    if (customers.length > 0) return customers;
    setCustomersLoading(true);
    try {
      const loaded = await loadCustomers();
      setCustomers(loaded);
      return loaded;
    } finally {
      setCustomersLoading(false);
    }
  }

  async function openCreate() {
    setError(null);
    setSuccess(null);
    setCreateOpen(true);
    try {
      await ensureCustomers();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Clients could not be loaded.');
    }
  }

  async function openImport() {
    setError(null);
    setSuccess(null);
    setImportRows([]);
    setFileName('');
    setImportOpen(true);
    try {
      await ensureCustomers();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Clients could not be loaded.');
    }
  }

  function resetCreate() {
    setAssetName('');
    setCustomerId('');
    setSerialNumber('');
    setQrCodeNumber('');
    setError(null);
  }

  async function createMachine(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const asset = assetName.trim();
    const serial = serialNumber.trim();
    const qr = qrCodeNumber.trim();
    const customer = customers.find((item) => item.id === customerId);
    if (!asset || !customer || !serial || !qr) {
      setError('Asset Name, Client Name, Serial Number and QR Code Number are all required.');
      return;
    }

    setSaving(true);
    try {
      const client = getSupabaseClient();
      const { data: duplicates, error: duplicateError } = await client
        .from('machines')
        .select('id,serial_number,machine_barcode')
        .or(`serial_number.eq.${serial},machine_barcode.eq.${qr}`)
        .limit(5);
      if (duplicateError) throw duplicateError;
      const duplicateRows = (duplicates ?? []) as { serial_number: string | null; machine_barcode: string | null }[];
      if (duplicateRows.some((row) => row.machine_barcode === qr)) throw new Error(`QR Code Number ${qr} already belongs to another machine.`);
      if (duplicateRows.some((row) => row.serial_number === serial)) throw new Error(`Serial Number ${serial} already belongs to another machine.`);

      const { error: insertError } = await client.from('machines').insert({
        machine_name: asset,
        customer_id: customer.id,
        branch: customer.branch || 'national',
        serial_number: serial,
        machine_barcode: qr,
      });
      if (insertError) throw insertError;

      setSuccess(`${asset} was created successfully.`);
      resetCreate();
      setCreateOpen(false);
      await onChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The machine could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setSuccess(null);
    setImportRows([]);
    setFileName(file.name);

    try {
      const [text, loadedCustomers, existing] = await Promise.all([
        file.text(),
        ensureCustomers(),
        loadExistingIdentifiers(),
      ]);
      const csv = parseCsv(text.replace(/^\uFEFF/, ''));
      if (csv.length < 2) throw new Error('The CSV must contain a header row and at least one machine row.');

      const headers = csv[0].map(normaliseHeader);
      const required = {
        assetName: headers.indexOf('assetname'),
        clientName: headers.indexOf('clientname'),
        serialNumber: headers.indexOf('serialnumber'),
        qrCodeNumber: headers.indexOf('qrcodenumber'),
      };
      const missing = Object.entries(required).filter(([, index]) => index < 0).map(([key]) => ({
        assetName: 'Asset Name',
        clientName: 'Client Name',
        serialNumber: 'Serial Number',
        qrCodeNumber: 'QR Code Number',
      }[key as keyof typeof required]));
      if (missing.length) throw new Error(`Missing required CSV column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);

      const customersByName = customerIndex(loadedCustomers);
      const fileSerials = new Map<string, number>();
      const fileQrCodes = new Map<string, number>();
      const parsed = csv.slice(1).map((cells, rowIndex): ImportRow => {
        const asset = (cells[required.assetName] ?? '').trim();
        const clientName = (cells[required.clientName] ?? '').trim();
        const serial = (cells[required.serialNumber] ?? '').trim();
        const qr = (cells[required.qrCodeNumber] ?? '').trim();
        const errors: string[] = [];
        if (!asset) errors.push('Asset Name is required');
        if (!clientName) errors.push('Client Name is required');
        if (!serial) errors.push('Serial Number is required');
        if (!qr) errors.push('QR Code Number is required');

        const matches = clientName ? customersByName.get(normaliseName(clientName)) ?? [] : [];
        if (clientName && matches.length === 0) errors.push('Client Name was not found');
        if (matches.length > 1) errors.push('Client Name is ambiguous across branches');

        const serialKey = serial.toLocaleLowerCase('en-ZA');
        const qrKey = qr.toLocaleLowerCase('en-ZA');
        if (serial && existing.serials.has(serialKey)) errors.push('Serial Number already exists');
        if (qr && existing.qrCodes.has(qrKey)) errors.push('QR Code Number already exists');
        if (serial && fileSerials.has(serialKey)) errors.push(`Serial Number duplicates CSV row ${fileSerials.get(serialKey)}`);
        if (qr && fileQrCodes.has(qrKey)) errors.push(`QR Code Number duplicates CSV row ${fileQrCodes.get(qrKey)}`);
        if (serial && !fileSerials.has(serialKey)) fileSerials.set(serialKey, rowIndex + 2);
        if (qr && !fileQrCodes.has(qrKey)) fileQrCodes.set(qrKey, rowIndex + 2);

        return {
          rowNumber: rowIndex + 2,
          assetName: asset,
          clientName,
          serialNumber: serial,
          qrCodeNumber: qr,
          customerId: matches.length === 1 ? matches[0].id : null,
          branch: matches.length === 1 ? matches[0].branch : null,
          errors,
        };
      });

      setImportRows(parsed);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'The CSV could not be read.');
    }
  }

  async function importMachines() {
    if (importRows.length === 0 || invalidImportRows > 0) return;
    setError(null);
    setSuccess(null);
    setImporting(true);
    try {
      const client = getSupabaseClient();
      const payload = validImportRows.map((row) => ({
        machine_name: row.assetName,
        customer_id: row.customerId,
        branch: row.branch || 'national',
        serial_number: row.serialNumber,
        machine_barcode: row.qrCodeNumber,
      }));
      for (let from = 0; from < payload.length; from += INSERT_BATCH_SIZE) {
        const { error: insertError } = await client.from('machines').insert(payload.slice(from, from + INSERT_BATCH_SIZE));
        if (insertError) throw insertError;
      }
      setSuccess(`${payload.length.toLocaleString('en-ZA')} machine${payload.length === 1 ? '' : 's'} imported successfully.`);
      setImportRows([]);
      setFileName('');
      setImportOpen(false);
      if (fileRef.current) fileRef.current.value = '';
      await onChanged();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The machine import could not be completed.');
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['Asset Name,Client Name,Serial Number,QR Code Number\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'dallmayr-machine-import-template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button className="fleet-button secondary" onClick={openImport} type="button"><NavigationIcon kind="upload" />Bulk import</button>
      <button className="fleet-button" onClick={openCreate} type="button"><NavigationIcon kind="plus" />Create new machine</button>
      {success ? <span className="sr-only" role="status">{success}</span> : null}

      <AccessibleDialog ariaLabel="Create new machine" className="device-delete-dialog" id="create-machine-dialog" onClose={() => { if (!saving) { setCreateOpen(false); setError(null); } }} open={createOpen} closeOnBackdrop={!saving}>
        <header><div><div><h2>Create new machine</h2><p>Only the fields used by the telemetry fleet are required.</p></div></div><button aria-label="Close create machine dialog" disabled={saving} onClick={() => setCreateOpen(false)} type="button">×</button></header>
        <form onSubmit={createMachine}>
          <div className="device-delete-dialog-body">
            {error ? <div className="fleet-banner is-error" role="alert"><strong>Machine could not be created.</strong><span>{error}</span></div> : null}
            <label><span>Asset Name</span><input data-dialog-initial-focus maxLength={160} onChange={(event) => setAssetName(event.target.value)} placeholder="e.g. Reception Belluno" required value={assetName} /></label>
            <label><span>Client Name</span><select disabled={customersLoading} onChange={(event) => setCustomerId(event.target.value)} required value={customerId}><option value="">{customersLoading ? 'Loading clients…' : 'Select client'}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name} · {customer.branch.toUpperCase()}</option>)}</select></label>
            <label><span>Serial Number</span><input maxLength={120} onChange={(event) => setSerialNumber(event.target.value)} required value={serialNumber} /></label>
            <label><span>QR Code Number</span><input maxLength={120} onChange={(event) => setQrCodeNumber(event.target.value)} required value={qrCodeNumber} /></label>
          </div>
          <footer><button className="fleet-button secondary" disabled={saving} onClick={() => { setCreateOpen(false); resetCreate(); }} type="button">Cancel</button><button className="fleet-button" disabled={saving || customersLoading} type="submit">{saving ? 'Creating…' : 'Create machine'}</button></footer>
        </form>
      </AccessibleDialog>

      <AccessibleDialog ariaLabel="Bulk import machines" className="device-delete-dialog" id="bulk-import-machines-dialog" onClose={() => { if (!importing) { setImportOpen(false); setError(null); } }} open={importOpen} closeOnBackdrop={!importing}>
        <header><div><div><h2>Bulk import machines</h2><p>Upload a CSV using the four approved machine fields.</p></div></div><button aria-label="Close bulk import dialog" disabled={importing} onClick={() => setImportOpen(false)} type="button">×</button></header>
        <div className="device-delete-dialog-body">
          {error ? <div className="fleet-banner is-error" role="alert"><strong>Import needs attention.</strong><span>{error}</span></div> : null}
          <div className="fleet-heading-actions"><button className="fleet-button secondary" onClick={downloadTemplate} type="button">Download CSV template</button><label className="fleet-button"><input accept=".csv,text/csv" className="sr-only" disabled={customersLoading || importing} onChange={(event) => handleFile(event.target.files?.[0] ?? null)} ref={fileRef} type="file" />Choose CSV</label></div>
          <p><strong>{fileName || 'No CSV selected'}</strong></p>
          {importRows.length > 0 ? <>
            <div className={`fleet-banner ${invalidImportRows > 0 ? 'is-error' : 'is-success'}`} role="status"><strong>{validImportRows.length.toLocaleString('en-ZA')} valid · {invalidImportRows.toLocaleString('en-ZA')} invalid</strong><span>{invalidImportRows > 0 ? 'Correct every invalid row before importing. Nothing has been written yet.' : 'All rows are validated and ready to import.'}</span></div>
            <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Row</th><th>Asset Name</th><th>Client Name</th><th>Serial Number</th><th>QR Code Number</th><th>Validation</th></tr></thead><tbody>{importRows.slice(0, 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.assetName || '—'}</td><td>{row.clientName || '—'}</td><td>{row.serialNumber || '—'}</td><td>{row.qrCodeNumber || '—'}</td><td>{row.errors.length ? <span className="fleet-alert-severity is-fault">{row.errors.join(' · ')}</span> : <span className="fleet-status-pill is-success"><i />Ready</span>}</td></tr>)}</tbody></table></div>
            {importRows.length > 100 ? <p>Previewing the first 100 of {importRows.length.toLocaleString('en-ZA')} rows. All rows were validated.</p> : null}
          </> : <div className="fleet-empty-state"><strong>CSV columns</strong><p>Asset Name, Client Name, Serial Number, QR Code Number. Client names must match an existing active client exactly.</p></div>}
        </div>
        <footer><button className="fleet-button secondary" disabled={importing} onClick={() => setImportOpen(false)} type="button">Cancel</button><button className="fleet-button" disabled={importing || importRows.length === 0 || invalidImportRows > 0} onClick={importMachines} type="button">{importing ? 'Importing…' : `Import ${validImportRows.length.toLocaleString('en-ZA')} machine${validImportRows.length === 1 ? '' : 's'}`}</button></footer>
      </AccessibleDialog>
    </>
  );
}
