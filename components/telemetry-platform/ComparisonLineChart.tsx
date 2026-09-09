'use client';

import { useMemo, useState } from 'react';
import styles from './ComparisonLineChart.module.css';

export type ComparisonPoint = {
  key: string;
  label: string;
  value: number;
  detail?: string;
};

type ActivePoint = {
  series: 'current' | 'previous';
  index: number;
} | null;

const WIDTH = 620;
const HEIGHT = 250;
const PAD_X = 26;
const PAD_TOP = 24;
const PAD_BOTTOM = 24;

function pathFor(points: ComparisonPoint[], max: number) {
  if (!points.length) return '';
  const drawableW = WIDTH - PAD_X * 2;
  const drawableH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return points.map((point, index) => {
    const x = points.length === 1 ? WIDTH / 2 : PAD_X + (index / (points.length - 1)) * drawableW;
    const y = PAD_TOP + drawableH - (Math.max(0, point.value) / max) * drawableH;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function coordinates(points: ComparisonPoint[], max: number) {
  const drawableW = WIDTH - PAD_X * 2;
  const drawableH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return points.map((point, index) => ({
    x: points.length === 1 ? WIDTH / 2 : PAD_X + (index / (points.length - 1)) * drawableW,
    y: PAD_TOP + drawableH - (Math.max(0, point.value) / max) * drawableH,
  }));
}

export function ComparisonLineChart({
  current,
  previous = [],
  currentLabel = 'This period',
  previousLabel = 'Previous period',
  valueLabel = 'items',
}: {
  current: ComparisonPoint[];
  previous?: ComparisonPoint[];
  currentLabel?: string;
  previousLabel?: string;
  valueLabel?: string;
}) {
  const [hovered, setHovered] = useState<ActivePoint>(null);
  const [pinned, setPinned] = useState<ActivePoint>(null);
  const active = hovered ?? pinned;
  const max = Math.max(1, ...current.map((point) => point.value), ...previous.map((point) => point.value));
  const currentCoords = useMemo(() => coordinates(current, max), [current, max]);
  const previousCoords = useMemo(() => coordinates(previous, max), [previous, max]);
  const activeSeries = active?.series === 'previous' ? previous : current;
  const activeCoords = active?.series === 'previous' ? previousCoords : currentCoords;
  const activePoint = active ? activeSeries[active.index] : null;
  const activeCoord = active ? activeCoords[active.index] : null;

  const togglePinned = (next: NonNullable<ActivePoint>) => {
    setPinned((currentPinned) => currentPinned?.series === next.series && currentPinned.index === next.index ? null : next);
  };

  const axisLabels = current.length <= 7
    ? current
    : current.filter((_, index) => index === 0 || index === current.length - 1 || index % Math.max(1, Math.floor(current.length / 5)) === 0).slice(0, 7);

  const placement = activeCoord ? {
    left: `${(activeCoord.x / WIDTH) * 100}%`,
    top: `${(activeCoord.y / HEIGHT) * 100}%`,
    below: activeCoord.y < HEIGHT * .34,
    leftEdge: activeCoord.x < WIDTH * .18,
    rightEdge: activeCoord.x > WIDTH * .82,
  } : null;

  return (
    <div className={styles.chart} data-chart-interactive="comparison-line">
      <div className={styles.legend}>
        <span className={styles.legendCurrent}><i />{currentLabel}</span>
        {previous.length ? <span className={styles.legendPrevious}><i />{previousLabel}</span> : null}
      </div>
      <div className={styles.stage}>
        <svg aria-label={`${currentLabel} compared with ${previousLabel}`} className={styles.svg} role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {[0, .25, .5, .75, 1].map((ratio) => {
            const y = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM) * ratio;
            return <line className={styles.gridLine} key={ratio} x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} />;
          })}
          {previous.length ? <path className={styles.previousLine} d={pathFor(previous, max)} /> : null}
          <path className={styles.currentLine} d={pathFor(current, max)} />
          {previousCoords.map((coord, index) => (
            <circle
              aria-label={`${previous[index].label}: ${previous[index].value} ${valueLabel}`}
              aria-pressed={pinned?.series === 'previous' && pinned.index === index}
              className={`${styles.previousPoint} ${active?.series === 'previous' && active.index === index ? styles.activePoint : ''}`}
              cx={coord.x}
              cy={coord.y}
              key={`previous-${previous[index].key}`}
              onBlur={() => setHovered(null)}
              onClick={() => togglePinned({ series: 'previous', index })}
              onFocus={() => setHovered({ series: 'previous', index })}
              onMouseEnter={() => setHovered({ series: 'previous', index })}
              onMouseLeave={() => setHovered(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  togglePinned({ series: 'previous', index });
                }
              }}
              r={4}
              role="button"
              tabIndex={0}
            />
          ))}
          {currentCoords.map((coord, index) => (
            <circle
              aria-label={`${current[index].label}: ${current[index].value} ${valueLabel}`}
              aria-pressed={pinned?.series === 'current' && pinned.index === index}
              className={`${styles.currentPoint} ${active?.series === 'current' && active.index === index ? styles.activePoint : ''}`}
              cx={coord.x}
              cy={coord.y}
              key={`current-${current[index].key}`}
              onBlur={() => setHovered(null)}
              onClick={() => togglePinned({ series: 'current', index })}
              onFocus={() => setHovered({ series: 'current', index })}
              onMouseEnter={() => setHovered({ series: 'current', index })}
              onMouseLeave={() => setHovered(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  togglePinned({ series: 'current', index });
                }
              }}
              r={4}
              role="button"
              tabIndex={0}
            />
          ))}
        </svg>

        {activePoint && placement ? (
          <div
            className={`${styles.tooltip} ${placement.below ? styles.tooltipBelow : ''} ${placement.leftEdge ? styles.tooltipLeft : ''} ${placement.rightEdge ? styles.tooltipRight : ''}`}
            data-tooltip-placement={placement.below ? 'below' : 'above'}
            style={{ left: placement.left, top: placement.top }}
          >
            <strong>{activePoint.label}</strong>
            <b>{activePoint.value.toLocaleString('en-ZA')} {valueLabel}</b>
            <span>{active?.series === 'current' ? currentLabel : previousLabel}</span>
            {activePoint.detail ? <small>{activePoint.detail}</small> : null}
          </div>
        ) : null}
      </div>
      <div className={styles.axis}>{axisLabels.map((point) => <span key={point.key}>{point.label}</span>)}</div>
    </div>
  );
}
