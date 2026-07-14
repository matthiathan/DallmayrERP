import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';
import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';
import { OrderScannerPanel } from '@/components/features/OrderScannerPanel';

const focusAreas = [
  'Create delivery orders by scanning picked stock',
  'Monitor customer, contract, asset and service source data',
  'Review branch task closures and stock scan activity',
  'Escalate branch and department issues before they reach executives',
];

export default function OperationsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Operations</div>
          <h1>Operations Control</h1>
          <p>Branch, service, customer, stock movement and delivery order control for daily operations.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Customer Control" value="3 Branches" helper="JHB, CPT and KZN source data available." />
        <KpiCard label="Order Capture" value="Scan Ready" helper="Scan stock to build delivery orders." />
        <KpiCard label="Branch Reporting" value="Live" helper="Digital work captured by branch and department." />
      </div>
      <div className="neo-card" style={{ marginTop: 20, marginBottom: 20 }}>
        <h2>Operations features</h2>
        <div className="feature-list">
          {focusAreas.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <OrderScannerPanel />
        <div className="neo-card">
          <h2>Daily operating rhythm</h2>
          <p>Use this screen during dispatch planning: scan stock, create delivery orders, review service movement and check branch performance before morning or afternoon handover.</p>
          <div className="feature-list">
            <span className="feature-pill">Morning dispatch</span>
            <span className="feature-pill">Branch scan control</span>
            <span className="feature-pill">Order preparation</span>
            <span className="feature-pill">Service escalation</span>
          </div>
        </div>
      </div>
      <ExecutiveReportingPanel />
    </AppShell>
  );
}
