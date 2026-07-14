import { AppShell } from '@/components/layout/AppShell';
import { TaskClosurePanel } from '@/components/features/TaskClosurePanel';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Daily route visibility and job priority list',
  'Close route jobs with machine barcode scans',
  'Capture on-site proof photos and notes',
  'Feed branch performance reports with field-service closure data',
];

export default function RoadTechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Road technician</div>
          <h1>Road Tech Routes</h1>
          <p>Field-service route and customer-site workspace for road technicians.</p>
        </div>
      </div>
      <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}>
        <KpiCard label="Routes" value="Mobile" helper="Route closure is phone-friendly." />
        <KpiCard label="Machines" value="Scannable" helper="Scan machine barcodes or enter manually." />
        <KpiCard label="Proof" value="Photo Ready" helper="Attach on-site closure evidence." />
      </div>
      <div className="grid grid-2 spatial-stage spatial-dashboard">
        <TaskClosurePanel taskType="road_technician" />
        <div className="neo-card spatial-route-panel spatial-card">
          <h2>Route / field-service overview</h2>
          <p>Use this route panel as the desktop overview for field-service closure quality, customer proof and branch accountability.</p>
          <div className="feature-list">
            {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
