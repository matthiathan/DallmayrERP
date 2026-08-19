import { TelemetryActivityLog } from '@/components/features/TelemetryActivityLog';
import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { TelemetryLiveControl } from '@/components/features/TelemetryLiveControl';
import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { TelemetryPocPanel } from '@/components/features/TelemetryPocPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <main className="telemetry-workspace" aria-labelledby="telemetry-page-title">
        <div className="page-header hero-panel spatial-card telemetry-hero" data-ui-priority="identity">
          <div>
            <div className="badge">Admin &amp; Executive</div>
            <h1 id="telemetry-page-title">Machine Telemetry</h1>
            <p>See machine health, active faults, live location and sales first. Historical analysis, remote configuration and proof-of-concept tools follow in supporting sections.</p>
          </div>
        </div>

        <nav aria-label="Telemetry page sections" className="telemetry-section-nav" data-ui-priority="action">
          <a href="#telemetry-live">Live health</a>
          <a href="#telemetry-location">Live map</a>
          <a href="#telemetry-activity">Sales &amp; errors</a>
          <a href="#telemetry-reporting">History &amp; trends</a>
          <a href="#telemetry-poc">POC tools</a>
        </nav>

        <section className="telemetry-workspace-section telemetry-live-section" id="telemetry-live" data-ui-priority="urgent">
          <TelemetryLiveControl />
        </section>

        <section className="telemetry-workspace-section telemetry-location-section" id="telemetry-location" data-ui-priority="summary">
          <TelemetryLocationMap />
        </section>

        <section className="telemetry-workspace-section telemetry-activity-section" id="telemetry-activity" data-ui-priority="primary">
          <TelemetryActivityLog />
        </section>

        <section className="telemetry-workspace-section telemetry-reporting-section" id="telemetry-reporting" data-ui-priority="secondary">
          <TelemetryDashboard />
        </section>

        <section className="telemetry-workspace-section telemetry-poc-section" id="telemetry-poc" data-ui-priority="supporting">
          <TelemetryPocPanel />
        </section>
      </main>
    </AppShell>
  );
}
