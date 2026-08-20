'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';

type EnrollmentWindowStatus = {
  active: boolean;
  window_id?: string | null;
  status?: 'none' | 'open' | 'exhausted' | 'cancelled' | 'expired';
  label?: string | null;
  expected_hardware_uid?: string | null;
  max_devices?: number;
  claimed_devices?: number;
  opened_at?: string;
  expires_at?: string;
  seconds_remaining?: number;
};

type TelemetryEnrollmentWindowControlProps = {
  onDeviceEnrolled?: () => void | Promise<void>;
};

function normalizeStatus(value: unknown): EnrollmentWindowStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { active: false, status: 'none' };
  }
  return value as EnrollmentWindowStatus;
}

function formatRemaining(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function TelemetryEnrollmentWindowControl({ onDeviceEnrolled }: TelemetryEnrollmentWindowControlProps) {
  const [status, setStatus] = useState<EnrollmentWindowStatus>({ active: false, status: 'none' });
  const [expectedUid, setExpectedUid] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previousStatus = useRef<EnrollmentWindowStatus>({ active: false, status: 'none' });

  const refresh = useCallback(async () => {
    const { data, error: requestError } = await getSupabaseClient().rpc(
      'get_telemetry_enrollment_window_status',
    );
    setLoading(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }

    const next = normalizeStatus(data);
    const wasWaiting = previousStatus.current.active;
    previousStatus.current = next;
    setStatus(next);
    setRemaining(next.seconds_remaining ?? 0);
    setError(null);

    if (wasWaiting && next.status === 'exhausted') {
      setNotice('The new telemetry device registered successfully.');
      await onDeviceEnrolled?.();
    }
  }, [onDeviceEnrolled]);

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(refreshTimer);
  }, [refresh]);

  useEffect(() => {
    if (!status.active) return;
    const countdown = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(countdown);
  }, [status.active, status.window_id]);

  const summary = useMemo(() => {
    if (loading) return 'Checking enrollment status…';
    if (status.active) {
      return status.expected_hardware_uid
        ? `Waiting for ESP32 ${status.expected_hardware_uid}`
        : 'Waiting for the next new telemetry device';
    }
    if (status.status === 'exhausted') return 'The last enrollment window was claimed successfully.';
    if (status.status === 'expired') return 'The last enrollment window expired without a device.';
    if (status.status === 'cancelled') return 'The last enrollment window was closed.';
    return 'No enrollment window is open.';
  }, [loading, status]);

  async function openWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const uid = expectedUid.trim().toUpperCase();
    if (uid && !/^[0-9A-F]{12}$/.test(uid)) {
      setError('Hardware UID must contain exactly 12 hexadecimal characters.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: requestError } = await getSupabaseClient().rpc(
      'open_telemetry_enrollment_window',
      {
        p_minutes: 10,
        p_max_devices: 1,
        p_label: 'DallmayrERP allow next device',
        p_expected_hardware_uid: uid || null,
      },
    );
    setBusy(false);

    if (requestError) {
      setError(requestError.message);
      return;
    }

    const next = normalizeStatus(data);
    previousStatus.current = next;
    setStatus(next);
    setRemaining(next.seconds_remaining ?? 600);
    setNotice('Enrollment is open for one device and will close automatically.');
  }

  async function closeWindow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: requestError } = await getSupabaseClient().rpc(
      'close_telemetry_enrollment_window',
    );
    setBusy(false);

    if (requestError) {
      setError(requestError.message);
      return;
    }

    setNotice('Enrollment window closed.');
    await refresh();
  }

  return (
    <section aria-labelledby="telemetry-enrollment-heading" className="fleet-panel device-enrollment-panel">
      <div className="device-enrollment-heading">
        <div>
          <span>Telemetry security</span>
          <h2 id="telemetry-enrollment-heading">Automatic device enrollment</h2>
          <p>Allow one new controller to register during a secure ten-minute window. The window closes as soon as it is claimed.</p>
        </div>
        <span className={`fleet-status-pill ${status.active ? 'is-success' : 'is-neutral'}`}>
          <i />{status.active ? 'Enrollment open' : 'Enrollment closed'}
        </span>
      </div>

      <div aria-live="polite" className="device-enrollment-status">
        <strong>{summary}</strong>
        {status.active ? <>
          <span>Time remaining: {formatRemaining(remaining)}</span>
          <span>Claimed: {status.claimed_devices ?? 0}/{status.max_devices ?? 1}</span>
        </> : null}
      </div>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Enrollment control failed.</strong><span>{error}</span></div> : null}
      {notice ? <div className="fleet-banner is-success" role="status"><strong>Enrollment updated.</strong><span>{notice}</span></div> : null}

      <form className="device-enrollment-form" onSubmit={openWindow}>
        <label htmlFor="expected-telemetry-hardware-uid">
          <span>ESP32 hardware UID <small>Optional extra security</small></span>
          <input
            autoComplete="off"
            disabled={busy || loading || status.active}
            id="expected-telemetry-hardware-uid"
            maxLength={12}
            onChange={(event) => setExpectedUid(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
            placeholder="Example: B81F3FDA1CD8"
            spellCheck={false}
            value={expectedUid}
          />
        </label>
        <div className="device-enrollment-actions">
          <button className="fleet-button" disabled={busy || loading || status.active} type="submit">
            <NavigationIcon kind="telemetry" />{busy ? 'Please wait…' : 'Allow next device'}
          </button>
          {status.active ? <button className="fleet-button secondary" disabled={busy} onClick={closeWindow} type="button">Close enrollment</button> : null}
        </div>
      </form>
    </section>
  );
}
