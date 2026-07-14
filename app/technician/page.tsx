import { AppShell } from '@/components/layout/AppShell';
import { KpiCard } from '@/components/ui/KpiCard';

const features = [
  'Assigned technical jobs and service call notes',
  'Machine serial number and QR lookup',
  'Start, pause and close job workflow planning',
  'Service remarks and machine history visibility',
];

export default function TechnicianPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Technician</div>
          <h1>Technician Jobs</h1>
          <p>Workshop and technical service workspace for assigned machine work.</p>
        </div>
      </div>
      <div className="grid grid-3">
        <KpiCard label="Jobs" value="Assigned" helper="Technician-specific assignment filtering is planned next." />
        <KpiCard label="Machines" value="Searchable" helper="Serial, asset and QR fields are available from fixed assets." />
        <KpiCard label="Service Notes" value="Planned" helper="Close-out notes will be linked to service records." />
      </div>
      <div className="neo-card" style={{ marginTop: 20 }}>
        <h2>Technician features</h2>
        <div className="feature-list">
          {features.map((item) => <div className="feature-pill" key={item}>{item}</div>)}
        </div>
      </div>
    </AppShell>
  );
}
