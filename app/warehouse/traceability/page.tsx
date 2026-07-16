import { StockTraceabilityBoard } from '@/components/features/StockTraceabilityBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function StockTraceabilityPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Inventory traceability</div>
          <h1>Lots &amp; Serials</h1>
          <p>Track batch expiry, serialized units, warehouse location and issue-to-work history.</p>
        </div>
      </div>
      <StockTraceabilityBoard />
    </AppShell>
  );
}
