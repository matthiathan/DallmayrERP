import { AssetLifecycleIntelligence } from '@/components/features/AssetLifecycleIntelligence';
import { AppShell } from '@/components/layout/AppShell';

export default function AssetLifecycleIntelligencePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Asset intelligence</div>
          <h1>Asset Lifecycle</h1>
          <p>Hierarchy, acquisition and replacement data, meters, downtime, maintenance exposure and lifecycle cost.</p>
        </div>
      </div>
      <AssetLifecycleIntelligence />
    </AppShell>
  );
}
