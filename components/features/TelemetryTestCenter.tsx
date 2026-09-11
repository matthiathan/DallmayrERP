'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryTestCenter.module.css';

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
  profile_id: string | null;
  profile_assignment_method: 'automatic' | 'manual' | null;
  reported_machine_interface: string | null;
  reported_machine_model: string | null;
  last_config_ack_at: string | null;
  applied_config: Record<string, unknown> | null;
  mdb_master_polarity: 'auto' | 'normal' | 'inverted' | null;
  mdb_slave_polarity: 'auto' | 'normal' | 'inverted' | null;
  mdb_pin_swap: boolean;
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
  ended_at: string | null;
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

type TestCommand = {
  id: string;
  session_id: string;
  command: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
  completed_at: string | null;
  response_note: string | null;
};

type LogFilter = 'all' | 'mdb' | 'dex' | 'vend' | 'fault' | 'modem' | 'network' | 'system';
type SessionJourneyState = 'connecting' | 'acknowledged' | 'streaming' | 'stale' | 'ended' | 'off';

const SAFE_COMMANDS = [
  'STATUS',
  'MACHINE IDENTITY',
  'CUP COUNTERS',
  'DATA USAGE',
  'CELL PPP STATUS',
  'WIRING',
  'HELP',
] as const;

const LOG_FILTERS: Array<{ key: LogFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'mdb', label: 'MDB' },
  { key: 'dex', label: 'DEX' },
  { key: 'vend', label: 'Vend' },
  { key: 'fault', label: 'Fault' },
  { key: 'modem', label: 'Modem' },
  { key: 'network', label: 'Network' },
  { key: 'system', label: 'System' },
];

const SESSION_COLUMNS = 'id,device_id,status,raw_mdb,raw_dex,started_at,expires_at,acknowledged_at,last_device_contact_at,last_log_at,ended_at';
const COMMAND_COLUMNS = 'id,session_id,command,status,created_at,completed_at,response_note';

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

