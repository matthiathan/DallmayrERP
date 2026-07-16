export type TimelineStep = {
  label: string;
  description?: string;
};

export function StatusTimeline({
  steps,
  currentIndex,
  compact = false,
}: {
  steps: TimelineStep[];
  currentIndex: number;
  compact?: boolean;
}) {
  const safeIndex = Math.max(0, Math.min(currentIndex, steps.length - 1));

  return (
    <ol className={`status-timeline ${compact ? 'is-compact' : ''}`}>
      {steps.map((step, index) => {
        const state = index < safeIndex ? 'complete' : index === safeIndex ? 'current' : 'pending';
        return (
          <li className={`status-timeline-step is-${state}`} key={`${step.label}-${index}`}>
            <span className="status-timeline-dot" aria-hidden="true">{index + 1}</span>
            <span>
              <strong>{step.label}</strong>
              {step.description && !compact ? <small>{step.description}</small> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
