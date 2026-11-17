export type FirmwareState = {
  rollback_capable: boolean;
  trust_ready: boolean;
  running_version: string | null;
  reported_at: string;
  highwater: number;
};
export function TelemetryFirmwareStatus({
  state,
  now = Date.now(),
}: {
  state: FirmwareState | null;
  now?: number;
}) {
  const age = state ? now - new Date(state.reported_at).getTime() : NaN;
  const fresh = Number.isFinite(age) && age >= 0 && age <= 300000;
  return (
    <div aria-live="polite">
      <p>
        <strong>Cellular is always preferred.</strong> Configured Wi-Fi is used
        for fallback.
      </p>
      {!state ? (
        <p>
          Update capability not reported. Install the bootstrap firmware over
          USB first.
        </p>
      ) : (
        <>
          <p>Running firmware: {state.running_version ?? 'Not reported'}</p>
          <p>
            Automatic boot rollback:{' '}
            {state.rollback_capable
              ? 'Available'
              : 'Unavailable — USB bootloader setup required'}
          </p>
          <p>
            Firmware signature verification:{' '}
            {state.trust_ready ? 'Configured' : 'Public trust keys required'}
          </p>
          {!fresh && (
            <p>
              Device update capability is outdated. Wait for a fresh heartbeat.
            </p>
          )}
        </>
      )}
      <p>
        A trial update must report healthy before it is retained. An
        unsuccessful trial returns to the previous firmware.
      </p>
    </div>
  );
}
