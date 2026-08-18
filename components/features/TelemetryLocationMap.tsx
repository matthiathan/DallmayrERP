/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';

type LocationRow = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  machine_status: string;
  active_fault_count: number;
  last_seen_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  location_enabled: boolean;
  location_interval_minutes: number;
  location_min_move_m: number;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  satellites: number | null;
  hdop: number | null;
  location_source: string | null;
  location_fix_at: string | null;
  location_received_at: string | null;
  movement_detected: boolean;
  distance_from_previous_m: number | null;
  location_stale: boolean;
  has_location: boolean;
};

type Point = LocationRow & { latitude: number; longitude: number };

type WorldPoint = { x: number; y: number };

const TILE_SIZE = 256;
const MAP_HEIGHT = 520;
const SOUTH_AFRICA_CENTER = { latitude: -30.5595, longitude: 22.9375 };

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function online(lastSeen: string | null) {
  return Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() <= 30 * 60 * 1000);
}

function clampLatitude(latitude: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

function worldPoint(latitude: number, longitude: number, zoom: number): WorldPoint {
  const lat = clampLatitude(latitude) * Math.PI / 180;
  const worldSize = TILE_SIZE * (2 ** zoom);
  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: (1 - Math.log(Math.tan(lat) + (1 / Math.cos(lat))) / Math.PI) / 2 * worldSize,
  };
}

function markerColor(row: LocationRow) {
  if (!online(row.last_seen_at)) return '#6b7280';
  if (row.active_fault_count > 0 || ['fault', 'critical'].includes(row.machine_status)) return '#dc2626';
  if (row.location_stale) return '#d97706';
  return '#16a34a';
}

function machineLabel(row: LocationRow) {
  return row.machine_name ?? row.serial_number ?? row.device_code;
}

