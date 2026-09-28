'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineLocationPanel.module.css';

type LocationRow = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_source: string | null;
  location_fix_at: string | null;
  location_received_at: string | null;
  location_stale: boolean;
  movement_detected: boolean;
  distance_from_previous_m: number | null;
  last_transport: 'wifi' | 'cellular' | null;
  last_seen_at: string | null;
  has_location: boolean;
};

const REFRESH_MS = 30_000;

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSource(source: string | null) {
  if (!source) return 'Unknown';
  if (source === 'cellular_lbs') return 'Cellular LBS';
  if (source === 'gnss' || source === 'gps') return 'GNSS / GPS';
  if (source === 'site' || source === 'manual') return 'Assigned site';
  return source.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceIsApproximate(source: string | null) {
  return source === 'cellular_lbs';
}

export function MachineLocationPanel({ machineId }: { machineId: string }) {
  const [row, setRow] = useState<LocationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_location_map');

    if (loadError) {
      setError(loadError.message);
      if (!background) setLoading(false);
      return;
    }

    const match = ((data ?? []) as LocationRow[]).find((candidate) => candidate.machine_id === machineId) ?? null;
    setRow(match);
    setError(null);
    setLoading(false);
  }, [machineId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const hasCoordinates = row?.has_location
    && typeof row.latitude === 'number'
    && typeof row.longitude === 'number';
  const approximate = sourceIsApproximate(row?.location_source ?? null);
  const coordinateText = useMemo(() => {
    if (!hasCoordinates || !row) return 'No device location received';
    return `${row.latitude!.toFixed(5)}, ${row.longitude!.toFixed(5)}`;
  }, [hasCoordinates, row]);

  return (
    <section className={styles.panel} aria-labelledby="machine-location-heading">
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>Location</p>
          <h2 id="machine-location-heading">Machine location</h2>
          <p className={styles.subtitle}>Latest position reported by the linked telemetry device.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <Link href="/map" className={styles.mapLink}>Open fleet map</Link>
        </div>
      </div>

      {loading && !row ? <p className={styles.state}>Loading location…</p> : null}
      {error ? <p className={styles.error}>Location could not be loaded: {error}</p> : null}

      {!loading && !error && !row ? (
        <div className={styles.emptyState}>
          <strong>No linked-device location yet</strong>
          <span>The machine will appear here and on the fleet map after a location update is received.</span>
        </div>
      ) : null}

      {row ? (
        <>
          <div className={styles.statusRow}>
            <span className={styles.sourceBadge}>{formatSource(row.location_source)}</span>
            {approximate ? <span className={styles.approxBadge}>Approximate</span> : null}
            {row.location_stale ? <span className={styles.staleBadge}>Stale</span> : null}
            {row.movement_detected ? <span className={styles.moveBadge}>Movement detected</span> : null}
          </div>

          <div className={styles.grid}>
            <div className={styles.metric}>
              <span>Coordinates</span>
              <strong>{coordinateText}</strong>
            </div>
            <div className={styles.metric}>
              <span>Last fix</span>
              <strong>{formatDate(row.location_fix_at ?? row.location_received_at)}</strong>
            </div>
            <div className={styles.metric}>
              <span>Device</span>
              <strong>{row.device_code || 'Unknown'}</strong>
            </div>
            <div className={styles.metric}>
              <span>Transport</span>
              <strong>{row.last_transport ? row.last_transport.toUpperCase() : 'Unknown'}</strong>
            </div>
            <div className={styles.metric}>
              <span>Accuracy</span>
              <strong>{row.accuracy_m != null ? `±${Math.round(row.accuracy_m)} m` : approximate ? 'Network estimate' : 'Not reported'}</strong>
            </div>
            <div className={styles.metric}>
              <span>Last telemetry</span>
              <strong>{formatDate(row.last_seen_at)}</strong>
            </div>
          </div>

          {row.distance_from_previous_m != null ? (
            <p className={styles.movementNote}>Distance from previous fix: {Math.round(row.distance_from_previous_m)} m.</p>
          ) : null}

          {approximate ? (
            <p className={styles.accuracyNote}>
              Cellular LBS is an approximate network-derived position based on the mobile network. It is not a GPS/GNSS fix and should not be treated as street-level precision.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
