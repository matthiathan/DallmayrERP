import { ApplicationFailureScreen } from '@/components/system/ApplicationFailureScreen';

export default function NotFound() {
  return (
    <ApplicationFailureScreen
      eyebrow="Page not found"
      title="We could not find that ERP page."
      description="The address may be outdated, incomplete or no longer available. Retry the request, or return to the dashboard and navigate to the required workspace from there."
      reference="ERP-404-NOT-FOUND"
      tone="warning"
    />
  );
}
