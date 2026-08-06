import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Admin &amp; Executive</div>
          <h1>Machine Telemetry</h1>
          <p>Review item sales, revenue, machine activity, serial numbers, locations and device connectivity across daily, weekly, monthly and six-month periods.</p>
        </div>
      </div>
      <TelemetryDashboard />
    </AppShell>
  );
}
