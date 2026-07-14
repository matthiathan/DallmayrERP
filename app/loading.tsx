import { HamsterLoader } from '@/components/ui/HamsterLoader';

export default function Loading() {
  return (
    <main className="login-page">
      <div className="neo-card auth-state-card">
        <div className="orb" />
        <HamsterLoader label="Loading DallmayrERP" />
        <h1>Loading DallmayrERP</h1>
        <p>Preparing the secure workspace.</p>
      </div>
    </main>
  );
}
