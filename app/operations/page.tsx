import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';

const focusAreas = [
  'Customer master monitoring across JHB, CPT and KZN',
  'Contract risk and expiring agreements',
  'Machine and fixed-asset visibility',
  'Service workload escalation and technician capacity',
];

export default function OperationsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Operations</div>
          <h1>Operations Control</h1>
          <p>Branch, service, customer and asset control for operations staff.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Customer Control" value="3 Branches" helper="JHB, CPT and KZN source data available." />
        <KpiCard label="Asset Register" value="Live" helper="Fixed assets are available for machine visibility." />
        <KpiCard label="Service Escalations" value="Tracked" helper="Service logs are available for open and closed work review." />
      </div>
      <div className="neo-card" style={{ marginTop: 20 }}>
        <h2>Operations features</h2>
        <div className="feature-list">
          {focusAreas.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
    </AppShell>
  );
}
