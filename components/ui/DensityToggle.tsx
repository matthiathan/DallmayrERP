'use client';

import { useEffect, useState } from 'react';

type Density = 'comfortable' | 'standard' | 'compact';

const densities: Density[] = ['comfortable', 'standard', 'compact'];

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
      {densities.map((item) => (
        <button
          aria-pressed={density === item}
          className={density === item ? 'is-active' : ''}
          key={item}
          onClick={() => changeDensity(item)}
          title={`Use ${item} display density`}
          type="button"
        >
          {item[0].toUpperCase()}
        </button>
      ))}
    </div>
  );
}
