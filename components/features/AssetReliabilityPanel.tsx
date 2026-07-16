'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type MeterRow = { id: string; reading: number; unit: string; source: string; notes: string | null; recorded_at: string };
type DowntimeRow = { id: string; started_at: string; ended_at: string; downtime_minutes: number; reason: string | null; notes: string | null; created_at: string };

export function AssetReliabilityPanel({ machineId, currentMeter = 0, meterUnit = 'hours' }: { machineId: string; currentMeter?: number | null; meterUnit?: string | null }) {
  const [readings, setReadings] = useState<MeterRow[]>([]);
  const [downtime, setDowntime] = useState<DowntimeRow[]>([]);
  const [reading, setReading] = useState(Number(currentMeter ?? 0));
  const [unit, setUnit] = useState(meterUnit ?? 'hours');
  const [source, setSource] = useState('manual');
  const [meterNotes, setMeterNotes] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [reason, setReason] = useState('');
  const [downtimeNotes, setDowntimeNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadReliability() {
    const client = getSupabaseClient();
    const [meterResult, downtimeResult] = await Promise.all([
      client.from('asset_meter_readings').select('id, reading, unit, source, notes, recorded_at').eq('machine_id', machineId).order('recorded_at', { ascending: false }).limit(50),
      client.from('asset_downtime_events').select('id, started_at, ended_at, downtime_minutes, reason, notes, created_at').eq('machine_id', machineId).order('started_at', { ascending: false }).limit(50),
    ]);
    const firstError = meterResult.error ?? downtimeResult.error;
    if (firstError) throw firstError;
    setReadings((meterResult.data ?? []) as MeterRow[]);
    setDowntime((downtimeResult.data ?? []) as DowntimeRow[]);
  }

  useEffect(() => {
    loadReliability().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load reliability history.'));
  }, [machineId]);

  const downtimeMinutes = useMemo(() => downtime.reduce((sum, item) => sum + item.downtime_minutes, 0), [downtime]);

  async function recordMeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const { data, error: meterError } = await getSupabaseClient().rpc('record_asset_meter_reading', {
      p_machine_id: machineId,
      p_reading: Number(reading),
      p_unit: unit,
      p_source: source,
      p_notes: meterNotes.trim() || null,
    });
    setSaving(false);
    if (meterError) {
      setError(meterError.message);
      return;
    }
    setMessage(`Meter reading recorded${Number(data) > 0 ? ` and ${data} maintenance task(s) generated` : ''}.`);
    setMeterNotes('');
    await loadReliability();
  }

  async function recordDowntime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startedAt || !endedAt) return;
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes <= 0) {
      setError('Downtime end must be after the start.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: downtimeError } = await getSupabaseClient().from('asset_downtime_events').insert({
      machine_id: machineId,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      downtime_minutes: minutes,
      reason: reason.trim() || null,
      notes: downtimeNotes.trim() || null,
    });
    setSaving(false);
    if (downtimeError) {
      setError(downtimeError.message);
      return;
    }
    setMessage('Downtime event recorded.');
    setStartedAt('');
    setEndedAt('');
    setReason('');
    setDowntimeNotes('');
    await loadReliability();
  }

  return (
    <section className="minimal-panel">
      <div className="minimal-panel-header">
        <div><span className="minimal-kicker">Reliability</span><h2>Meter and downtime</h2><p>Record usage and unavailable time for preventive scheduling and reliability reporting.</p></div>
        <div className="minimal-summary"><span>Recorded downtime</span><strong>{Math.round(downtimeMinutes / 60)} h</strong></div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="minimal-split">
        <form className="minimal-form" onSubmit={recordMeter}>
          <h3>Meter reading</h3>
          <div className="minimal-grid-3">
            <label>Reading<input min="0" step="0.01" type="number" value={reading} onChange={(event) => setReading(Number(event.target.value))} /></label>
            <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="hours">Hours</option><option value="cycles">Cycles</option><option value="kilometres">Kilometres</option><option value="units">Units</option></select></label>
            <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="manual">Manual</option><option value="service">Service</option><option value="inspection">Inspection</option><option value="sensor">Sensor</option></select></label>
          </div>
          <label>Notes<input value={meterNotes} onChange={(event) => setMeterNotes(event.target.value)} /></label>
          <button className="button" disabled={saving} type="submit">Record reading</button>
        </form>

        <form className="minimal-form" onSubmit={recordDowntime}>
          <h3>Downtime event</h3>
          <div className="minimal-grid-3">
            <label>Started<input required type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label>
            <label>Restored<input required type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label>
            <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Failure, waiting parts..." /></label>
          </div>
          <label>Notes<input value={downtimeNotes} onChange={(event) => setDowntimeNotes(event.target.value)} /></label>
          <button className="button secondary" disabled={saving || !startedAt || !endedAt} type="submit">Record downtime</button>
        </form>
      </div>

      <div className="minimal-split minimal-form-section">
        <div className="minimal-list"><h3>Recent readings</h3>{readings.length === 0 ? <div className="minimal-empty">No readings recorded.</div> : readings.slice(0, 8).map((item) => <article className="minimal-list-item" key={item.id}><div><strong>{item.reading} {item.unit}</strong><p>{item.notes ?? item.source}</p><small>{new Date(item.recorded_at).toLocaleString()}</small></div><StatusBadge value={item.source} /></article>)}</div>
        <div className="minimal-list"><h3>Recent downtime</h3>{downtime.length === 0 ? <div className="minimal-empty">No downtime recorded.</div> : downtime.slice(0, 8).map((item) => <article className="minimal-list-item" key={item.id}><div><strong>{Math.round(item.downtime_minutes / 60 * 10) / 10} hours</strong><p>{item.reason ?? item.notes ?? 'Downtime event'}</p><small>{new Date(item.started_at).toLocaleString()}</small></div><StatusBadge value="warning" label="Downtime" /></article>)}</div>
      </div>
    </section>
  );
}
