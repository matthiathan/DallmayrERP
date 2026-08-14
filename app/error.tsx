'use client';

import { ApplicationFailureScreen } from '@/components/system/ApplicationFailureScreen';

type ErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorBoundaryProps) {
  const reference = error.digest ? `ERP-ROUTE-${error.digest}` : 'ERP-ROUTE-UNEXPECTED';

  return (
    <ApplicationFailureScreen
      eyebrow="Workspace error"
      title="This page could not be loaded."
      description="DallmayrERP encountered an unexpected problem while loading this workspace. Retry the page, or return to the dashboard and continue from there."
      reference={reference}
      onRetry={reset}
      announceAsAlert
      tone="danger"
    />
  );
}
