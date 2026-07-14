import { AppShell } from '@/components/layout/AppShell';
import { TaskClosurePanel } from '@/components/features/TaskClosurePanel';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Close technical jobs with machine barcode scans',
  'Capture proof photos for task completion',
  'Record outcomes: completed, parts required or follow-up required',
  'Feed executive and operations reporting with real closure data',
];

export default function TechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Technician</div>
          <h1>Technician Jobs</h1>
          <p>Workshop and technical service workspace for machine work, proof photos and service close-outs.</p>
        </div>
      </div>
      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <KpiCard label="Jobs" value="Closeable" helper="Scan and close machine tasks from this page." />
        <KpiCard label="Machines" value="Scannable" helper="Use barcode/QR photos or manual machine barcode entry." />
        <KpiCard label="Proof" value="Photo Ready" helper="Attach closure evidence for operations review." />
      </div>
      <div className="grid grid-2">
        <TaskClosurePanel taskType="technician" />
        <div className="neo-card">
          <h2>Technician features</h2>
          <div className="feature-list">
            {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
