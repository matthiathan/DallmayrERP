import { TelemetryActivityLog } from '@/components/features/TelemetryActivityLog';
import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { TelemetryLiveControl } from '@/components/features/TelemetryLiveControl';
import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { TelemetryPocPanel } from '@/components/features/TelemetryPocPanel';
import { AppShell } from '@/components/layout/AppShell';

const sectionStyle = { scrollMarginTop: 112 };

export default function TelemetryPage() {
  return (
    <AppShell>
      <div className="telemetry-workspace" aria-labelledby="telemetry-page-title">
        <div className="page-header hero-panel spatial-card telemetry-hero" data-ui-priority="identity">
          <div>
            <div className="badge">Admin &amp; Executive</div>
            <h1 id="telemetry-page-title">Machine Telemetry</h1>
            <p>See machine health, active faults, live location and sales first. Historical analysis, remote configuration and proof-of-concept tools follow in supporting sections.</p>
          </div>
        </div>

        <nav
          aria-label="Telemetry page sections"
          className="telemetry-section-nav"
          data-ui-priority="action"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          <a className="button secondary" href="#telemetry-live">Live health</a>
          <a className="button secondary" href="#telemetry-location">Live map</a>
          <a className="button secondary" href="#telemetry-activity">Sales &amp; errors</a>
          <a className="button secondary" href="#telemetry-reporting">History &amp; trends</a>
          <a className="button secondary" href="#telemetry-poc">POC tools</a>
        </nav>

        <section className="telemetry-workspace-section telemetry-live-section" id="telemetry-live" data-ui-priority="urgent" style={sectionStyle}>
          <TelemetryLiveControl />
        </section>

        <section className="telemetry-workspace-section telemetry-location-section" id="telemetry-location" data-ui-priority="summary" style={sectionStyle}>
          <TelemetryLocationMap />
        </section>

        <section className="telemetry-workspace-section telemetry-activity-section" id="telemetry-activity" data-ui-priority="primary" style={sectionStyle}>
          <TelemetryActivityLog />
        </section>

        <section className="telemetry-workspace-section telemetry-reporting-section" id="telemetry-reporting" data-ui-priority="secondary" style={sectionStyle}>
          <TelemetryDashboard />
        </section>

        <section className="telemetry-workspace-section telemetry-poc-section" id="telemetry-poc" data-ui-priority="supporting" style={sectionStyle}>
          <TelemetryPocPanel />
        </section>
      </div>
    </AppShell>
  );
}
