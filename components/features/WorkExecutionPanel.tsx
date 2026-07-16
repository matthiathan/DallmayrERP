'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type TemplateRow = { id: string; template_name: string; description: string | null };
type TimeEntry = { id: string; entry_type: string; minutes: number; hourly_rate: number | null; notes: string | null; user_id: string | null; created_at: string };
type StockRelation = { stock_name: string | null; item_barcode: string | null };
type PartRow = { id: string; quantity: number; quantity_unit: string; unit_cost: number | null; notes: string | null; created_at: string; stock_items?: StockRelation | StockRelation[] | null };
type EvidenceRow = { id: string; evidence_type: string; file_path: string | null; file_name: string | null; value_text: string | null; latitude: number | null; longitude: number | null; created_at: string; signed_url?: string };
type StockOption = { id: string; stock_name: string; item_barcode: string; box_barcode: string | null; item_quantity: number; box_quantity: number; default_location_id: string | null };
type LocationOption = { id: string; location_code: string; description: string | null };
type CompletionRow = { completion_code: string | null; root_cause: string | null; resolution_notes: string | null; first_time_fix: boolean | null; estimated_minutes: number | null };

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function WorkExecutionPanel({
  workItemId,
  machineId,
  customerId,
}: {
  workItemId: string;
  machineId?: string | null;
  customerId?: string | null;
}) {
  const { businessUser } = useAuth();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [timeType, setTimeType] = useState('labour');
  const [timeMinutes, setTimeMinutes] = useState(30);
  const [hourlyRate, setHourlyRate] = useState('');
  const [timeNotes, setTimeNotes] = useState('');
  const [barcode, setBarcode] = useState('');
  const [matchedStock, setMatchedStock] = useState<StockOption | null>(null);
  const [partQuantity, setPartQuantity] = useState(1);
  const [partUnit, setPartUnit] = useState<'item' | 'box'>('item');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [partNotes, setPartNotes] = useState('');
  const [completionCode, setCompletionCode] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [firstTimeFix, setFirstTimeFix] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [signatureName, setSignatureName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadExecution() {
    setError(null);
    const client = getSupabaseClient();
    const [templateResult, timeResult, partResult, evidenceResult, locationResult, completionResult] = await Promise.all([
      client.from('checklist_templates').select('id, template_name, description').eq('is_active', true).order('template_name'),
      client.from('work_time_entries').select('id, entry_type, minutes, hourly_rate, notes, user_id, created_at').eq('work_item_id', workItemId).order('created_at', { ascending: false }),
      client.from('work_parts_used').select('id, quantity, quantity_unit, unit_cost, notes, created_at, stock_items(stock_name, item_barcode)').eq('work_item_id', workItemId).order('created_at', { ascending: false }),
      client.from('work_evidence').select('id, evidence_type, file_path, file_name, value_text, latitude, longitude, created_at').eq('work_item_id', workItemId).order('created_at', { ascending: false }),
      client.from('stock_locations').select('id, location_code, description').eq('status', 'active').order('location_code'),
      client.from('work_items').select('completion_code, root_cause, resolution_notes, first_time_fix, estimated_minutes').eq('id', workItemId).single(),
    ]);

    const firstError = templateResult.error ?? timeResult.error ?? partResult.error ?? evidenceResult.error ?? locationResult.error ?? completionResult.error;
    if (firstError) throw firstError;

    setTemplates((templateResult.data ?? []) as TemplateRow[]);
    setTimeEntries((timeResult.data ?? []) as TimeEntry[]);
    setParts((partResult.data ?? []) as PartRow[]);
    setLocations((locationResult.data ?? []) as LocationOption[]);

    const completion = completionResult.data as CompletionRow;
    setCompletionCode(completion.completion_code ?? '');
    setRootCause(completion.root_cause ?? '');
    setResolutionNotes(completion.resolution_notes ?? '');
    setFirstTimeFix(Boolean(completion.first_time_fix));
    setEstimatedMinutes(completion.estimated_minutes ? String(completion.estimated_minutes) : '');

    const signedEvidence = await Promise.all(((evidenceResult.data ?? []) as EvidenceRow[]).map(async (item) => {
      if (!item.file_path) return item;
      const { data } = await client.storage.from('dallmayrerp-work-evidence').createSignedUrl(item.file_path, 3600);
      return { ...item, signed_url: data?.signedUrl };
    }));
    setEvidence(signedEvidence);
  }

  useEffect(() => {
    loadExecution().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load work execution details.'));
  }, [workItemId]);

  async function applyTemplate() {
    if (!selectedTemplateId) return;
    setSaving(true);
    setError(null);
    const { data, error: applyError } = await getSupabaseClient().rpc('apply_checklist_template', { p_work_item_id: workItemId, p_template_id: selectedTemplateId });
    setSaving(false);
    if (applyError) {
      setError(applyError.message);
      return;
    }
    setMessage(`${data} SOP step(s) added. Refresh the workspace checklist to view them.`);
    setSelectedTemplateId('');
  }

  async function logTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: timeError } = await getSupabaseClient().rpc('log_work_time', {
      p_work_item_id: workItemId,
      p_entry_type: timeType,
      p_minutes: Number(timeMinutes),
      p_hourly_rate: hourlyRate ? Number(hourlyRate) : null,
      p_notes: timeNotes.trim() || null,
    });
    setSaving(false);
    if (timeError) {
      setError(timeError.message);
      return;
    }
    setMessage('Time entry recorded.');
    setTimeMinutes(30);
    setHourlyRate('');
    setTimeNotes('');
    await loadExecution();
  }

  async function resolvePart(value: string) {
    const clean = value.trim();
    setBarcode(clean);
    setMatchedStock(null);
    setError(null);
    if (!clean) return;

    const client = getSupabaseClient();
    const itemResult = await client.from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, box_quantity, default_location_id').eq('item_barcode', clean).maybeSingle();
    if (itemResult.error) {
      setError(itemResult.error.message);
      return;
    }
    let data = itemResult.data;
    let unit: 'item' | 'box' = 'item';

    if (!data) {
      const boxResult = await client.from('stock_items').select('id, stock_name, item_barcode, box_barcode, item_quantity, box_quantity, default_location_id').eq('box_barcode', clean).maybeSingle();
      if (boxResult.error) {
        setError(boxResult.error.message);
        return;
      }
      data = boxResult.data;
      unit = 'box';
    }

    if (!data) {
      setError('Barcode not found in the stock master.');
      return;
    }

    const stock = data as StockOption;
    setMatchedStock(stock);
    setPartUnit(unit);
    setSourceLocationId(stock.default_location_id ?? '');
  }

  async function consumePart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matchedStock) return;
    setSaving(true);
    setError(null);
    const { error: partError } = await getSupabaseClient().rpc('consume_work_part', {
      p_work_item_id: workItemId,
      p_stock_item_id: matchedStock.id,
      p_quantity: Number(partQuantity),
      p_quantity_unit: partUnit,
      p_source_location_id: sourceLocationId || null,
      p_notes: partNotes.trim() || null,
      p_barcode: barcode || null,
    });
    setSaving(false);
    if (partError) {
      setError(partError.message);
      return;
    }
    setMessage(`${matchedStock.stock_name} issued to this work item.`);
    setBarcode('');
    setMatchedStock(null);
    setPartQuantity(1);
    setPartNotes('');
    await loadExecution();
  }

  async function saveCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: completionError } = await getSupabaseClient().rpc('save_work_completion', {
      p_work_item_id: workItemId,
      p_completion_code: completionCode.trim() || null,
      p_root_cause: rootCause.trim() || null,
      p_resolution_notes: resolutionNotes.trim() || null,
      p_first_time_fix: firstTimeFix,
      p_estimated_minutes: estimatedMinutes ? Number(estimatedMinutes) : null,
    });
    setSaving(false);
    if (completionError) {
      setError(completionError.message);
      return;
    }
    setMessage('Completion details saved.');
    await loadExecution();
  }

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !businessUser) return;
    setUploading(true);
    setError(null);
    const client = getSupabaseClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${workItemId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await client.storage.from('dallmayrerp-work-evidence').upload(filePath, file, { upsert: false });
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { error: recordError } = await client.from('work_evidence').insert({
      work_item_id: workItemId,
      evidence_type: file.type === 'application/pdf' ? 'document' : 'photo',
      file_path: filePath,
      file_name: file.name,
      created_by: businessUser.id,
    });
    if (recordError) {
      await client.storage.from('dallmayrerp-work-evidence').remove([filePath]);
      setUploading(false);
      setError(recordError.message);
      return;
    }
    event.target.value = '';
    setUploading(false);
    setMessage('Evidence uploaded.');
    await loadExecution();
  }

  async function captureGps() {
    if (!businessUser || !navigator.geolocation) {
      setError('Location services are not available on this device.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      });
      const { error: gpsError } = await getSupabaseClient().from('work_evidence').insert({
        work_item_id: workItemId,
        evidence_type: 'gps',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        value_text: `Accuracy ${Math.round(position.coords.accuracy)}m`,
        metadata: { accuracy: position.coords.accuracy },
        created_by: businessUser.id,
      });
      if (gpsError) throw gpsError;
      setMessage('GPS evidence recorded.');
      await loadExecution();
    } catch (gpsError) {
      setError(gpsError instanceof Error ? gpsError.message : 'Could not capture GPS location.');
    } finally {
      setSaving(false);
    }
  }

  async function recordSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signatureName.trim() || !businessUser) return;
    setSaving(true);
    const { error: signatureError } = await getSupabaseClient().from('work_evidence').insert({
      work_item_id: workItemId,
      evidence_type: 'signature',
      value_text: signatureName.trim(),
      metadata: { customer_id: customerId ?? null, machine_id: machineId ?? null },
      created_by: businessUser.id,
    });
    setSaving(false);
    if (signatureError) {
      setError(signatureError.message);
      return;
    }
    setSignatureName('');
    setMessage('Customer sign-off recorded.');
    await loadExecution();
  }

  const timeTotals = useMemo(() => ({
    labour: timeEntries.filter((entry) => entry.entry_type === 'labour').reduce((sum, entry) => sum + entry.minutes, 0),
    travel: timeEntries.filter((entry) => entry.entry_type === 'travel').reduce((sum, entry) => sum + entry.minutes, 0),
    downtime: timeEntries.filter((entry) => entry.entry_type === 'downtime').reduce((sum, entry) => sum + entry.minutes, 0),
    cost: timeEntries.reduce((sum, entry) => sum + entry.minutes / 60 * Number(entry.hourly_rate ?? 0), 0),
  }), [timeEntries]);
  const partCost = parts.reduce((sum, part) => sum + part.quantity * Number(part.unit_cost ?? 0), 0);

  return (
    <section className="grid">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-metric-grid">
        <div className="minimal-metric"><span>Labour</span><strong>{timeTotals.labour} min</strong></div>
        <div className="minimal-metric"><span>Travel</span><strong>{timeTotals.travel} min</strong></div>
        <div className="minimal-metric"><span>Downtime</span><strong>{timeTotals.downtime} min</strong></div>
        <div className="minimal-metric"><span>Estimated direct cost</span><strong>R {(timeTotals.cost + partCost).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
      </div>

      <div className="minimal-split">
        <section className="neo-card">
          <div className="minimal-toolbar"><div><h2>SOP and time</h2><p>Apply a standard procedure and record actual effort.</p></div></div>
          <div className="form-grid">
            <label>SOP template<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">Select template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label>
            <div style={{ alignSelf: 'end' }}><button className="button secondary" disabled={saving || !selectedTemplateId} onClick={applyTemplate} type="button">Apply SOP</button></div>
          </div>
          <form className="grid minimal-form-section" onSubmit={logTime}>
            <div className="form-grid">
              <label>Time type<select value={timeType} onChange={(event) => setTimeType(event.target.value)}><option value="labour">Labour</option><option value="travel">Travel</option><option value="downtime">Downtime</option></select></label>
              <label>Minutes<input min="1" type="number" value={timeMinutes} onChange={(event) => setTimeMinutes(Number(event.target.value))} /></label>
              <label>Hourly rate<input min="0" step="0.01" type="number" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></label>
            </div>
            <label>Notes<input value={timeNotes} onChange={(event) => setTimeNotes(event.target.value)} /></label>
            <button className="button secondary" disabled={saving || timeMinutes < 1} type="submit">Record time</button>
          </form>
          <div className="minimal-list minimal-form-section">{timeEntries.length === 0 ? <div className="minimal-empty">No time recorded.</div> : timeEntries.slice(0, 8).map((entry) => <div className="minimal-list-item" key={entry.id}><div><strong>{entry.entry_type.replace(/_/g, ' ')}</strong><p>{entry.notes ?? 'No note'}</p></div><div><strong>{entry.minutes} min</strong><small>{new Date(entry.created_at).toLocaleString()}</small></div></div>)}</div>
        </section>

        <section className="neo-card">
          <div className="minimal-toolbar"><div><h2>Parts used</h2><p>Scan an item or box and deduct it from stock.</p></div><StatusBadge value={matchedStock ? 'active' : 'unknown'} label={matchedStock ? 'Matched' : 'Awaiting scan'} /></div>
          <form className="grid" onSubmit={consumePart}>
            <BarcodeCapture label="Part barcode" value={barcode} onChange={resolvePart} />
            {matchedStock ? <div className="stock-match-card"><div><strong>{matchedStock.stock_name}</strong><span>{partUnit === 'box' ? 'Box' : 'Item'} barcode</span></div><div><span>Items</span><strong>{matchedStock.item_quantity}</strong></div><div><span>Boxes</span><strong>{matchedStock.box_quantity}</strong></div></div> : null}
            <div className="form-grid">
              <label>Quantity<input min="1" type="number" value={partQuantity} onChange={(event) => setPartQuantity(Number(event.target.value))} /></label>
              <label>Unit<select value={partUnit} onChange={(event) => setPartUnit(event.target.value as 'item' | 'box')}><option value="item">Item</option><option value="box">Box</option></select></label>
              <label>Source location<select value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)}><option value="">Unassigned stock</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.location_code}{location.description ? ` — ${location.description}` : ''}</option>)}</select></label>
            </div>
            <label>Notes<input value={partNotes} onChange={(event) => setPartNotes(event.target.value)} /></label>
            <button className="button" disabled={saving || !matchedStock || partQuantity < 1} type="submit">Issue part</button>
          </form>
          <div className="minimal-list minimal-form-section">{parts.length === 0 ? <div className="minimal-empty">No parts used.</div> : parts.slice(0, 8).map((part) => { const stock = firstRelation(part.stock_items); return <div className="minimal-list-item" key={part.id}><div><strong>{stock?.stock_name ?? 'Stock item'}</strong><p>{part.notes ?? 'No note'}</p></div><div><strong>{part.quantity} {part.quantity_unit}</strong><small>{new Date(part.created_at).toLocaleString()}</small></div></div>; })}</div>
        </section>
      </div>

      <div className="minimal-split">
        <section className="neo-card">
          <div className="minimal-toolbar"><div><h2>Completion details</h2><p>Required for maintenance and incident completion.</p></div></div>
          <form className="grid" onSubmit={saveCompletion}>
            <div className="form-grid">
              <label>Completion code<input value={completionCode} onChange={(event) => setCompletionCode(event.target.value)} placeholder="REPAIRED, NO-FAULT, REPLACED" /></label>
              <label>Estimated minutes<input min="1" type="number" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label>
              <label className="checkbox-field"><input checked={firstTimeFix} onChange={(event) => setFirstTimeFix(event.target.checked)} type="checkbox" /> First-time fix</label>
            </div>
            <label>Root cause<textarea value={rootCause} onChange={(event) => setRootCause(event.target.value)} /></label>
            <label>Resolution notes<textarea required value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} /></label>
            <button className="button" disabled={saving || !resolutionNotes.trim()} type="submit">Save completion</button>
          </form>
        </section>

        <section className="neo-card">
          <div className="minimal-toolbar"><div><h2>Evidence and sign-off</h2><p>Photos, documents, GPS and customer acknowledgement.</p></div></div>
          <div className="action-row">
            <label className="button secondary">{uploading ? 'Uploading...' : 'Add photo or PDF'}<input accept="image/*,application/pdf" capture="environment" disabled={uploading} hidden type="file" onChange={uploadEvidence} /></label>
            <button className="button secondary" disabled={saving} onClick={captureGps} type="button">Record GPS</button>
          </div>
          <form className="form-grid minimal-form-section" onSubmit={recordSignature}>
            <label>Customer sign-off name<input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} /></label>
            <div style={{ alignSelf: 'end' }}><button className="button secondary" disabled={saving || !signatureName.trim()} type="submit">Record sign-off</button></div>
          </form>
          <div className="minimal-list minimal-form-section">{evidence.length === 0 ? <div className="minimal-empty">No evidence recorded.</div> : evidence.slice(0, 10).map((item) => <div className="minimal-list-item" key={item.id}><div><strong>{item.evidence_type}</strong><p>{item.file_name ?? item.value_text ?? (item.latitude !== null ? `${item.latitude}, ${item.longitude}` : 'Evidence')}</p></div><div>{item.signed_url ? <a className="button secondary" href={item.signed_url} rel="noreferrer" target="_blank">Open</a> : null}<small>{new Date(item.created_at).toLocaleString()}</small></div></div>)}</div>
        </section>
      </div>
    </section>
  );
}
