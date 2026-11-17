'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePages } from '@/lib/supabase/collect-pages';
import { parseFirmwareManifest } from '@/supabase/functions/_shared/firmware-manifest';
import {
  TelemetryFirmwareStatus,
  type FirmwareState,
} from './TelemetryFirmwareStatus';
import styles from './TelemetryFirmwarePanel.module.css';

type Device = {
  id: string;
  device_code: string;
  machine_id: string | null;
  telemetry_region: string;
};
type Release = { id: string; version: string; generation: number };
type Job = {
  id: string;
  status: string;
  detail: string | null;
  requested_at: string;
};
const digest = async (bytes: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
export function TelemetryFirmwarePanel() {
  const [confirming, setConfirming] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState('');
  const [releases, setReleases] = useState<Release[]>([]),
    [releaseId, setReleaseId] = useState('');
  useEffect(() => {
    setConfirming(false);
  }, [selected, releaseId]);
  const [state, setState] = useState<FirmwareState | null>(null),
    [jobs, setJobs] = useState<Job[]>([]);
  const [uid, setUid] = useState(''),
    [provision, setProvision] = useState('');
  const [image, setImage] = useState<File | null>(null),
    [manifestFile, setManifestFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const db = getSupabaseClient();
    const rows = await collectSupabasePages<Device>((from, to) =>
      db
        .from('telemetry_devices')
        .select('id,device_code,machine_id,telemetry_region')
        .eq('status', 'active')
        .order('device_code')
        .range(from, to),
    );
    setDevices(rows);
    const result = await db
      .from('telemetry_firmware_releases')
      .select('id,version,generation')
      .order('generation', { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    setReleases(result.data ?? []);
  }, []);
  const loadDevice = useCallback(async () => {
    if (!selected) {
      setState(null);
      setJobs([]);
      return;
    }
    const db = getSupabaseClient();
    const [capability, history] = await Promise.all([
      db
        .from('telemetry_firmware_state')
        .select(
          'rollback_capable,trust_ready,running_version,reported_at,highwater',
        )
        .eq('device_id', selected)
        .maybeSingle(),
      db
        .from('telemetry_firmware_jobs')
        .select('id,status,detail,requested_at')
        .eq('device_id', selected)
        .order('requested_at', { ascending: false })
        .limit(10),
    ]);
    if (capability.error || history.error)
      throw capability.error ?? history.error;
    setState(capability.data);
    setJobs(history.data ?? []);
  }, [selected]);
  useEffect(() => {
    void load().catch((e) =>
      setError(e.message ?? 'Could not load firmware controls.'),
    );
  }, [load]);
  useEffect(() => {
    setState(null);
    setJobs([]);
    void loadDevice().catch((e) =>
      setError(e.message ?? 'Could not load device update history.'),
    );
    const timer = setInterval(
      () => void loadDevice().catch((e) => setError(e.message)),
      30000,
    );
    return () => clearInterval(timer);
  }, [loadDevice]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : String((e as { message?: string }).message ?? 'Action failed.'),
      );
    } finally {
      setBusy(false);
    }
  }
  async function provisionDevice() {
    if (!/^[0-9A-F]{12}$/.test(uid))
      throw new Error('Enter the 12-character hardware UID.');
    setProvision('');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
    const hash = await digest(new TextEncoder().encode(key).buffer);
    const result = await getSupabaseClient().rpc('provision_telemetry_device', {
      p_hardware_uid: uid,
      p_credential_hash: hash,
    });
    if (result.error) throw result.error;
    setProvision(`DEVICE PROVISION DLM-ESP32-${uid}|${key}`);
    setNotice(
      'Device registered as unmapped. Store its private credential over USB before installation.',
    );
    await load();
  }
  async function upload() {
    const device = devices.find((d) => d.id === selected);
    if (!device || !image || !manifestFile)
      throw new Error(
        'Select a device, firmware .bin and signed manifest .json.',
      );
    const manifest = parseFirmwareManifest(
      JSON.parse(await manifestFile.text()),
    );
    if (
      image.size !== manifest.size ||
      (await digest(await image.arrayBuffer())) !== manifest.sha256
    )
      throw new Error('Firmware image differs from the signed manifest.');
    const db = getSupabaseClient();
    const path = `${device.telemetry_region}/${manifest.sha256}.bin`;
    const uploaded = await db.storage
      .from('telemetry-firmware')
      .upload(path, image, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    // Identical signed re-releases can share an immutable binary object.
    if (uploaded.error && String(uploaded.error.statusCode) !== '409')
      throw uploaded.error;
    const registered = await db.rpc('register_telemetry_firmware_release', {
      p_manifest: manifest,
    });
    if (registered.error) throw registered.error;
    await load();
    setReleaseId(String(registered.data));
    setNotice(
      'Signed release registered. Select Install to request this device update.',
    );
  }
  async function requestUpdate() {
    if (!selected || !releaseId)
      throw new Error('Select a device and signed release.');
    const result = await getSupabaseClient().rpc(
      'request_telemetry_firmware_update',
      { p_device_id: selected, p_release_id: releaseId },
    );
    if (result.error) throw result.error;
    setNotice(
      'Update requested. Waiting for the device to acknowledge installation.',
    );
    await loadDevice();
  }
  const fresh =
    state &&
    Date.now() - new Date(state.reported_at).getTime() >= 0 &&
    Date.now() - new Date(state.reported_at).getTime() <= 300000;
  const ready = !!fresh && !!state?.rollback_capable && !!state?.trust_ready;
  const active = jobs.some((j) =>
    ['pending', 'installing', 'awaiting_health'].includes(j.status),
  );
  return (
    <section className={styles.panel} aria-labelledby="firmware-controls-title">
      <header>
        <h2 id="firmware-controls-title">Device provisioning and firmware</h2>
        <p>
          Administrator actions. Machine assignments remain final until an
          administrator changes them.
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.grid}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(provisionDevice);
          }}
        >
          <h3>Prepare a new device</h3>
          <label>
            Hardware UID
            <input
              value={uid}
              maxLength={12}
              onChange={(e) => setUid(e.target.value.trim().toUpperCase())}
              placeholder="B81F3FDA1CD8"
              autoComplete="off"
            />
          </label>
          <button disabled={busy} type="submit">
            Register unmapped device
          </button>
          {provision && (
            <>
              <p>
                Private credential: paste this once into Serial Monitor over
                USB. It is only displayed in this session.
              </p>
              <textarea
                aria-label="Private USB provisioning command"
                readOnly
                value={provision}
              />
              <button type="button" onClick={() => setProvision('')}>
                Hide credential
              </button>
            </>
          )}
        </form>
        <div>
          <h3>Update a device</h3>
          <label>
            Find device
            <input value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <label>
            Device
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setReleaseId('');
              }}
            >
              <option value="">Select device</option>
              {devices
                .filter((d) =>
                  d.device_code.toLowerCase().includes(filter.toLowerCase()),
                )
                .slice(0, 100)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.device_code}
                    {!d.machine_id ? ' · Unmapped' : ''}
                  </option>
                ))}
            </select>
          </label>
          <TelemetryFirmwareStatus state={state} />
          <label>
            Firmware image (.bin)
            <input
              type="file"
              accept=".bin"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Signed release manifest (.json)
            <input
              type="file"
              accept=".json"
              onChange={(e) => setManifestFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !selected || !image || !manifestFile}
            onClick={() => void run(upload)}
          >
            Register signed release
          </button>
          <label>
            Release
            <select
              value={releaseId}
              onChange={(e) => setReleaseId(e.target.value)}
            >
              <option value="">Select signed release</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version} · generation {r.generation}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !ready || !releaseId || active}
            onClick={() => setConfirming(true)}
          >
            Install selected release
          </button>
          {confirming && (
            <fieldset>
              <legend>Confirm device update</legend>
              <p>
                Install {releases.find((r) => r.id === releaseId)?.version} on{' '}
                {devices.find((d) => d.id === selected)?.device_code}? The
                device will restart after download and verification.
              </p>
              <button
                type="button"
                disabled={busy || !ready || active}
                onClick={() =>
                  void run(async () => {
                    await requestUpdate();
                    setConfirming(false);
                  })
                }
              >
                Confirm update
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </fieldset>
          )}
          <p>
            To restore an older version remotely, sign its known-good binary
            again with a newer generation, register it, then install it.
            Automatic rollback protects an unsuccessful trial.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load();
                await loadDevice();
              })
            }
          >
            Refresh update status
          </button>
        </div>
      </div>
      {jobs.length > 0 && (
        <div className={styles.history}>
          <h3>Update history</h3>
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <strong>{j.status.replaceAll('_', ' ')}</strong> ·{' '}
                {new Date(j.requested_at).toLocaleString('en-ZA')}
                <p>{j.detail ?? 'Waiting for device acknowledgement.'}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
