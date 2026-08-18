import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { TelemetryLiveControl } from '@/components/features/TelemetryLiveControl';
import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { TelemetryPocPanel } from '@/components/features/TelemetryPocPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Admin &amp; Executive</div>
          <h1>Machine Telemetry</h1>
          <p>Monitor live device connectivity, current machine location, faults and counters, remotely control telemetry mode and network preference, and review aggregated machine sales.</p>
        </div>
      </div>
      <TelemetryLiveControl />
      <TelemetryLocationMap />
      <TelemetryPocPanel />
      <TelemetryDashboard />
    </AppShell>
  );
}
