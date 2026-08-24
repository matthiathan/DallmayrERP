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

type ManualEnrollmentToken = {
  token_id: string;
  hardware_uid: string;
  expires_at: string;
  seconds_remaining: number;
  token: string;
};

type ManualEnrollmentTokenStatus = {
  status?: 'active' | 'used' | 'expired' | 'revoked' | 'missing';
  seconds_remaining?: number;
};

function normalizeStatus(value: unknown): EnrollmentWindowStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { active: false, status: 'none' };
  }
  return value as EnrollmentWindowStatus;
}

function normalizeManualToken(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.token_id !== 'string'
    || typeof candidate.hardware_uid !== 'string'
    || typeof candidate.expires_at !== 'string'
  ) return null;

  return {
    token_id: candidate.token_id,
    hardware_uid: candidate.hardware_uid,
    expires_at: candidate.expires_at,
    seconds_remaining: Number(candidate.seconds_remaining ?? 600),
  };
}

function generateOneTimeToken() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const [manualToken, setManualToken] = useState<ManualEnrollmentToken | null>(null);
  const manualTokenId = manualToken?.token_id;
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
    if (next.active && next.expected_hardware_uid) {
      setExpectedUid((current) => current || next.expected_hardware_uid || '');
    }
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

  useEffect(() => {
    if (!manualTokenId) return;
    const countdown = window.setInterval(() => {
      setManualToken((current) => current
        ? { ...current, seconds_remaining: Math.max(0, current.seconds_remaining - 1) }
        : null);
    }, 1_000);
    return () => window.clearInterval(countdown);
  }, [manualTokenId]);

  useEffect(() => {
    if (!manualTokenId) return;
    const tokenId = manualTokenId;
    let settled = false;

    async function checkManualToken() {
      const { data, error: requestError } = await getSupabaseClient().rpc(
        'get_telemetry_enrollment_token_status',
        { p_token_id: tokenId },
      );
      if (settled) return;
      if (requestError) {
        setError(requestError.message);
        return;
      }

      const tokenStatus = data && typeof data === 'object' && !Array.isArray(data)
        ? data as ManualEnrollmentTokenStatus
        : {};
      if (tokenStatus.status === 'used') {
        settled = true;
        setManualToken(null);
        setNotice('The telemetry device enrolled successfully with the one-time token.');
        await onDeviceEnrolled?.();
      } else if (tokenStatus.status === 'expired' || tokenStatus.status === 'revoked' || tokenStatus.status === 'missing') {
        settled = true;
        setManualToken(null);
        setNotice(`The one-time enrollment token is ${tokenStatus.status}. Generate another token if required.`);
      } else if (typeof tokenStatus.seconds_remaining === 'number') {
        setManualToken((current) => current?.token_id === tokenId
          ? { ...current, seconds_remaining: tokenStatus.seconds_remaining ?? current.seconds_remaining }
          : current);
      }
    }

    void checkManualToken();
    const refreshTimer = window.setInterval(() => void checkManualToken(), 5_000);
    return () => {
      settled = true;
      window.clearInterval(refreshTimer);
    };
  }, [manualTokenId, onDeviceEnrolled]);

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

  async function createManualToken() {
    const uid = (
      status.active
        ? status.expected_hardware_uid || ''
        : expectedUid || status.expected_hardware_uid || ''
    ).trim().toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(uid)) {
      setError('Enter the 12-character ESP32 hardware UID before generating a token.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = generateOneTimeToken();
      const tokenHash = await sha256Hex(token);
      const { data, error: requestError } = await getSupabaseClient().rpc(
        'create_telemetry_enrollment_token',
        {
          p_hardware_uid: uid,
          p_token_hash: tokenHash,
          p_minutes: 10,
          p_label: 'DallmayrERP manual enrollment',
        },
      );
      if (requestError) {
        setError(requestError.message);
        return;
      }

      const issued = normalizeManualToken(data);
      if (!issued) {
        setError('Supabase returned an invalid enrollment-token response.');
        return;
      }

      setExpectedUid(uid);
      setManualToken({ ...issued, token });
      setNotice('A UID-bound token was generated. It will be shown only until this page is refreshed or the token expires.');
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'The one-time enrollment token could not be generated.');
    } finally {
      setBusy(false);
    }
  }

  async function copyManualTokenCommand() {
    if (!manualToken) return;
    try {
      await navigator.clipboard.writeText(`ENROLL TOKEN ${manualToken.token}`);
      setError(null);
      setNotice('The enrollment command was copied. Paste it into the ESP32 serial console.');
    } catch {
      setError('The browser could not access the clipboard. Select and copy the command manually.');
    }
  }

  async function revokeManualToken() {
    if (!manualToken) return;
    setBusy(true);
    setError(null);
    const { error: requestError } = await getSupabaseClient().rpc(
      'revoke_telemetry_enrollment_token',
      { p_token_id: manualToken.token_id },
    );
    setBusy(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }

    setManualToken(null);
    setNotice('The one-time enrollment token was revoked.');
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
          <h2 id="telemetry-enrollment-heading">Device enrollment</h2>
          <p>Allow one controller automatically, or generate a UID-bound one-time token for manual enrollment through the ESP32 serial console.</p>
        </div>
        <span className={`fleet-status-pill ${status.active || manualToken ? 'is-success' : 'is-neutral'}`}>
          <i />{manualToken ? 'Manual token active' : status.active ? 'Enrollment open' : 'Enrollment closed'}
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

      {manualToken ? <div className="device-manual-token" role="status">
        <div>
          <span>One-time serial command</span>
          <code>ENROLL TOKEN {manualToken.token}</code>
          <small>Locked to UID {manualToken.hardware_uid} · expires in {formatRemaining(manualToken.seconds_remaining)}</small>
        </div>
        <p>Paste this complete command into the ESP32 serial console. The plaintext token is not stored by Supabase and cannot be shown again after this page is refreshed.</p>
        <div className="device-enrollment-actions">
          <button className="fleet-button" disabled={busy} onClick={copyManualTokenCommand} type="button">Copy command</button>
          <button className="fleet-button secondary" disabled={busy} onClick={revokeManualToken} type="button">Revoke token</button>
        </div>
      </div> : null}

      <form className="device-enrollment-form" onSubmit={openWindow}>
        <label htmlFor="expected-telemetry-hardware-uid">
          <span>ESP32 hardware UID <small>Required for a manual token</small></span>
          <input
            autoComplete="off"
            disabled={busy || loading || status.active || Boolean(manualToken)}
            id="expected-telemetry-hardware-uid"
            maxLength={12}
            onChange={(event) => setExpectedUid(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
            placeholder="Example: B81F3FDA1CD8"
            spellCheck={false}
            value={expectedUid}
          />
        </label>
        <div className="device-enrollment-actions">
          <button className="fleet-button" disabled={busy || loading || status.active || Boolean(manualToken)} type="submit">
            <NavigationIcon kind="telemetry" />{busy ? 'Please wait…' : 'Allow next device'}
          </button>
          <button
            className="fleet-button secondary"
            disabled={busy || loading || Boolean(manualToken) || !/^[0-9A-F]{12}$/.test((status.active ? status.expected_hardware_uid || '' : expectedUid || status.expected_hardware_uid || '').trim().toUpperCase())}
            onClick={createManualToken}
            type="button"
          >Generate one-time token</button>
          {status.active ? <button className="fleet-button secondary" disabled={busy} onClick={closeWindow} type="button">Close enrollment</button> : null}
        </div>
      </form>
    </section>
  );
}
