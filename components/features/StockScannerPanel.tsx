'use client';

import { StockControlPanel } from '@/components/features/StockControlPanel';
import type { Branch } from '@/types/dallmayrerp';

/**
 * Compatibility wrapper retained for any older route imports.
 * All stock changes now flow through the atomic StockControlPanel RPC workflow.
 */
export function StockScannerPanel(_props: { defaultBranch?: Branch }) {
  return <StockControlPanel />;
}
