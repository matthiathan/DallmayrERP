'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './TelemetryDeviceContextLinks.module.css';

function queryDeviceCode() {
  return new URLSearchParams(window.location.search).get('device')?.trim() ?? '';
}

export function TelemetryDeviceContextLinks() {
  const [deviceCode, setDeviceCode] = useState('');

  useEffect(() => {
    const read = () => {
      const drawer = document.querySelector<HTMLElement>('aside[aria-label^="Manage "]');
      const drawerCode = drawer?.querySelector('h2')?.textContent?.trim() ?? '';
      setDeviceCode(drawerCode || queryDeviceCode());
    };
    read();
    const observer = new MutationObserver(read);
    const root = document.getElementById('main-content') ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const testCenterHref = deviceCode
    ? `/telemetry/test-center?device=${encodeURIComponent(deviceCode)}`
    : '/telemetry/test-center';
  const profileIdentityHref = deviceCode
    ? `/telemetry/devices/profile-identity?device=${encodeURIComponent(deviceCode)}`
    : '/telemetry/devices/profile-identity';

  return (
    <nav aria-label="Device context actions" className={styles.actions}>
      <span>{deviceCode ? `Working with ${deviceCode}` : 'Device workflow'}</span>
      <Link href="/machines">Open machines</Link>
      <Link href={testCenterHref}>Open Test Center</Link>
      <Link href={profileIdentityHref}>Profile identity</Link>
    </nav>
  );
}
