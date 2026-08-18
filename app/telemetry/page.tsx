import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { TelemetryLiveControl } from '@/components/features/TelemetryLiveControl';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Admin &amp; Executive</div>
          <h1>Machine Telemetry</h1>
          <p>Monitor live device connectivity, faults and counters, remotely control telemetry mode and network preference, and review aggregated machine sales.</p>
        </div>
      </div>
      <TelemetryLiveControl />
      <TelemetryDashboard />
    </AppShell>
  );
}
