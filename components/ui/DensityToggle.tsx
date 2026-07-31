'use client';

import { useEffect, useState } from 'react';

type Density = 'comfortable' | 'standard' | 'compact';

const densityOptions: Array<{ label: string; shortLabel: string; value: Density }> = [
  { label: 'Roomy', shortLabel: 'R', value: 'comfortable' },
  { label: 'Standard', shortLabel: 'S', value: 'standard' },
  { label: 'Compact', shortLabel: 'C', value: 'compact' },
];

const densities = densityOptions.map((option) => option.value);

export function DensityToggle() {
  const [density, setDensity] = useState<Density>('standard');

  useEffect(() => {
    const saved = window.localStorage.getItem('dallmayr-density') as Density | null;
    const nextDensity = saved && densities.includes(saved) ? saved : 'standard';
    setDensity(nextDensity);
    document.documentElement.dataset.density = nextDensity;
  }, []);

  function changeDensity(nextDensity: Density) {
    setDensity(nextDensity);
    document.documentElement.dataset.density = nextDensity;
    window.localStorage.setItem('dallmayr-density', nextDensity);
  }

  return (
    <div className="density-toggle" aria-label="Display density">
      {densityOptions.map((option) => (
        <button
          aria-label={`Use ${option.label.toLowerCase()} display density`}
          aria-pressed={density === option.value}
          className={density === option.value ? 'is-active' : ''}
          key={option.value}
          onClick={() => changeDensity(option.value)}
          title={`Use ${option.label.toLowerCase()} display density`}
          type="button"
        >
          {option.shortLabel}
        </button>
      ))}
    </div>
  );
}