function timeAgo(value: string | null, now = Date.now()) {
  if (!value) return 'Never';
  const age = Math.max(0, now - new Date(value).getTime());
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

function localTimestamp(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
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
  if (/fail|error|fatal|fault|timeout|critical/i.test(message)) return 'error';
  if (/success|accepted|connected|online|vend complete|vend success/i.test(message)) return 'success';
  return 'normal';
}

function logTags(log: DebugLog): Set<Exclude<LogFilter, 'all'>> {
  const text = `${log.category ?? ''} ${log.message}`.toLocaleLowerCase('en-ZA');
  const tags = new Set<Exclude<LogFilter, 'all'>>();
  if (/\bmdb\b/.test(text)) tags.add('mdb');
  if (/\bdex\b/.test(text)) tags.add('dex');
  if (/vend|cup|selection|product|sale|counter/.test(text)) tags.add('vend');
  if (/fault|error|fail|alarm|critical|timeout|recovery/.test(text)) tags.add('fault');
  if (/ppp|air780|modem|csq|lte|cellular|sim\b/.test(text)) tags.add('modem');
  if (/wifi|wi-fi|http|https|tls|network|supabase|upload|transport/.test(text)) tags.add('network');
  if (/boot|config|firmware|heap|watchdog|test center|system|alive/.test(text)) tags.add('system');
  return tags;
}

function importantLogKind(log: DebugLog): 'vend' | 'fault' | 'identity' | null {
  const text = `${log.category ?? ''} ${log.message}`;
  if (/machine identity|reported machine|profile fingerprint|detected model|profile=/i.test(text)) return 'identity';
  if (/fault|error|fatal|critical|alarm/i.test(text)) return 'fault';
  if (/vend|cup counter|selection|product|sale/i.test(text)) return 'vend';
  return null;
}

function deriveJourneyState(session: TestSession | null, now: number): SessionJourneyState {
  if (!session) return 'off';
  if (session.status !== 'active' || new Date(session.expires_at).getTime() <= now) return 'ended';
  if (!session.acknowledged_at) return 'connecting';
  const latest = session.last_log_at ?? session.last_device_contact_at ?? session.acknowledged_at;
  if (!session.last_log_at) return 'acknowledged';
  if (latest && now - new Date(latest).getTime() <= 30_000) return 'streaming';
  return 'stale';
}

function journeyLabel(state: SessionJourneyState) {
  if (state === 'connecting') return 'Connecting';
  if (state === 'acknowledged') return 'Device acknowledged';
  if (state === 'streaming') return 'Streaming';
  if (state === 'stale') return 'Stale';
  if (state === 'ended') return 'Ended';
  return 'Remote debug off';
}

function appliedProfile(device: DeviceRecord | null) {
  const value = device?.applied_config?.profile_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function commandVisualStatus(command: TestCommand, now: number) {
  if (command.status === 'completed') return { label: 'Completed', tone: styles.commandSuccess };
  if (command.status === 'failed') return { label: 'Failed', tone: styles.commandFailed };
  const delayed = now - new Date(command.created_at).getTime() >= 30_000;
  return delayed
    ? { label: 'Delayed', tone: styles.commandDelayed }
    : { label: 'Pending', tone: styles.commandPending };
}

function preferredArchivedSession(sessions: TestSession[]) {
  return sessions.find((item) => Boolean(item.last_log_at)) ?? sessions[0] ?? null;
}

export function TelemetryTestCenter() {
  const client = useMemo(() => getSupabaseClient(), []);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [machines, setMachines] = useState<Record<string, MachineRecord>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [session, setSession] = useState<TestSession | null>(null);
  const [historySessions, setHistorySessions] = useState<TestSession[]>([]);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [commands, setCommands] = useState<TestCommand[]>([]);
  const [rawMdb, setRawMdb] = useState(true);
  const [rawDex, setRawDex] = useState(true);
  const [busy, setBusy] = useState(false);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pausedCount, setPausedCount] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logSearch, setLogSearch] = useState('');
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [now, setNow] = useState(Date.now());
  const terminalRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const pausedBufferRef = useRef<DebugLog[]>([]);

  const selectedDevice = devices.find((item) => item.id === selectedDeviceId) ?? null;
  const selectedMachine = selectedDevice?.machine_id ? machines[selectedDevice.machine_id] ?? null : null;
  const viewedSession = viewedSessionId ? historySessions.find((item) => item.id === viewedSessionId) ?? null : null;
  const displaySession = viewedSession ?? session;
  const isArchivedView = Boolean(viewedSession && (!session || viewedSession.id !== session.id));
  const journeyState = deriveJourneyState(displaySession, now);
  const activeJourneyState = deriveJourneyState(session, now);

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: deviceRows, error: deviceError } = await client
      .from('telemetry_devices')
      .select('id,device_code,machine_id,status,firmware_version,last_seen_at,last_transport,wifi_rssi,cellular_csq,cellular_operator,profile_id,profile_assignment_method,reported_machine_interface,reported_machine_model,last_config_ack_at,applied_config,mdb_master_polarity,mdb_slave_polarity,mdb_pin_swap')
      .eq('status', 'active')
      .order('device_code', { ascending: true });

    if (deviceError) {
      setError(deviceError.message);
      setLoading(false);
      return;
    }

    const normalized = (deviceRows ?? []) as DeviceRecord[];
    setDevices(normalized);
    const requestedDeviceCode = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('device')?.trim() ?? ''
      : '';
    setSelectedDeviceId((current) => {
      const requestedDevice = requestedDeviceCode
        ? normalized.find((item) => item.device_code === requestedDeviceCode)?.id
        : undefined;
      const currentStillExists = Boolean(current) && normalized.some((item) => item.id === current);
      return requestedDevice ?? (currentStillExists ? current : normalized[0]?.id ?? '');
    });

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

  const loadActiveSession = useCallback(async (deviceId: string): Promise<TestSession | null | undefined> => {
    if (!deviceId) {
      setSession(null);
      return null;
    }
    const { data, error: sessionError } = await client
      .from('telemetry_test_sessions')
      .select(SESSION_COLUMNS)
      .eq('device_id', deviceId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      setError(sessionError.message);
      setSession(null);
      return undefined;
    }
    const active = (data ?? null) as TestSession | null;
    setSession(active);
    setRawMdb(active?.raw_mdb ?? true);
    setRawDex(active?.raw_dex ?? true);
    return active;
  }, [client]);

  const loadSessionHistory = useCallback(async (deviceId: string): Promise<TestSession[] | undefined> => {
    if (!deviceId) {
      setHistorySessions([]);
      return [];
    }
    const { data, error: historyError } = await client
      .from('telemetry_test_sessions')
      .select(SESSION_COLUMNS)
      .eq('device_id', deviceId)
      .order('started_at', { ascending: false })
      .limit(12);
    if (historyError) {
      setError(historyError.message);
      return undefined;
    }
    const sessions = (data ?? []) as TestSession[];
    setHistorySessions(sessions);
    return sessions;
  }, [client]);

  const loadLogs = useCallback(async (sessionId: string) => {
    const { data, error: logError } = await client
      .from('telemetry_debug_logs')
      .select('id,session_id,device_id,boot_id,device_sequence,device_uptime_ms,category,message,received_at')
      .eq('session_id', sessionId)
      .order('id', { ascending: false })
      .limit(500);
    if (logError) {
      setError(logError.message);
      return;
    }
    setLogs(((data ?? []) as DebugLog[]).reverse());
  }, [client]);

  const loadCommands = useCallback(async (sessionId: string) => {
    const { data, error: commandError } = await client
      .from('telemetry_test_commands')
      .select(COMMAND_COLUMNS)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (commandError) {
      setError(commandError.message);
      return;
    }
    setCommands((data ?? []) as TestCommand[]);
  }, [client]);

  useEffect(() => { void loadFleet(); }, [loadFleet]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNotice(null);
    setViewedSessionId(null);
    pausedBufferRef.current = [];
    pausedRef.current = false;
    setPaused(false);
    setPausedCount(0);
    setLogs([]);
    setCommands([]);
    void Promise.all([loadActiveSession(selectedDeviceId), loadSessionHistory(selectedDeviceId)]).then(([active, archived]) => {
      if (cancelled || active !== null || !archived) return;
      const archivedSession = preferredArchivedSession(archived);
      if (!archivedSession) return;
      setViewedSessionId(archivedSession.id);
      setNotice('Showing the latest archived session with captured device output.');
    });
    return () => { cancelled = true; };
  }, [loadActiveSession, loadSessionHistory, selectedDeviceId]);

  useEffect(() => {
    if (!displaySession?.id) {
      setLogs([]);
      setCommands([]);
      return;
    }
    setLogs([]);
    setCommands([]);
    void Promise.all([loadLogs(displaySession.id), loadCommands(displaySession.id)]);
  }, [displaySession?.id, loadCommands, loadLogs]);

  useEffect(() => {
    if (!session?.id) return;

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
          if (viewedSessionId) return;
          const row = payload.new as DebugLog;
          if (pausedRef.current) {
            if (!pausedBufferRef.current.some((item) => item.id === row.id)) pausedBufferRef.current.push(row);
            setPausedCount(pausedBufferRef.current.length);
            return;
          }
          setLogs((current) => current.some((item) => item.id === row.id) ? current : [...current.slice(-499), row]);
        },
      )
      .subscribe();

    const sessionPoll = window.setInterval(async () => {
      const { data } = await client
        .from('telemetry_test_sessions')
        .select(SESSION_COLUMNS)
        .eq('id', session.id)
        .maybeSingle();
      const updated = (data ?? null) as TestSession | null;
      if (!updated || updated.status !== 'active' || new Date(updated.expires_at).getTime() <= Date.now()) {
        setSession(null);
        if (updated) {
          setHistorySessions((current) => [updated, ...current.filter((item) => item.id !== updated.id)].slice(0, 12));
          setViewedSessionId((current) => current ?? updated.id);
        }
        void loadSessionHistory(selectedDeviceId);
      } else {
        setSession(updated);
        setHistorySessions((current) => [updated, ...current.filter((item) => item.id !== updated.id)].slice(0, 12));
        if (!pausedRef.current && !viewedSessionId) void loadLogs(updated.id);
        if (!viewedSessionId) void loadCommands(updated.id);
      }
    }, 5000);

    return () => {
      window.clearInterval(sessionPoll);
      void client.removeChannel(channel);
    };
  }, [client, loadCommands, loadLogs, loadSessionHistory, selectedDeviceId, session?.id, viewedSessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoScroll || paused) return;
    const element = terminalRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [autoScroll, logs, paused]);

  const filteredLogs = useMemo(() => {
    const term = logSearch.trim().toLocaleLowerCase('en-ZA');
    return logs.filter((log) => {
      const filterMatch = logFilter === 'all' || logTags(log).has(logFilter);
      const searchMatch = !term || `${log.category ?? ''} ${log.message} ${log.boot_id}`.toLocaleLowerCase('en-ZA').includes(term);
      return filterMatch && searchMatch;
    });
  }, [logFilter, logSearch, logs]);

  const filterCounts = useMemo(() => {
    const counts: Record<LogFilter, number> = { all: logs.length, mdb: 0, dex: 0, vend: 0, fault: 0, modem: 0, network: 0, system: 0 };
    logs.forEach((log) => logTags(log).forEach((tag) => { counts[tag] += 1; }));
    return counts;
  }, [logs]);

  const startSession = async () => {
    if (!selectedDeviceId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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
    setViewedSessionId(null);
    setLogs([]);
    setCommands([]);
    if (created) {
      setHistorySessions((current) => [created, ...current.filter((item) => item.id !== created.id)].slice(0, 12));
      setNotice('Remote Test Center session started. Waiting for the telemetry device to acknowledge it.');
    }
  };

  const stopSession = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const { data, error: stopError } = await client.rpc('stop_telemetry_test_session', {
      p_session_id: session.id,
    });
    setBusy(false);
    if (stopError) {
      setError(stopError.message);
      return;
    }
    const stopped = normalizeRpcRow(data as TestSession | TestSession[] | null);
    setSession(null);
    if (stopped) {
      setHistorySessions((current) => [stopped, ...current.filter((item) => item.id !== stopped.id)].slice(0, 12));
      setViewedSessionId(stopped.id);
    }
    setNotice('Remote test stopped. The captured session remains available in Session history.');
  };

  const queueCommand = async (command: string) => {
    if (!session || viewedSessionId) return;
    setCommandBusy(command);
    setError(null);
    setNotice(null);
    const { data, error: commandError } = await client.rpc('queue_telemetry_test_command', {
      p_session_id: session.id,
      p_command: command,
    });
    setCommandBusy(null);
    if (commandError) {
      setError(commandError.message);
      return;
    }
    const created = normalizeRpcRow(data as TestCommand | TestCommand[] | null);
    if (created) setCommands((current) => [created, ...current.filter((item) => item.id !== created.id)].slice(0, 12));
    setNotice(`${command} queued. Command status will update when the device responds.`);
  };

  const togglePause = () => {
    if (paused) {
      const pending = pausedBufferRef.current;
      pausedBufferRef.current = [];
      setLogs((current) => {
        const byId = new Map<number, DebugLog>();
        current.forEach((row) => byId.set(row.id, row));
        pending.forEach((row) => byId.set(row.id, row));
        return Array.from(byId.values()).sort((left, right) => left.id - right.id).slice(-500);
      });
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
    const text = filteredLogs.map((line) => `${formatUptime(line.device_uptime_ms)}  ${line.message}`).join('\n');
    await navigator.clipboard.writeText(text);
    setNotice(`Copied ${filteredLogs.length} visible log lines.`);
  };

  const exportSession = () => {
    if (!displaySession) return;
    const device = selectedDevice;
    const machine = selectedMachine;
    const pinMap = device?.mdb_pin_swap
      ? 'Swapped: GPIO5 Master-TX / GPIO4 Master-RX'
      : 'Standard: GPIO4 Master-TX / GPIO5 Master-RX';
    const header = [
      'Dallmayr Telemetry Test Center diagnostic export',
      `Exported: ${new Date().toISOString()}`,
      `Session: ${displaySession.id}`,
      `Session status: ${displaySession.status}`,
      `Session started: ${displaySession.started_at}`,
      `Session ended: ${displaySession.ended_at ?? 'active'}`,
      `Device: ${device?.device_code ?? 'unknown'}`,
      `Firmware: ${device?.firmware_version ?? 'unknown'}`,
      `Machine: ${machine?.machine_name ?? machine?.model ?? 'not linked'}`,
      `Machine serial: ${machine?.serial_number ?? machine?.asset_tag ?? 'unknown'}`,
      `Reported model: ${device?.reported_machine_model ?? 'unknown'}`,
      `Protocol: ${device?.reported_machine_interface ?? 'unknown'}`,
      `Profile mode: ${device?.profile_assignment_method ?? 'automatic'}`,
      `Requested profile: ${device?.profile_id ?? 'automatic'}`,
      `Applied profile: ${appliedProfile(device) ?? 'unknown'}`,
      `MDB pin order: ${pinMap}`,
      `Master polarity: ${device?.mdb_master_polarity ?? 'auto'}`,
      `Slave polarity: ${device?.mdb_slave_polarity ?? 'auto'}`,
      '',
      'COMMANDS',
      ...commands.map((item) => `${item.created_at}  ${item.command}  ${commandVisualStatus(item, now).label}${item.response_note ? `  ${item.response_note}` : ''}`),
      '',
      'LOGS',
      ...logs.map((line) => `${formatUptime(line.device_uptime_ms)}  ${line.received_at}  ${line.category ?? 'uncategorised'}  ${line.message}`),
      '',
    ];
    const blob = new Blob([header.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dallmayr-test-center-${device?.device_code ?? 'device'}-${displaySession.id.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <section className="test-center-page"><div className="fleet-panel test-center-loading">Loading telemetry devices…</div></section>;
  }

  const effectiveProfile = selectedDevice?.profile_assignment_method === 'manual'
    ? selectedDevice.profile_id ?? 'Manual profile missing'
    : appliedProfile(selectedDevice) ?? selectedDevice?.profile_id ?? 'Automatic — awaiting match';
  const pinOrder = selectedDevice?.mdb_pin_swap ? 'Swapped' : 'Standard';
  const pinDetail = selectedDevice?.mdb_pin_swap
    ? 'GPIO5 Master-TX · GPIO4 Master-RX'
    : 'GPIO4 Master-TX · GPIO5 Master-RX';

  return (
    <section className={`test-center-page ${styles.workspace}`}>
      <header className="test-center-hero">
        <div>
          <span className="test-center-eyebrow">Remote commissioning</span>
          <h1>Telemetry Test Center</h1>
          <p>Inspect live ESP32 and machine communications, compare the applied decoder configuration and retain an auditable diagnostic session history.</p>
        </div>
        <div className={`test-center-session-pill ${session ? 'is-active' : ''} ${activeJourneyState === 'stale' ? styles.stalePill : ''}`}>
          <i aria-hidden="true" />
          {journeyLabel(activeJourneyState)}
        </div>
      </header>

      {error ? <div className="test-center-error" role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section aria-label="Remote session state" className={styles.statusJourney}>
        {(['connecting', 'acknowledged', 'streaming', 'stale', 'ended'] as const).map((state, index) => {
          const liveOrder = ['connecting', 'acknowledged', 'streaming'];
          const currentIndex = liveOrder.indexOf(journeyState);
          const isDone = index < currentIndex && index < 3;
          const isActive = journeyState === state;
          return (
            <div className={`${styles.statusStep} ${isActive ? styles.statusStepActive : ''} ${isDone ? styles.statusStepDone : ''}`} key={state}>
              <i aria-hidden="true" />
              <span>{journeyLabel(state)}</span>
            </div>
          );
        })}
        <div className={styles.statusDetail}>
          <strong>{journeyLabel(journeyState)}</strong>
          <span>
            {journeyState === 'connecting' ? 'Session exists; waiting for the device config poll.' : null}
            {journeyState === 'acknowledged' ? 'Device has acknowledged the session; waiting for its first log line.' : null}
            {journeyState === 'streaming' ? `Last log ${timeAgo(displaySession?.last_log_at ?? null, now)}.` : null}
            {journeyState === 'stale' ? `No new log for ${timeAgo(displaySession?.last_log_at ?? displaySession?.last_device_contact_at ?? null, now)}.` : null}
            {journeyState === 'ended' ? 'Archived session. Diagnostics are read-only.' : null}
            {journeyState === 'off' ? 'Start a temporary remote test to stream diagnostics.' : null}
          </span>
        </div>
      </section>

      <div className="test-center-layout">
        <aside className="fleet-panel test-center-sidebar">
          <label className="test-center-field">
            <span>Telemetry device</span>
            <select disabled={Boolean(session)} onChange={(event) => setSelectedDeviceId(event.target.value)} value={selectedDeviceId}>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.device_code}</option>)}
            </select>
          </label>

          <div className="test-center-device-card">
            <div><span>Machine</span><strong>{selectedMachine?.machine_name ?? selectedMachine?.model ?? 'Not linked'}</strong></div>
            <div><span>Serial</span><strong>{selectedMachine?.serial_number ?? selectedMachine?.asset_tag ?? '—'}</strong></div>
            <div><span>Firmware</span><strong>{selectedDevice?.firmware_version ?? 'Unknown'}</strong></div>
            <div><span>Transport</span><strong>{selectedDevice?.last_transport ?? 'Unknown'}</strong></div>
            <div><span>Operator</span><strong>{selectedDevice?.cellular_operator ?? '—'}</strong></div>
            <div><span>Last contact</span><strong>{timeAgo(selectedDevice?.last_seen_at ?? null, now)}</strong></div>
          </div>

          <section className={styles.configurationCard}>
            <div className={styles.sectionHeading}><span>Applied configuration</span><strong>Device + decoder</strong></div>
            <dl className={styles.configList}>
              <div><dt>Decoder profile</dt><dd>{effectiveProfile}</dd></div>
              <div><dt>Profile mode</dt><dd>{selectedDevice?.profile_assignment_method ?? 'automatic'}</dd></div>
              <div><dt>Protocol</dt><dd>{selectedDevice?.reported_machine_interface?.toUpperCase() ?? 'Unknown'}</dd></div>
              <div><dt>Reported model</dt><dd>{selectedDevice?.reported_machine_model ?? 'Unknown'}</dd></div>
              <div><dt>MDB pin order</dt><dd>{pinOrder}</dd></div>
              <div><dt>Pin map</dt><dd>{pinDetail}</dd></div>
              <div><dt>Master polarity</dt><dd>{selectedDevice?.mdb_master_polarity ?? 'auto'}</dd></div>
              <div><dt>Slave polarity</dt><dd>{selectedDevice?.mdb_slave_polarity ?? 'auto'}</dd></div>
              <div><dt>Config ACK</dt><dd>{timeAgo(selectedDevice?.last_config_ack_at ?? null, now)}</dd></div>
            </dl>
            <small>MDB capture remains passive/input-only; this panel describes the requested configuration and last applied profile acknowledgement.</small>
          </section>

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
            <button className="button test-center-stop" disabled={busy} onClick={stopSession} type="button">Stop remote test</button>
          )}

          {session ? (
            <div className="test-center-session-meta">
              <span>Time remaining <strong>{remainingLabel(session.expires_at, now)}</strong></span>
              <span>Session <code>{session.id.slice(0, 8)}</code></span>
              <span>Device ACK <strong>{session.acknowledged_at ? timeAgo(session.acknowledged_at, now) : 'Pending'}</strong></span>
              <span>Last log <strong>{timeAgo(session.last_log_at, now)}</strong></span>
            </div>
          ) : null}
        </aside>

        <main className="fleet-panel test-center-console-panel">
          {isArchivedView ? (
            <div className={styles.readOnlyBanner}>
              <div><strong>Archived session</strong><span>{localTimestamp(displaySession?.started_at ?? null)} · read-only</span></div>
              <button onClick={() => setViewedSessionId(null)} type="button">Back to live</button>
            </div>
          ) : null}

          <div className="test-center-console-toolbar">
            <div>
              <span>{isArchivedView ? 'Archived console' : 'Live console'}</span>
              <strong>{selectedDevice?.device_code ?? 'No device selected'}</strong>
            </div>
            <div className="test-center-toolbar-actions">
              <button disabled={isArchivedView} onClick={togglePause} type="button">{paused ? `Resume (${pausedCount})` : 'Pause'}</button>
              <button onClick={() => setAutoScroll((current) => !current)} type="button">{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</button>
              <button onClick={clearLocal} type="button">Clear</button>
              <button disabled={filteredLogs.length === 0} onClick={() => void copyLogs()} type="button">Copy visible</button>
              <button disabled={!displaySession} onClick={exportSession} type="button">Export session</button>
            </div>
          </div>

          <section className={styles.logTools}>
            <label className={styles.logSearch}>
              <NavigationIcon kind="search" />
              <input aria-label="Search Test Center logs" onChange={(event) => setLogSearch(event.target.value)} placeholder="Search messages, categories or boot ID…" value={logSearch} />
            </label>
            <div aria-label="Log categories" className={styles.filterBar} role="group">
              {LOG_FILTERS.map((filter) => (
                <button
                  aria-pressed={logFilter === filter.key}
                  className={logFilter === filter.key ? styles.filterButtonActive : styles.filterButton}
                  key={filter.key}
                  onClick={() => setLogFilter(filter.key)}
                  type="button"
                >
                  {filter.label}<span>{filterCounts[filter.key]}</span>
                </button>
              ))}
            </div>
            <div className={styles.logResultMeta}>{filteredLogs.length} of {logs.length} lines shown{paused ? ` · ${pausedCount} buffered` : ''}</div>
          </section>

          <div className={`test-center-terminal ${styles.terminal}`} ref={terminalRef}>
            {filteredLogs.length === 0 ? (
              <div className="test-center-terminal-empty">
                <NavigationIcon kind="telemetry" />
                <strong>{logs.length > 0 ? 'No logs match these filters' : displaySession ? 'Waiting for console output' : 'Start a remote test session'}</strong>
                <span>{logs.length > 0 ? 'Change the category or search text to see captured lines.' : displaySession ? 'Machine, modem and system activity will appear here when the device sends it.' : 'Remote logging stays off until you explicitly start a session.'}</span>
              </div>
            ) : (
              filteredLogs.map((line) => {
                const important = importantLogKind(line);
                return (
                  <div
                    className={`test-center-line is-${lineTone(line.message)} ${important ? styles[`important${important[0].toUpperCase()}${important.slice(1)}` as keyof typeof styles] : ''}`}
                    key={line.id}
                  >
                    <time title={localTimestamp(line.received_at)}>{formatUptime(line.device_uptime_ms)}</time>
                    <pre>{line.message}</pre>
                  </div>
                );
              })
            )}
          </div>

          <section className="test-center-command-strip">
            <div>
              <span>Safe diagnostics</span>
              <small>No arbitrary AT commands or machine-control commands are exposed remotely.</small>
            </div>
            <div>
              {SAFE_COMMANDS.map((command) => (
                <button
                  disabled={!session || Boolean(viewedSessionId) || !session.acknowledged_at || Boolean(commandBusy)}
                  key={command}
                  onClick={() => void queueCommand(command)}
                  type="button"
                >
                  {commandBusy === command ? 'Queueing…' : command}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.commandHistory}>
            <div className={styles.sectionHeading}><span>Command status</span><strong>Latest diagnostics</strong></div>
            {commands.length === 0 ? <p>No diagnostic commands have been queued for this session.</p> : (
              <div className={styles.commandList}>
                {commands.map((command) => {
                  const visual = commandVisualStatus(command, now);
                  return (
                    <div className={styles.commandRow} key={command.id}>
                      <div><strong>{command.command}</strong><span>{localTimestamp(command.created_at)}</span></div>
                      <span className={`${styles.commandStatus} ${visual.tone}`}>{visual.label}</span>
                      <small>{command.response_note || (visual.label === 'Delayed' ? 'Device has not completed this command after 30 seconds.' : 'Awaiting device response.')}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      <section className={`fleet-panel ${styles.historyPanel}`}>
        <header className={styles.historyHeader}>
          <div><span>Diagnostics archive</span><h2>Session history</h2></div>
          <button onClick={() => void loadSessionHistory(selectedDeviceId)} type="button">Refresh history</button>
        </header>
        {historySessions.length === 0 ? <p>No previous Test Center sessions exist for this device.</p> : (
          <div className={styles.historyList}>
            {historySessions.map((item) => {
              const state = deriveJourneyState(item, now);
              const viewing = displaySession?.id === item.id;
              return (
                <article className={`${styles.historyItem} ${viewing ? styles.historyItemActive : ''}`} key={item.id}>
                  <div><strong>{journeyLabel(state)}</strong><span>{localTimestamp(item.started_at)}</span></div>
                  <div><span>Session</span><code>{item.id.slice(0, 8)}</code></div>
                  <div><span>Last log</span><strong>{timeAgo(item.last_log_at, now)}</strong></div>
                  <div><span>Ended</span><strong>{item.ended_at ? localTimestamp(item.ended_at) : item.status === 'active' ? 'Active' : item.status}</strong></div>
                  <button disabled={viewing} onClick={() => setViewedSessionId(item.id)} type="button">{viewing ? 'Viewing' : 'View session'}</button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
