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

type SiteRecord = {
  id: string;
  customer_id: string;
  branch: string;
  site_name: string;
  address: string | null;
  status: string;
};

type ImportRow = {
  rowNumber: number;
  assetName: string;
  machineType: string;
  brand: string;
  clientName: string;
  siteName: string;
  serialNumber: string;
  qrCodeNumber: string;
  customerId: string | null;
  siteId: string | null;
  branch: string | null;
  errors: string[];
};

type Props = {
  onChanged: () => Promise<void> | void;
};

const CUSTOMER_PAGE_SIZE = 1000;
const SITE_PAGE_SIZE = 1000;
const MACHINE_PAGE_SIZE = 1000;
const MAX_IMPORT_ROWS = 5000;

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

function csvCell(value: string | number) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

async function loadSites() {
  const client = getSupabaseClient();
  const rows: SiteRecord[] = [];
  for (let from = 0; ; from += SITE_PAGE_SIZE) {
    const { data, error } = await client
      .from('customer_sites')
      .select('id,customer_id,branch,site_name,address,status')
      .eq('status', 'active')
      .order('site_name', { ascending: true })
      .range(from, from + SITE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as SiteRecord[];
    rows.push(...page);
    if (page.length < SITE_PAGE_SIZE) break;
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

function siteIndex(sites: SiteRecord[]) {
  const index = new Map<string, SiteRecord[]>();
  sites.forEach((site) => {
    const key = `${site.customer_id}:${normaliseName(site.site_name)}`;
    index.set(key, [...(index.get(key) ?? []), site]);
  });
  return index;
}

export function MachineCreateImportControls({ onChanged }: Props) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [machineType, setMachineType] = useState('');
  const [brand, setBrand] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
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
  const customerSites = useMemo(() => sites.filter((site) => site.customer_id === customerId), [customerId, sites]);

  async function ensureReferenceData() {
    if (customers.length > 0 && sites.length > 0) return { customers, sites };
    setReferenceLoading(true);
    try {
      const [loadedCustomers, loadedSites] = await Promise.all([
        customers.length ? Promise.resolve(customers) : loadCustomers(),
        sites.length ? Promise.resolve(sites) : loadSites(),
      ]);
      setCustomers(loadedCustomers);
      setSites(loadedSites);
      return { customers: loadedCustomers, sites: loadedSites };
    } finally {
      setReferenceLoading(false);
    }
  }

  async function openCreate() {
    setError(null);
    setSuccess(null);
    setCreateOpen(true);
    try {
      await ensureReferenceData();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Clients and sites could not be loaded.');
    }
  }

  async function openImport() {
    setError(null);
    setSuccess(null);
    setImportRows([]);
    setFileName('');
    setImportOpen(true);
    try {
      await ensureReferenceData();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Clients and sites could not be loaded.');
    }
  }

  function resetCreate() {
    setAssetName('');
    setMachineType('');
    setBrand('');
    setCustomerId('');
    setSiteId('');
    setSerialNumber('');
    setQrCodeNumber('');
    setError(null);
  }

  async function createMachine(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const asset = assetName.trim();
    const model = machineType.trim();
    const manufacturer = brand.trim();
    const serial = serialNumber.trim();
    const qr = qrCodeNumber.trim();
    const customer = customers.find((item) => item.id === customerId);
    const site = siteId ? sites.find((item) => item.id === siteId && item.customer_id === customerId) : null;
    if (!asset || !model || !manufacturer || !customer || !serial || !qr) {
      setError('Asset Name, Machine Type, Brand, Client Name, Serial Number and QR Code Number are required.');
      return;
    }
    if (siteId && !site) {
      setError('The selected site does not belong to the selected client.');
      return;
    }

    setSaving(true);
    try {
      const client = getSupabaseClient();
      const [serialResult, qrResult] = await Promise.all([
        client.from('machines').select('id').eq('serial_number', serial).limit(1),
        client.from('machines').select('id').eq('machine_barcode', qr).limit(1),
      ]);
      if (serialResult.error) throw serialResult.error;
      if (qrResult.error) throw qrResult.error;
      if ((serialResult.data ?? []).length > 0) throw new Error(`Serial Number ${serial} already belongs to another machine.`);
      if ((qrResult.data ?? []).length > 0) throw new Error(`QR Code Number ${qr} already belongs to another machine.`);

      const { error: insertError } = await client.from('machines').insert({
        machine_name: asset,
        model,
        manufacturer,
        customer_id: customer.id,
        site_id: site?.id ?? null,
        branch: site?.branch || customer.branch || 'national',
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
      const [text, reference, existing] = await Promise.all([
        file.text(),
        ensureReferenceData(),
        loadExistingIdentifiers(),
      ]);
      const csv = parseCsv(text.replace(/^\uFEFF/, ''));
      if (csv.length < 2) throw new Error('The CSV must contain a header row and at least one machine row.');
      if (csv.length - 1 > MAX_IMPORT_ROWS) throw new Error(`A single import can contain at most ${MAX_IMPORT_ROWS.toLocaleString('en-ZA')} machines.`);

      const headers = csv[0].map(normaliseHeader);
      const required = {
        assetName: headers.indexOf('assetname'),
        clientName: headers.indexOf('clientname'),
        serialNumber: headers.indexOf('serialnumber'),
        qrCodeNumber: headers.indexOf('qrcodenumber'),
      };
      const optional = {
        machineType: Math.max(headers.indexOf('machinetype'), headers.indexOf('model')),
        brand: Math.max(headers.indexOf('brand'), headers.indexOf('manufacturer')),
        siteName: Math.max(headers.indexOf('sitename'), headers.indexOf('location')),
      };
      const labels = {
        assetName: 'Asset Name',
        clientName: 'Client Name',
        serialNumber: 'Serial Number',
        qrCodeNumber: 'QR Code Number',
      };
      const missing = (Object.keys(required) as (keyof typeof required)[]).filter((key) => required[key] < 0).map((key) => labels[key]);
      if (missing.length) throw new Error(`Missing required CSV column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);

      const customersByName = customerIndex(reference.customers);
      const sitesByCustomerAndName = siteIndex(reference.sites);
      const fileSerials = new Map<string, number>();
      const fileQrCodes = new Map<string, number>();
      const parsed = csv.slice(1).map((cells, rowIndex): ImportRow => {
        const asset = (cells[required.assetName] ?? '').trim();
        const model = optional.machineType >= 0 ? (cells[optional.machineType] ?? '').trim() : '';
        const manufacturer = optional.brand >= 0 ? (cells[optional.brand] ?? '').trim() : '';
        const clientName = (cells[required.clientName] ?? '').trim();
        const siteName = optional.siteName >= 0 ? (cells[optional.siteName] ?? '').trim() : '';
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
        const customer = matches.length === 1 ? matches[0] : null;

        let site: SiteRecord | null = null;
        if (siteName && customer) {
          const siteMatches = sitesByCustomerAndName.get(`${customer.id}:${normaliseName(siteName)}`) ?? [];
          if (siteMatches.length === 0) errors.push('Site Name was not found for this client');
          if (siteMatches.length > 1) errors.push('Site Name is ambiguous for this client');
          if (siteMatches.length === 1) site = siteMatches[0];
        }

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
          machineType: model,
          brand: manufacturer,
          clientName,
          siteName,
          serialNumber: serial,
          qrCodeNumber: qr,
          customerId: customer?.id ?? null,
          siteId: site?.id ?? null,
          branch: site?.branch || customer?.branch || null,
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
      const payload = validImportRows.map((row) => ({
        machine_name: row.assetName,
        model: row.machineType || null,
        manufacturer: row.brand || null,
        customer_id: row.customerId,
        site_id: row.siteId,
        branch: row.branch || 'national',
        serial_number: row.serialNumber,
        machine_barcode: row.qrCodeNumber,
      }));
      const { error: insertError } = await getSupabaseClient().from('machines').insert(payload);
      if (insertError) throw insertError;

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
    downloadCsv('dallmayr-machine-import-template.csv', [
      ['Asset Name', 'Machine Type', 'Brand', 'Client Name', 'Site Name', 'Serial Number', 'QR Code Number'],
      ['Reception machine', 'SIELAFF BELLUNO', 'Sielaff', 'Example Client', 'Head Office', 'SERIAL-001', 'QR-001'],
    ]);
  }

  function downloadImportErrors() {
    const invalid = importRows.filter((row) => row.errors.length > 0);
    if (!invalid.length) return;
    downloadCsv('dallmayr-machine-import-errors.csv', [
      ['CSV Row', 'Asset Name', 'Machine Type', 'Brand', 'Client Name', 'Site Name', 'Serial Number', 'QR Code Number', 'Validation Errors'],
      ...invalid.map((row) => [row.rowNumber, row.assetName, row.machineType, row.brand, row.clientName, row.siteName, row.serialNumber, row.qrCodeNumber, row.errors.join(' | ')]),
    ]);
  }

  return (
    <>
      <button className="fleet-button secondary" onClick={openImport} type="button"><NavigationIcon kind="box" />Bulk import</button>
      <button className="fleet-button" onClick={openCreate} type="button"><NavigationIcon kind="tool" />Create new machine</button>
      {success ? <span className="sr-only" role="status">{success}</span> : null}

      <AccessibleDialog ariaLabel="Create new machine" className="device-delete-dialog" id="create-machine-dialog" onClose={() => { if (!saving) { setCreateOpen(false); setError(null); } }} open={createOpen} closeOnBackdrop={!saving}>
        <header><div><div><h2>Create new machine</h2><p>Create the telemetry-facing machine record and optionally assign its site.</p></div></div><button aria-label="Close create machine dialog" disabled={saving} onClick={() => setCreateOpen(false)} type="button">×</button></header>
        <form onSubmit={createMachine}>
          <div className="device-delete-dialog-body">
            {error ? <div className="fleet-banner is-error" role="alert"><strong>Machine could not be created.</strong><span>{error}</span></div> : null}
            <label><span>Asset Name</span><input data-dialog-initial-focus maxLength={160} onChange={(event) => setAssetName(event.target.value)} placeholder="e.g. Reception Belluno" required value={assetName} /></label>
            <label><span>Machine Type / Model</span><input maxLength={160} onChange={(event) => setMachineType(event.target.value)} placeholder="e.g. SIELAFF BELLUNO" required value={machineType} /></label>
            <label><span>Brand / Manufacturer</span><input maxLength={160} onChange={(event) => setBrand(event.target.value)} placeholder="e.g. Sielaff" required value={brand} /></label>
            <label><span>Client Name</span><select disabled={referenceLoading} onChange={(event) => { setCustomerId(event.target.value); setSiteId(''); }} required value={customerId}><option value="">{referenceLoading ? 'Loading clients…' : 'Select client'}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name} · {customer.branch.toUpperCase()}</option>)}</select></label>
            <label><span>Site / Location</span><select disabled={referenceLoading || !customerId} onChange={(event) => setSiteId(event.target.value)} value={siteId}><option value="">{!customerId ? 'Select client first' : customerSites.length ? 'No site assigned' : 'No active sites for this client'}</option>{customerSites.map((site) => <option key={site.id} value={site.id}>{site.site_name}{site.address ? ` · ${site.address}` : ''}</option>)}</select></label>
            <label><span>Serial Number</span><input maxLength={120} onChange={(event) => setSerialNumber(event.target.value)} required value={serialNumber} /></label>
            <label><span>QR Code Number</span><input maxLength={120} onChange={(event) => setQrCodeNumber(event.target.value)} required value={qrCodeNumber} /></label>
          </div>
          <footer><button className="fleet-button secondary" disabled={saving} onClick={() => { setCreateOpen(false); resetCreate(); }} type="button">Cancel</button><button className="fleet-button" disabled={saving || referenceLoading} type="submit">{saving ? 'Creating…' : 'Create machine'}</button></footer>
        </form>
      </AccessibleDialog>

      <AccessibleDialog ariaLabel="Bulk import machines" className="device-delete-dialog" id="bulk-import-machines-dialog" onClose={() => { if (!importing) { setImportOpen(false); setError(null); } }} open={importOpen} closeOnBackdrop={!importing}>
        <header><div><div><h2>Bulk import machines</h2><p>Validate up to {MAX_IMPORT_ROWS.toLocaleString('en-ZA')} machines before anything is written.</p></div></div><button aria-label="Close bulk import dialog" disabled={importing} onClick={() => setImportOpen(false)} type="button">×</button></header>
        <div className="device-delete-dialog-body">
          {error ? <div className="fleet-banner is-error" role="alert"><strong>Import needs attention.</strong><span>{error}</span></div> : null}
          <div className="fleet-heading-actions"><button className="fleet-button secondary" onClick={downloadTemplate} type="button">Download CSV template</button>{invalidImportRows > 0 ? <button className="fleet-button secondary" onClick={downloadImportErrors} type="button">Download error report</button> : null}<label className="fleet-button"><input accept=".csv,text/csv" className="sr-only" disabled={referenceLoading || importing} onChange={(event) => handleFile(event.target.files?.[0] ?? null)} ref={fileRef} type="file" />Choose CSV</label></div>
          <p><strong>{fileName || 'No CSV selected'}</strong></p>
          {importRows.length > 0 ? <>
            <div className={`fleet-banner ${invalidImportRows > 0 ? 'is-error' : 'is-success'}`} role="status"><strong>{validImportRows.length.toLocaleString('en-ZA')} valid · {invalidImportRows.toLocaleString('en-ZA')} invalid</strong><span>{invalidImportRows > 0 ? 'Correct every invalid row before importing. Download the error report for the complete list.' : 'All rows are validated and ready to import.'}</span></div>
            <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Row</th><th>Asset Name</th><th>Type / Model</th><th>Brand</th><th>Client</th><th>Site</th><th>Serial</th><th>QR</th><th>Validation</th></tr></thead><tbody>{importRows.slice(0, 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.assetName || '—'}</td><td>{row.machineType || '—'}</td><td>{row.brand || '—'}</td><td>{row.clientName || '—'}</td><td>{row.siteName || '—'}</td><td>{row.serialNumber || '—'}</td><td>{row.qrCodeNumber || '—'}</td><td>{row.errors.length ? <span className="fleet-alert-severity is-fault">{row.errors.join(' · ')}</span> : <span className="fleet-status-pill is-success"><i />Ready</span>}</td></tr>)}</tbody></table></div>
            {importRows.length > 100 ? <p>Previewing the first 100 of {importRows.length.toLocaleString('en-ZA')} rows. All rows were validated.</p> : null}
          </> : <div className="fleet-empty-state"><strong>Required CSV columns</strong><p>Asset Name, Client Name, Serial Number and QR Code Number. Machine Type, Brand and Site Name are supported optional columns. Site Name is validated within the selected client.</p></div>}
        </div>
        <footer><button className="fleet-button secondary" disabled={importing} onClick={() => setImportOpen(false)} type="button">Cancel</button><button className="fleet-button" disabled={importing || importRows.length === 0 || invalidImportRows > 0} onClick={importMachines} type="button">{importing ? 'Importing…' : `Import ${validImportRows.length.toLocaleString('en-ZA')} machine${validImportRows.length === 1 ? '' : 's'}`}</button></footer>
      </AccessibleDialog>
    </>
  );
}