function sourceLabel(source: string | null) {
  if (!source) return 'No location';
  if (source === 'gnss') return 'GNSS/GPS';
  if (source === 'site') return 'ERP site fallback';
  if (source === 'last_known') return 'Last known';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function TelemetryMapCanvas({ points }: { points: Point[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState(points.length === 1 ? 13 : 5);
  const [center, setCenter] = useState(() => points.length
    ? { latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length, longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length }
    : SOUTH_AFRICA_CENTER);
  const [selected, setSelected] = useState<Point | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(320, element.clientWidth)));
    observer.observe(element);
    setWidth(Math.max(320, element.clientWidth));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!points.length) return;
    setCenter({
      latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
      longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
    });
    setZoom(points.length === 1 ? 13 : 5);
  }, [points]);

  const map = useMemo(() => {
    const centerWorld = worldPoint(center.latitude, center.longitude, zoom);
    const minTileX = Math.floor((centerWorld.x - width / 2) / TILE_SIZE) - 1;
    const maxTileX = Math.floor((centerWorld.x + width / 2) / TILE_SIZE) + 1;
    const minTileY = Math.floor((centerWorld.y - MAP_HEIGHT / 2) / TILE_SIZE) - 1;
    const maxTileY = Math.floor((centerWorld.y + MAP_HEIGHT / 2) / TILE_SIZE) + 1;
    const tiles: Array<{ x: number; y: number; key: string; left: number; top: number }> = [];
    const tileCount = 2 ** zoom;

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          x: wrappedX,
          y: tileY,
          key: `${zoom}-${tileX}-${tileY}`,
          left: tileX * TILE_SIZE - centerWorld.x + width / 2,
          top: tileY * TILE_SIZE - centerWorld.y + MAP_HEIGHT / 2,
        });
      }
    }

    const markers = points.map((point) => {
      const projected = worldPoint(point.latitude, point.longitude, zoom);
      return {
        point,
        left: projected.x - centerWorld.x + width / 2,
        top: projected.y - centerWorld.y + MAP_HEIGHT / 2,
      };
    });

    return { tiles, markers };
  }, [center, points, width, zoom]);

  function focus(point: Point) {
    setCenter({ latitude: point.latitude, longitude: point.longitude });
    setZoom(15);
    setSelected(point);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="button secondary" type="button" onClick={() => setZoom((value) => Math.min(18, value + 1))}>Zoom +</button>
        <button className="button secondary" type="button" onClick={() => setZoom((value) => Math.max(3, value - 1))}>Zoom −</button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            if (!points.length) return;
            setCenter({
              latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
              longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
            });
            setZoom(points.length === 1 ? 13 : 5);
            setSelected(null);
          }}
        >
          Fit machines
        </button>
      </div>

      <div
        ref={containerRef}
        style={{
          height: MAP_HEIGHT,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 16,
          border: '1px solid var(--border, #d1d5db)',
          background: '#e5e7eb',
        }}
        aria-label="Telemetry machine location map"
      >
        {map.tiles.map((tile) => (
          <img
            alt=""
            aria-hidden="true"
            key={tile.key}
            src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
            style={{ position: 'absolute', width: TILE_SIZE, height: TILE_SIZE, left: tile.left, top: tile.top, userSelect: 'none' }}
          />
        ))}

        {map.markers.map(({ point, left, top }) => (
          <button
            key={point.device_id}
            type="button"
            title={`${machineLabel(point)} · ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`}
            onClick={() => focus(point)}
            style={{
              position: 'absolute',
              left: left - 9,
              top: top - 18,
              width: 18,
              height: 18,
              borderRadius: '50% 50% 50% 0',
              transform: 'rotate(-45deg)',
              background: markerColor(point),
              border: '2px solid white',
              boxShadow: '0 1px 5px rgba(0,0,0,.35)',
              cursor: 'pointer',
              zIndex: selected?.device_id === point.device_id ? 6 : 4,
            }}
            aria-label={`Locate ${machineLabel(point)}`}
          />
        ))}

        {selected ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 34,
              zIndex: 8,
              maxWidth: 380,
              padding: 14,
              borderRadius: 12,
              background: 'rgba(255,255,255,.96)',
              color: '#111827',
              boxShadow: '0 8px 24px rgba(0,0,0,.22)',
            }}
          >
            <strong>{machineLabel(selected)}</strong>
            <div>{selected.device_code}</div>
            <div>{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</div>
            <div>{sourceLabel(selected.location_source)} · Accuracy {selected.accuracy_m === null ? 'n/a' : `${Math.round(selected.accuracy_m)} m`}</div>
            <div>Last fix: {formatDate(selected.location_fix_at ?? selected.location_received_at)}</div>
            <div>{selected.active_fault_count} active fault(s) · {selected.last_transport ?? 'no network yet'}</div>
            <button className="button secondary" type="button" style={{ marginTop: 8 }} onClick={() => setSelected(null)}>Close</button>
          </div>
        ) : null}

        <div style={{ position: 'absolute', right: 8, bottom: 5, zIndex: 7, fontSize: 11, background: 'rgba(255,255,255,.85)', padding: '2px 5px', color: '#111827' }}>
          © OpenStreetMap contributors
        </div>
      </div>
    </div>
  );
}

