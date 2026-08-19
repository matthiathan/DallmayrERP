'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Point as GeoJsonPoint } from 'geojson';
import {
  AttributionControl,
  FullscreenControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
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

type MachinePoint = LocationRow & { latitude: number; longitude: number };
type MapHealth = 'online' | 'stale' | 'fault' | 'offline';
type MachineProperties = {
  deviceId: string;
  machineId: string;
  label: string;
  health: MapHealth;
  faults: number;
  moved: number;
};

const MAP_REFRESH_MS = 15_000;
const TABLE_PAGE_SIZE = 100;
const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SOUTH_AFRICA_CENTER: [number, number] = [22.9375, -30.5595];

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTime(value: Date | null) {
  if (!value) return 'Not yet';
  return value.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function online(lastSeen: string | null) {
  return Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() <= 30 * 60 * 1000);
}

function mapHealth(row: LocationRow): MapHealth {
  if (row.active_fault_count > 0 || ['fault', 'critical'].includes(row.machine_status)) return 'fault';
  if (!online(row.last_seen_at)) return 'offline';
  if (row.location_stale) return 'stale';
  return 'online';
}

function machineLabel(row: LocationRow) {
  return row.machine_name ?? row.serial_number ?? row.device_code;
}

function sourceLabel(source: string | null) {
  if (!source) return 'No location';
  if (source === 'gnss') return 'GNSS/GPS';
  if (source === 'site') return 'ERP site fallback';
  if (source === 'last_known') return 'Last known';
  if (source === 'manual') return 'Manual fallback';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function locationAge(row: LocationRow) {
  const value = row.location_fix_at ?? row.location_received_at;
  if (!value) return 'No fix';
  const ageMs = Math.max(0, Date.now() - new Date(value).getTime());
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)} sec ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} min ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)} hr ago`;
  return `${Math.floor(ageMs / 86_400_000)} day(s) ago`;
}

function pointCollection(points: MachinePoint[]): FeatureCollection<GeoJsonPoint, MachineProperties> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      id: point.device_id,
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
      properties: {
        deviceId: point.device_id,
        machineId: point.machine_id ?? '',
        label: machineLabel(point),
        health: mapHealth(point),
        faults: point.active_fault_count,
        moved: point.movement_detected ? 1 : 0,
      },
    })),
  };
}

function fitMapToPoints(map: MapLibreMap, points: MachinePoint[]) {
  if (points.length === 0) {
    map.easeTo({ center: SOUTH_AFRICA_CENTER, zoom: 4.3, duration: 600 });
    return;
  }
  if (points.length === 1) {
    map.easeTo({ center: [points[0].longitude, points[0].latitude], zoom: 15, duration: 700 });
    return;
  }

  const bounds = new LngLatBounds();
  points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
  map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 700 });
}

function TelemetryMapCanvas({
  points,
  selectedDeviceId,
  onSelect,
  compact = false,
}: {
  points: MachinePoint[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string | null) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pointsRef = useRef(points);
  const onSelectRef = useRef(onSelect);
  const fittedDevicesRef = useRef('');
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  pointsRef.current = points;
  onSelectRef.current = onSelect;

  const selected = useMemo(
    () => points.find((point) => point.device_id === selectedDeviceId) ?? null,
    [points, selectedDeviceId],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OPEN_FREE_MAP_STYLE,
      center: SOUTH_AFRICA_CENTER,
      zoom: 4.3,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    });
    mapRef.current = map;
    let initialLoadComplete = false;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new FullscreenControl(), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');
    map.addControl(new AttributionControl({
      compact: true,
      customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    }));

    map.once('load', () => {
      initialLoadComplete = true;
      map.addSource('machine-locations', {
        type: 'geojson',
        data: pointCollection(pointsRef.current),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 48,
      });

      map.addLayer({
        id: 'machine-clusters',
        type: 'circle',
        source: 'machine-locations',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#1b6ca8', 25, '#0b486b', 100, '#0b2638'],
          'circle-radius': ['step', ['get', 'point_count'], 19, 25, 25, 100, 33],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.94,
        },
      });

      map.addLayer({
        id: 'machine-cluster-count',
        type: 'symbol',
        source: 'machine-locations',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,.25)',
          'text-halo-width': 1,
        },
      });

      map.addLayer({
        id: 'machine-movement-halo',
        type: 'circle',
        source: 'machine-locations',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'moved'], 1]],
        paint: {
          'circle-color': '#2684d9',
          'circle-radius': 13,
          'circle-opacity': 0.22,
        },
      });

      map.addLayer({
        id: 'machine-points',
        type: 'circle',
        source: 'machine-locations',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'health'],
            'fault', '#d71920',
            'offline', '#667085',
            'stale', '#f2a900',
            '#20a35a',
          ],
          'circle-radius': ['case', ['==', ['get', 'moved'], 1], 8, 6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      map.on('click', 'machine-clusters', async (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['machine-clusters'] })[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const clusterId = Number(feature.properties?.cluster_id);
        const source = map.getSource('machine-locations') as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
      });

      map.on('click', 'machine-points', (event) => {
        const deviceId = String(event.features?.[0]?.properties?.deviceId ?? '');
        if (deviceId) onSelectRef.current(deviceId);
      });

      for (const layer of ['machine-clusters', 'machine-points']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      setReady(true);
      setMapError(null);
      fittedDevicesRef.current = pointsRef.current.map((point) => point.device_id).sort().join('|');
      fitMapToPoints(map, pointsRef.current);
    });

    map.on('error', (event) => {
      if (!initialLoadComplete) setMapError(event.error?.message ?? 'The map tiles could not be loaded.');
    });

    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const source = mapRef.current.getSource('machine-locations') as GeoJSONSource | undefined;
    source?.setData(pointCollection(points));

    const signature = points.map((point) => point.device_id).sort().join('|');
    if (signature !== fittedDevicesRef.current) {
      fittedDevicesRef.current = signature;
      fitMapToPoints(mapRef.current, points);
    }
  }, [points, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current || !selected) return;
    mapRef.current.easeTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 14),
      duration: 650,
    });
  }, [ready, selected]);

  return (
    <div className={`telemetry-tracker ${compact ? 'is-compact' : ''}`}>
      {!compact ? <div className="telemetry-map-toolbar">
        <div className="telemetry-map-legend" aria-label="Machine map status legend">
          <span><i className="is-online" />Online</span>
          <span><i className="is-stale" />Stale location</span>
          <span><i className="is-fault" />Fault</span>
          <span><i className="is-offline" />Offline</span>
        </div>
        <button className="fleet-button secondary" type="button" onClick={() => {
          if (mapRef.current) fitMapToPoints(mapRef.current, points);
          onSelect(null);
        }}>Fit all machines</button>
      </div> : null}

      <div className="telemetry-tracker-map">
        <div
          aria-label="Interactive machine tracker map. Use the controls to zoom and drag the map. The table below provides the same locations in text."
          className="telemetry-tracker-canvas"
          ref={containerRef}
          role="application"
        />
        {!ready && !mapError ? <div className="telemetry-map-loading"><HamsterLoader label="Loading open-source map" /></div> : null}
        {mapError ? <div className="telemetry-map-error" role="alert"><strong>Map unavailable</strong><span>{mapError}</span></div> : null}

        {selected && !compact ? (
          <aside aria-live="polite" className="telemetry-map-selection">
            <header><div><span>{selected.device_code}</span><h3>{machineLabel(selected)}</h3></div><button aria-label="Close machine map details" onClick={() => onSelect(null)} type="button">×</button></header>
            <StatusBadge value={mapHealth(selected)} />
            <dl>
              <div><dt>Coordinates</dt><dd>{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</dd></div>
              <div><dt>Location source</dt><dd>{sourceLabel(selected.location_source)}</dd></div>
              <div><dt>Accuracy</dt><dd>{selected.accuracy_m === null ? 'Not reported' : `±${Math.round(selected.accuracy_m)} m`}</dd></div>
              <div><dt>Last fix</dt><dd>{formatDate(selected.location_fix_at ?? selected.location_received_at)}</dd></div>
              <div><dt>Movement</dt><dd>{selected.movement_detected ? `Moved ${Math.round(selected.distance_from_previous_m ?? 0)} m` : 'Stationary'}</dd></div>
              <div><dt>Active faults</dt><dd>{selected.active_fault_count}</dd></div>
            </dl>
            {selected.machine_id ? <Link className="fleet-button" href={`/machines/${selected.machine_id}`}>Open machine details</Link> : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export function TelemetryLocationPreview() {
  const [points, setPoints] = useState<MachinePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSupabaseClient().rpc('get_telemetry_location_map').then(({ data }) => {
      if (!active) return;
      const rows = (data ?? []) as LocationRow[];
      setPoints(rows.filter((row): row is MachinePoint => (
        row.has_location && typeof row.latitude === 'number' && typeof row.longitude === 'number'
      )));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  if (loading) return <div className="fleet-map-preview-loading"><HamsterLoader label="Loading machine map" /></div>;
  if (points.length === 0) return <div className="fleet-empty-state"><strong>No mapped machines yet</strong><p>Locations will appear after a site coordinate or GNSS fix is available.</p></div>;
  return <TelemetryMapCanvas compact onSelect={() => undefined} points={points} selectedDeviceId={null} />;
}

export function TelemetryLocationMap() {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [movedOnly, setMovedOnly] = useState(false);
  const [health, setHealth] = useState<'all' | MapHealth>('all');
  const [tablePage, setTablePage] = useState(1);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [machineCount, setMachineCount] = useState(0);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    const client = getSupabaseClient();
    const [{ data, error: loadError }, countResult] = await Promise.all([
      client.rpc('get_telemetry_location_map'),
      client.from('machines').select('id', { count: 'exact', head: true }),
    ]);
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setRows((data ?? []) as LocationRow[]);
    setMachineCount(countResult.count ?? (data ?? []).length);
    setLastUpdated(new Date());
    setError(null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load(false).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine locations.');
      setLoading(false);
    });
    const interval = window.setInterval(() => {
      load(true).catch(() => undefined);
    }, MAP_REFRESH_MS);
    return () => window.clearInterval(interval);
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
    await load(true);
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (movedOnly && !row.movement_detected) return false;
      if (health !== 'all' && mapHealth(row) !== health) return false;
      if (!needle) return true;
      return [row.device_code, row.machine_name, row.serial_number, row.branch]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [health, movedOnly, rows, search]);

  const points = useMemo(() => filtered.filter((row): row is MachinePoint => (
    row.has_location && typeof row.latitude === 'number' && typeof row.longitude === 'number'
  )), [filtered]);

  const tablePageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentTablePage = Math.min(tablePage, tablePageCount);
  const visibleRows = filtered.slice((currentTablePage - 1) * TABLE_PAGE_SIZE, currentTablePage * TABLE_PAGE_SIZE);
  const firstTableRow = filtered.length === 0 ? 0 : (currentTablePage - 1) * TABLE_PAGE_SIZE + 1;
  const lastTableRow = Math.min(currentTablePage * TABLE_PAGE_SIZE, filtered.length);

  useEffect(() => {
    setTablePage(1);
  }, [health, movedOnly, search]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, tablePageCount));
  }, [tablePageCount]);

  const healthCounts = useMemo(() => rows.reduce((counts, row) => {
    counts[mapHealth(row)] += 1;
    return counts;
  }, { online: 0, stale: 0, fault: 0, offline: 0 } as Record<MapHealth, number>), [rows]);
  const liveGpsCount = rows.filter((row) => row.location_source === 'gnss' && row.has_location && !row.location_stale).length;
  const locationCount = rows.filter((row) => row.has_location).length;

  return (
    <section className="fleet-route-page telemetry-map-page">
      <header className="fleet-page-heading">
        <div><h1>Machine locations</h1><p>Live machine health, faults and connectivity across South Africa.</p></div>
        <button className="fleet-button secondary" type="button" disabled={loading || refreshing} onClick={() => load(false)}><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh map'}</button>
      </header>

      <section aria-label="Machine location summary" className="fleet-metric-grid">
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-blue"><NavigationIcon kind="tool" /></span><div><span>Total machines</span><strong>{machineCount.toLocaleString('en-ZA')}</strong></div><small>Complete machine register</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-green"><NavigationIcon kind="pin" /></span><div><span>Located</span><strong>{locationCount.toLocaleString('en-ZA')}</strong></div><small>Site or GNSS position available</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-green"><NavigationIcon kind="telemetry" /></span><div><span>Online</span><strong>{healthCounts.online.toLocaleString('en-ZA')}</strong></div><small>Heartbeat within 30 minutes</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-red"><NavigationIcon kind="bell" /></span><div><span>Faults</span><strong>{healthCounts.fault.toLocaleString('en-ZA')}</strong></div><small>Machines requiring attention</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-grey"><NavigationIcon kind="telemetry" /></span><div><span>Offline</span><strong>{healthCounts.offline.toLocaleString('en-ZA')}</strong></div><small>No recent device contact</small></article>
      </section>

      <section className="neo-card spatial-card telemetry-location-card">
      <div className="telemetry-map-heading">
        <div>
          <h2>Fleet tracker</h2>
          <p>Drag, zoom and select status-coloured machine dots. Nearby machines automatically group into numbered clusters.</p>
          <div className="telemetry-map-summary">
            <strong>{locationCount.toLocaleString('en-ZA')}</strong><span>located</span>
            <strong>{liveGpsCount.toLocaleString('en-ZA')}</strong><span>live GPS</span>
            <strong>{healthCounts.online.toLocaleString('en-ZA')}</strong><span>online</span>
            <strong>{healthCounts.fault.toLocaleString('en-ZA')}</strong><span>faults</span>
          </div>
          <small>Last refreshed {formatTime(lastUpdated)}{refreshing ? ' · refreshing…' : ''}</small>
        </div>
      </div>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Location data could not be loaded.</strong><span>{error}</span></div> : null}
      {message ? <div className="fleet-banner is-success" role="status"><strong>Location control saved.</strong><span>{message}</span></div> : null}
      {loading && rows.length === 0 ? <HamsterLoader label="Loading live telemetry locations" /> : null}

      <div className="telemetry-map-filters">
        <label className="fleet-search"><input aria-label="Search machine locations" placeholder="Search machine, serial, device or branch" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label><span>Connection health</span><select value={health} onChange={(event) => setHealth(event.target.value as typeof health)}><option value="all">All statuses</option><option value="online">Online</option><option value="stale">Stale location</option><option value="fault">Fault</option><option value="offline">Offline</option></select></label>
        <label className="telemetry-map-checkbox"><input type="checkbox" checked={movedOnly} onChange={(event) => setMovedOnly(event.target.checked)} /><span>Moved machines only</span></label>
      </div>

      {!loading && rows.length === 0 ? <div className="fleet-empty-state"><strong>No telemetry devices</strong><p>No active telemetry devices are registered.</p></div> : null}
      {!loading && rows.length > 0 && points.length === 0 ? <div className="fleet-banner is-error"><strong>No mapped machines match the filters.</strong><span>Add coordinates to the ERP site or wait for a GNSS fix from the telemetry device.</span></div> : null}
      {points.length > 0 ? <TelemetryMapCanvas points={points} selectedDeviceId={selectedDeviceId} onSelect={setSelectedDeviceId} /> : null}

      {filtered.length > 0 ? (
        <div className="telemetry-location-table">
          <header><div><span>Location register</span><h3>Machines and telemetry positions</h3></div><span>{filtered.length.toLocaleString('en-ZA')} of {rows.length.toLocaleString('en-ZA')} devices</span></header>
          <div className="fleet-table-scroll">
            <table className="fleet-machine-table">
              <thead><tr><th>Machine</th><th>Location</th><th>Source</th><th>Movement</th><th>GPS/location control</th><th>Last fix</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => {
                  const rowSaving = saving === row.device_id;
                  return (
                    <tr key={row.device_id}>
                      <td><button className="fleet-machine-link" disabled={!row.has_location} onClick={() => setSelectedDeviceId(row.device_id)} type="button"><strong>{machineLabel(row)}</strong><span>{row.serial_number ?? row.device_code}</span></button></td>
                      <td>{row.has_location && row.latitude !== null && row.longitude !== null ? <><strong>{row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</strong><span>{row.branch}</span></> : <><strong>No location yet</strong><span>{row.branch}</span></>}</td>
                      <td><StatusBadge value={row.location_stale ? 'stale' : (row.location_source ?? 'unknown')} /><span>{sourceLabel(row.location_source)}{row.accuracy_m !== null ? ` · ±${Math.round(row.accuracy_m)} m` : ''}</span></td>
                      <td><StatusBadge value={row.movement_detected ? 'moved' : 'stationary'} />{row.distance_from_previous_m !== null ? <span>{Math.round(row.distance_from_previous_m)} m since prior fix</span> : null}</td>
                      <td>
                        <div className="telemetry-location-controls">
                          <label><input type="checkbox" checked={row.location_enabled} disabled={rowSaving} onChange={(event) => updateLocationControl(row, { enabled: event.target.checked })} />Enabled</label>
                          <select aria-label={`Location interval for ${row.device_code}`} disabled={rowSaving} value={row.location_interval_minutes} onChange={(event) => updateLocationControl(row, { interval: Number(event.target.value) })}><option value={1}>Every 1 min</option><option value={5}>Every 5 min</option><option value={15}>Every 15 min</option><option value={30}>Every 30 min</option><option value={60}>Every hour</option><option value={240}>Every 4 hours</option><option value={1440}>Daily</option></select>
                          <select aria-label={`Movement threshold for ${row.device_code}`} disabled={rowSaving} value={row.location_min_move_m} onChange={(event) => updateLocationControl(row, { minMove: Number(event.target.value) })}><option value={25}>Movement: 25 m</option><option value={50}>Movement: 50 m</option><option value={100}>Movement: 100 m</option><option value={250}>Movement: 250 m</option><option value={500}>Movement: 500 m</option></select>
                        </div>
                      </td>
                      <td><strong>{locationAge(row)}</strong><span>{formatDate(row.location_fix_at ?? row.location_received_at)} · Device {online(row.last_seen_at) ? 'online' : 'offline'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="fleet-table-footer"><div className="fleet-table-footer-copy"><strong>Showing {firstTableRow.toLocaleString('en-ZA')}–{lastTableRow.toLocaleString('en-ZA')} of {filtered.length.toLocaleString('en-ZA')}</strong><span>Map data refreshes every 15 seconds.</span></div><div aria-label="Location table pagination" className="fleet-table-pagination"><button disabled={currentTablePage === 1} onClick={() => setTablePage((current) => Math.max(1, current - 1))} type="button">Previous</button><span>Page {currentTablePage} of {tablePageCount}</span><button disabled={currentTablePage === tablePageCount} onClick={() => setTablePage((current) => Math.min(tablePageCount, current + 1))} type="button">Next</button></div></footer>
        </div>
      ) : null}
      </section>
    </section>
  );
}
