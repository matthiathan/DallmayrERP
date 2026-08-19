import { TelemetryActivityLog } from '@/components/features/TelemetryActivityLog';
import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <section className="fleet-route-page">
        <header className="fleet-page-heading">
          <div>
            <span className="fleet-eyebrow">Machine &amp; telemetry monitoring</span>
            <h1>Telemetry analytics</h1>
            <p>Explore item quantities, vend failures, reporting trends and complete telemetry activity.</p>
          </div>
        </header>
        <TelemetryDashboard />
        <TelemetryActivityLog />
      </section>
    </AppShell>
  );
}
