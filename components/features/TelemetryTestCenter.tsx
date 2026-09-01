'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';

type DeviceRecord = {
  id: string;
  device_code: string;
  machine_id: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
};

type MachineRecord = {
  id: string;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
};

type TestSession = {
  id: string;
  device_id: string;
  status: 'active' | 'stopped' | 'expired';
  raw_mdb: boolean;
  raw_dex: boolean;
  started_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  last_device_contact_at: string | null;
  last_log_at: string | null;
};

type DebugLog = {
  id: number;
  session_id: string;
  device_id: string;
  boot_id: string;
  device_sequence: number;
  device_uptime_ms: number | null;
  category: string | null;
  message: string;
  received_at: string;
};

const SAFE_COMMANDS = [
  'STATUS',
  'MACHINE IDENTITY',
  'CUP COUNTERS',
  'DATA USAGE',
  'CELL PPP STATUS',
  'WIRING',
  'HELP',
] as const;

function normalizeRpcRow<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatUptime(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  const ms = Math.max(0, Math.trunc(value));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function timeAgo(value: string | null) {
  if (!value) return 'Never';
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

function remainingLabel(expiresAt: string | null, now: number) {
  if (!expiresAt) return '—';
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function lineTone(message: string) {
  if (message.startsWith('[MDB RAW]')) return 'mdb';
  if (message.startsWith('[DEX RAW')) return 'dex';
  if (message.startsWith('[TEST CENTER')) return 'control';
  if (/fail|error|fatal|fault|timeout/i.test(message)) return 'error';
  if (/success|accepted|connected|online/i.test(message)) return 'success';
  return 'normal';
}

export function TelemetryTestCenter() {
  const client = useMemo(() => getSupabaseClient(), []);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [machines, setMachines] = useState<Record<string, MachineRecord>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [session, setSession] = useState<TestSession | null>(null);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [rawMdb, setRawMdb] = useState(true);
  const [rawDex, setRawDex] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pausedCount, setPausedCount] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [now, setNow] = useState(Date.now());
  const terminalRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const pausedBufferRef = useRef<DebugLog[]>([]);

  const selectedDevice = devices.find((item) => item.id === selectedDeviceId) ?? null;
  const selectedMachine = selectedDevice?.machine_id ? machines[selectedDevice.machine_id] ?? null : null;

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: deviceRows, error: deviceError } = await client
      .from('telemetry_devices')
      .select('id,device_code,machine_id,status,firmware_version,last_seen_at,last_transport,wifi_rssi,cellular_csq,cellular_operator')
      .eq('status', 'active')
      .order('device_code', { ascending: true });

    if (deviceError) {
      setError(deviceError.message);
      setLoading(false);
      return;
    }

    const normalized = (deviceRows ?? []) as DeviceRecord[];
    setDevices(normalized);
    setSelectedDeviceId((current) => current || normalized[0]?.id || '');

    const machineIds = [...new Set(normalized.map((item) => item.machine_id).filter((value): value is string => Boolean(value)))];
    if (machineIds.length > 0) {
      const { data: machineRows } = await client
        .from('machines')
        .select('id,machine_name,model,serial_number,asset_tag')
        .in('id', machineIds);
      const byId: Record<string, MachineRecord> = {};
      ((machineRows ?? []) as MachineRecord[]).forEach((machine) => { byId[machine.id] = machine; });
      setMachines(byId);
    }
    setLoading(false);
  }, [client]);

  const loadActiveSession = useCallback(async (deviceId: string) => {
    if (!deviceId) {
      setSession(null);
      setLogs([]);
      return;
    }
    const { data, error: sessionError } = await client
      .from('telemetry_test_sessions')
      .select('id,device_id,status,raw_mdb,raw_dex,started_at,expires_at,acknowledged_at,last_device_contact_at,last_log_at')
      .eq('device_id', deviceId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      setError(sessionError.message);
      setSession(null);
      return;
    }
    const active = (data ?? null) as TestSession | null;
    setSession(active);
    setRawMdb(active?.raw_mdb ?? true);
    setRawDex(active?.raw_dex ?? true);
  }, [client]);

  const loadLogs = useCallback(async (sessionId: string) => {
    const { data, error: logError } = await client
      .from('telemetry_debug_logs')
      .select('id,session_id,device_id,boot_id,device_sequence,device_uptime_ms,category,message,received_at')
      .eq('session_id', sessionId)
      .order('id', { ascending: false })
      .limit(300);
    if (logError) {
      setError(logError.message);
      return;
    }
    setLogs(((data ?? []) as DebugLog[]).reverse());
  }, [client]);

  useEffect(() => { void loadFleet(); }, [loadFleet]);

  useEffect(() => {
    setError(null);
    pausedBufferRef.current = [];
    setPausedCount(0);
    setLogs([]);
    void loadActiveSession(selectedDeviceId);
  }, [loadActiveSession, selectedDeviceId]);

  useEffect(() => {
    if (!session?.id) return;
    void loadLogs(session.id);

    const channel = client
      .channel(`telemetry-test-center-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry_debug_logs',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const row = payload.new as DebugLog;
          if (pausedRef.current) {
            pausedBufferRef.current.push(row);
            setPausedCount(pausedBufferRef.current.length);
            return;
          }
          setLogs((current) => [...current.slice(-499), row]);
        },
      )
      .subscribe();

    const sessionPoll = window.setInterval(async () => {
      const { data } = await client
        .from('telemetry_test_sessions')
        .select('id,device_id,status,raw_mdb,raw_dex,started_at,expires_at,acknowledged_at,last_device_contact_at,last_log_at')
        .eq('id', session.id)
        .maybeSingle();
      const updated = (data ?? null) as TestSession | null;
      if (!updated || updated.status !== 'active' || new Date(updated.expires_at).getTime() <= Date.now()) {
        setSession(null);
      } else {
        setSession(updated);
      }
    }, 5000);

    return () => {
      window.clearInterval(sessionPoll);
      void client.removeChannel(channel);
    };
  }, [client, loadLogs, session?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoScroll || paused) return;
    const element = terminalRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [autoScroll, logs, paused]);

  const startSession = async () => {
    if (!selectedDeviceId) return;
    setBusy(true);
    setError(null);
    const { data, error: startError } = await client.rpc('start_telemetry_test_session', {
      p_device_id: selectedDeviceId,
      p_duration_minutes: 30,
      p_raw_mdb: rawMdb,
      p_raw_dex: rawDex,
      p_http_trace: true,
    });
    setBusy(false);
    if (startError) {
      setError(startError.message);
      return;
    }
    const created = normalizeRpcRow(data as TestSession | TestSession[] | null);
    setSession(created);
    setLogs([]);
  };

  const stopSession = async () => {
    if (!session) return;
    setBusy(true);
    const { error: stopError } = await client.rpc('stop_telemetry_test_session', {
      p_session_id: session.id,
    });
    setBusy(false);
    if (stopError) {
      setError(stopError.message);
      return;
    }
    setSession(null);
  };

  const queueCommand = async (command: string) => {
    if (!session) return;
    const { error: commandError } = await client.rpc('queue_telemetry_test_command', {
      p_session_id: session.id,
      p_command: command,
    });
    if (commandError) setError(commandError.message);
  };

  const togglePause = () => {
    if (paused) {
      const pending = pausedBufferRef.current;
      pausedBufferRef.current = [];
      setLogs((current) => [...current, ...pending].slice(-500));
      setPausedCount(0);
      pausedRef.current = false;
      setPaused(false);
      return;
    }
    pausedRef.current = true;
    setPaused(true);
  };

  const clearLocal = () => {
    setLogs([]);
    pausedBufferRef.current = [];
    setPausedCount(0);
  };

  const copyLogs = async () => {
    const text = logs.map((line) => `${formatUptime(line.device_uptime_ms)}  ${line.message}`).join('\n');
    await navigator.clipboard.writeText(text);
  };

  const downloadLogs = () => {
    const text = logs.map((line) => `${formatUptime(line.device_uptime_ms)}  ${line.message}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dallmayr-test-center-${selectedDevice?.device_code ?? 'device'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <section className="test-center-page"><div className="fleet-panel test-center-loading">Loading telemetry devices…</div></section>;
  }

  return (
    <section className="test-center-page">
      <header className="test-center-hero">
        <div>
          <span className="test-center-eyebrow">Remote commissioning</span>
          <h1>Telemetry Test Center</h1>
          <p>See the ESP32 console while the telemetry unit remains installed in the vending machine. Sessions are temporary and production telemetry keeps priority.</p>
        </div>
        <div className={`test-center-session-pill ${session ? 'is-active' : ''}`}>
          <i aria-hidden="true" />
          {session ? (session.acknowledged_at ? 'Device streaming' : 'Waiting for device') : 'Remote debug off'}
        </div>
      </header>

      {error ? <div className="test-center-error" role="alert">{error}</div> : null}

      <div className="test-center-layout">
        <aside className="fleet-panel test-center-sidebar">
          <label className="test-center-field">
            <span>Telemetry device</span>
            <select
              disabled={Boolean(session)}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              value={selectedDeviceId}
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id}>{device.device_code}</option>
              ))}
            </select>
          </label>

          <div className="test-center-device-card">
            <div><span>Machine</span><strong>{selectedMachine?.machine_name ?? selectedMachine?.model ?? 'Not linked'}</strong></div>
            <div><span>Serial</span><strong>{selectedMachine?.serial_number ?? selectedMachine?.asset_tag ?? '—'}</strong></div>
            <div><span>Firmware</span><strong>{selectedDevice?.firmware_version ?? 'Unknown'}</strong></div>
            <div><span>Transport</span><strong>{selectedDevice?.last_transport ?? 'Unknown'}</strong></div>
            <div><span>Operator</span><strong>{selectedDevice?.cellular_operator ?? '—'}</strong></div>
            <div><span>Last contact</span><strong>{timeAgo(selectedDevice?.last_seen_at ?? null)}</strong></div>
          </div>

          <fieldset className="test-center-options" disabled={Boolean(session)}>
            <legend>Extra protocol capture</legend>
            <label><input checked={rawMdb} onChange={(event) => setRawMdb(event.target.checked)} type="checkbox" /> Raw MDB frames</label>
            <label><input checked={rawDex} onChange={(event) => setRawDex(event.target.checked)} type="checkbox" /> Raw DEX records</label>
            <small>Serial output is always mirrored. Raw protocol capture is added only during the session.</small>
          </fieldset>

          {!session ? (
            <button className="button test-center-primary" disabled={busy || !selectedDevice} onClick={startSession} type="button">
              Start 30-minute remote test
            </button>
          ) : (
            <button className="button test-center-stop" disabled={busy} onClick={stopSession} type="button">
              Stop remote test
            </button>
          )}

          {session ? (
            <div className="test-center-session-meta">
              <span>Time remaining <strong>{remainingLabel(session.expires_at, now)}</strong></span>
              <span>Session <code>{session.id.slice(0, 8)}</code></span>
              <span>Device ACK <strong>{session.acknowledged_at ? timeAgo(session.acknowledged_at) : 'Pending'}</strong></span>
              {!session.acknowledged_at ? <small>The device checks its normal config path. Initial activation can take up to its current config interval; once active, command polling drops to 10 seconds.</small> : null}
            </div>
          ) : null}
        </aside>

        <main className="fleet-panel test-center-console-panel">
          <div className="test-center-console-toolbar">
            <div>
              <span>Live console</span>
              <strong>{selectedDevice?.device_code ?? 'No device selected'}</strong>
            </div>
            <div className="test-center-toolbar-actions">
              <button onClick={togglePause} type="button">{paused ? `Resume (${pausedCount})` : 'Pause'}</button>
              <button onClick={() => setAutoScroll((current) => !current)} type="button">{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</button>
              <button onClick={clearLocal} type="button">Clear</button>
              <button disabled={logs.length === 0} onClick={() => void copyLogs()} type="button">Copy</button>
              <button disabled={logs.length === 0} onClick={downloadLogs} type="button">Download</button>
            </div>
          </div>

          <div className="test-center-terminal" ref={terminalRef}>
            {logs.length === 0 ? (
              <div className="test-center-terminal-empty">
                <NavigationIcon kind="telemetry" />
                <strong>{session ? 'Waiting for console output' : 'Start a remote test session'}</strong>
                <span>{session ? 'The last local Serial history and new machine activity will appear here when the ESP32 acknowledges the session.' : 'Remote logging stays off until you explicitly start a session.'}</span>
              </div>
            ) : (
              logs.map((line) => (
                <div className={`test-center-line is-${lineTone(line.message)}`} key={line.id}>
                  <time>{formatUptime(line.device_uptime_ms)}</time>
                  <pre>{line.message}</pre>
                </div>
              ))
            )}
          </div>

          <section className="test-center-command-strip">
            <div>
              <span>Safe diagnostics</span>
              <small>No arbitrary AT commands or machine-control commands are exposed remotely.</small>
            </div>
            <div>
              {SAFE_COMMANDS.map((command) => (
                <button disabled={!session || !session.acknowledged_at} key={command} onClick={() => void queueCommand(command)} type="button">
                  {command}
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}
