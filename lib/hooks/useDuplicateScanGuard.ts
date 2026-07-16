'use client';

import { useRef } from 'react';

export function useDuplicateScanGuard(windowMs = 900) {
  const lastScan = useRef<{ value: string; scannedAt: number }>({ value: '', scannedAt: 0 });

  return (value: string) => {
    const cleanValue = value.trim();
    if (!cleanValue) return false;

    const now = Date.now();
    const isDuplicate = lastScan.current.value === cleanValue && now - lastScan.current.scannedAt < windowMs;
    lastScan.current = { value: cleanValue, scannedAt: now };
    return isDuplicate;
  };
}
