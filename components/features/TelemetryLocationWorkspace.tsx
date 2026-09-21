'use client';

import Link from 'next/link';
import { TelemetryLocationMap } from './TelemetryLocationMap';
import styles from './TelemetryLocationWorkspace.module.css';

export function TelemetryLocationWorkspace() {
  return (
    <section className={styles.workspace} data-location-control-owner="device-management">
      <div className={styles.notice} role="note">
        <div>
          <strong>Location configuration is managed with the device.</strong>
          <span>Use Device Management for location cadence and movement thresholds so every change goes through the current atomic configuration path.</span>
        </div>
        <Link href="/telemetry/devices">Manage device location settings</Link>
      </div>
      <div className={styles.mapHost}>
        <TelemetryLocationMap />
      </div>
    </section>
  );
}