export function TelemetryLocationMap() {
  const { userDetails } = useAuth();
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [movedOnly, setMovedOnly] = useState(false);

  const canControl = ['admin', 'operations'].includes(userDetails?.role ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_location_map');
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as LocationRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine locations.');
      setLoading(false);
    });
  }, [load]);

  async function updateLocationControl(row: LocationRow, changes: { enabled?: boolean; interval?: number; minMove?: number }) {
    setSaving(row.device_id);
    setError(null);
    setMessage(null);
    const { error: updateError } = await getSupabaseClient().rpc('set_telemetry_device_location_control', {
      p_device_code: row.device_code,
      p_location_enabled: changes.enabled ?? null,
      p_location_interval_minutes: changes.interval ?? null,
      p_location_min_move_m: changes.minMove ?? null,
    });
    setSaving(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage(`${row.device_code} location control updated. The device will apply it on its next config sync.`);
    await load();
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (movedOnly && !row.movement_detected) return false;
      if (!needle) return true;
      return [row.device_code, row.machine_name, row.serial_number, row.branch]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [movedOnly, rows, search]);

  const points = useMemo(() => filtered.filter((row): row is Point => (
    row.has_location && typeof row.latitude === 'number' && typeof row.longitude === 'number'
  )), [filtered]);

  return (
    <section className="neo-card spatial-card">
      <div className="page-header">
        <div>
          <div className="badge">Machine location</div>
          <h2>Telemetry device map</h2>
          <p>
            Fresh GNSS fixes are used when available. Assigned ERP site coordinates are shown as a clearly labelled fallback; they are not presented as live GPS.
          </p>
        </div>
        <button className="button secondary" type="button" disabled={loading} onClick={() => load()}>Refresh</button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {loading && rows.length === 0 ? <HamsterLoader label="Loading telemetry locations" /> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          aria-label="Search machine locations"
          placeholder="Search machine, S/N, device or branch"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ minWidth: 280 }}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={movedOnly} onChange={(event) => setMovedOnly(event.target.checked)} />
          Moved machines only
        </label>
      </div>

      {!loading && rows.length === 0 ? <p>No active telemetry devices are registered.</p> : null}
      {!loading && rows.length > 0 && points.length === 0 ? (
        <div className="error">No telemetry devices currently have GNSS coordinates or ERP site coordinates. Devices will appear on the map as soon as a valid location is received.</div>
      ) : null}

      {points.length > 0 ? <TelemetryMapCanvas points={points} /> : null}

      {filtered.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Location</th>
                <th>Source</th>
                <th>Movement</th>
                <th>GPS/location control</th>
                <th>Last fix</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const rowSaving = saving === row.device_id;
                return (
                  <tr key={row.device_id}>
                    <td>
                      <strong>{machineLabel(row)}</strong>
                      <div className="muted">{row.serial_number ?? row.device_code}</div>
                    </td>
                    <td>
                      {row.has_location && row.latitude !== null && row.longitude !== null
                        ? `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`
                        : 'No location yet'}
                      <div className="muted">{row.branch}</div>
                    </td>
                    <td>
                      <StatusBadge value={row.location_stale ? 'stale' : (row.location_source ?? 'unknown')} />
                      <div className="muted">{sourceLabel(row.location_source)}</div>
                      {row.accuracy_m !== null ? <div className="muted">±{Math.round(row.accuracy_m)} m · {row.satellites ?? '?'} satellites</div> : null}
                    </td>
                    <td>
                      <StatusBadge value={row.movement_detected ? 'moved' : 'stationary'} />
                      {row.distance_from_previous_m !== null ? <div className="muted">{Math.round(row.distance_from_previous_m)} m since prior fix</div> : null}
                    </td>
                    <td>
                      {canControl ? (
                        <div className="grid">
                          <label>
                            <input
                              type="checkbox"
                              checked={row.location_enabled}
                              disabled={rowSaving}
                              onChange={(event) => updateLocationControl(row, { enabled: event.target.checked })}
                            />{' '}
                            Location enabled
                          </label>
                          <select
                            aria-label={`Location interval for ${row.device_code}`}
                            disabled={rowSaving}
                            value={row.location_interval_minutes}
                            onChange={(event) => updateLocationControl(row, { interval: Number(event.target.value) })}
                          >
                            <option value={1}>Every 1 min</option>
                            <option value={5}>Every 5 min</option>
                            <option value={15}>Every 15 min</option>
                            <option value={30}>Every 30 min</option>
                            <option value={60}>Every hour</option>
                            <option value={240}>Every 4 hours</option>
                            <option value={1440}>Daily</option>
                          </select>
                          <select
                            aria-label={`Movement threshold for ${row.device_code}`}
                            disabled={rowSaving}
                            value={row.location_min_move_m}
                            onChange={(event) => updateLocationControl(row, { minMove: Number(event.target.value) })}
                          >
                            <option value={25}>Movement: 25 m</option>
                            <option value={50}>Movement: 50 m</option>
                            <option value={100}>Movement: 100 m</option>
                            <option value={250}>Movement: 250 m</option>
                            <option value={500}>Movement: 500 m</option>
                          </select>
                        </div>
                      ) : (
                        `${row.location_enabled ? 'Enabled' : 'Disabled'} · ${row.location_interval_minutes} min`
                      )}
                    </td>
                    <td>
                      {formatDate(row.location_fix_at ?? row.location_received_at)}
                      <div className="muted">Device: {online(row.last_seen_at) ? 'online' : 'offline'} · {row.last_transport ?? 'no transport'}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
