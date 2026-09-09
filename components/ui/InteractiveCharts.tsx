'use client';

import { useId, useMemo, useState } from 'react';
import styles from './InteractiveCharts.module.css';

export type InteractiveChartDatum = {
  key: string;
  label: string;
  value: number;
  detail?: string;
  secondaryLabel?: string;
  secondaryValue?: number;
};

export type InteractiveDonutDatum = {
  key: string;
  label: string;
  value: number;
  detail?: string;
};

type ValueFormatter = (value: number) => string;

function defaultFormatter(value: number) {
  return value.toLocaleString('en-ZA');
}

function tooltipTransform(xPercent: number, yPercent: number) {
  const x = xPercent < 18 ? '0%' : xPercent > 82 ? '-100%' : '-50%';
  const y = yPercent < 34 ? '12px' : 'calc(-100% - 12px)';
  return `translate(${x}, ${y})`;
}

export function InteractiveLineChart({
  data,
  ariaLabel,
  valueLabel = 'Value',
  valueFormatter = defaultFormatter,
  hint,
}: {
  data: InteractiveChartDatum[];
  ariaLabel: string;
  valueLabel?: string;
  valueFormatter?: ValueFormatter;
  hint?: string;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const activeKey = hoveredKey ?? pinnedKey;
  const width = 720;
  const height = 220;
  const paddingX = 30;
  const paddingTop = 24;
  const paddingBottom = 28;
  const max = Math.max(...data.map((item) => item.value), 1);
  const points = data.map((item, index) => ({
    item,
    x: paddingX + (index / Math.max(data.length - 1, 1)) * (width - paddingX * 2),
    y: height - paddingBottom - (item.value / max) * (height - paddingTop - paddingBottom),
  }));
  const active = points.find((point) => point.item.key === activeKey) ?? null;
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPoints = `${paddingX},${height - paddingBottom} ${linePoints} ${width - paddingX},${height - paddingBottom}`;
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 5)) === 0);

  if (!data.length) return null;

  function togglePin(key: string) {
    setPinnedKey((current) => current === key ? null : key);
  }

  return (
    <div className={styles.chart} data-chart-interactive="line">
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <div className={styles.lineStage} onPointerLeave={() => setHoveredKey(null)}>
        <svg aria-label={ariaLabel} className={styles.lineSvg} role="group" viewBox={`0 0 ${width} ${height}`}>
          {[0, 1, 2, 3].map((line) => {
            const y = paddingTop + line * ((height - paddingTop - paddingBottom) / 3);
            return <line className={styles.gridLine} key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} />;
          })}
          <polygon className={styles.area} points={areaPoints} />
          <polyline className={styles.line} points={linePoints} />
          {active ? <line className={styles.focusGuide} x1={active.x} x2={active.x} y1={paddingTop} y2={height - paddingBottom} /> : null}
          {points.map((point) => {
            const selected = activeKey === point.item.key;
            return (
              <circle
                aria-label={`${point.item.label}: ${valueFormatter(point.item.value)} ${valueLabel}`}
                aria-pressed={pinnedKey === point.item.key}
                className={`${styles.point} ${selected ? styles.pointActive : ''}`}
                cx={point.x}
                cy={point.y}
                key={point.item.key}
                onBlur={() => setHoveredKey(null)}
                onClick={() => togglePin(point.item.key)}
                onFocus={() => setHoveredKey(point.item.key)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  togglePin(point.item.key);
                }}
                onPointerEnter={() => setHoveredKey(point.item.key)}
                r={selected ? 6 : 4}
                role="button"
                tabIndex={0}
              />
            );
          })}
        </svg>
        {active ? (() => {
          const xPercent = (active.x / width) * 100;
          const yPercent = (active.y / height) * 100;
          const placement = yPercent < 34 ? 'below' : 'above';
          return (
            <div
              aria-live="polite"
              className={styles.tooltip}
              data-tooltip-placement={placement}
              role="status"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                transform: tooltipTransform(xPercent, yPercent),
              }}
            >
              <strong>{active.item.label}</strong>
              <span className={styles.tooltipValue}>{valueFormatter(active.item.value)} {valueLabel}</span>
              {active.item.secondaryLabel && active.item.secondaryValue !== undefined ? <small>{active.item.secondaryLabel}: {valueFormatter(active.item.secondaryValue)}</small> : null}
              {active.item.detail ? <small>{active.item.detail}</small> : null}
            </div>
          );
        })() : null}
      </div>
      <div aria-hidden="true" className={styles.axisLabels}>
        {labels.map((point) => <span key={point.item.key}>{point.item.label}</span>)}
      </div>
    </div>
  );
}

export function InteractiveHorizontalBars({
  data,
  ariaLabel,
  valueLabel = 'Value',
  valueFormatter = defaultFormatter,
  hint,
}: {
  data: InteractiveChartDatum[];
  ariaLabel: string;
  valueLabel?: string;
  valueFormatter?: ValueFormatter;
  hint?: string;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const activeKey = hoveredKey ?? pinnedKey;
  const max = Math.max(...data.map((item) => item.value), 1);
  const active = data.find((item) => item.key === activeKey) ?? null;

  if (!data.length) return null;

  return (
    <div aria-label={ariaLabel} className={styles.chart} data-chart-interactive="bar" role="group">
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <div aria-live="polite" className={styles.barTooltip} role="status">
        <strong>{active?.label ?? ariaLabel}</strong>
        <span>{active ? `${valueFormatter(active.value)} ${valueLabel}` : 'Tap a bar for details'}</span>
      </div>
      <div className={styles.barChart} onPointerLeave={() => setHoveredKey(null)}>
        {data.map((item) => {
          const selected = activeKey === item.key;
          return (
            <button
              aria-pressed={pinnedKey === item.key}
              className={`${styles.barRow} ${selected ? styles.barRowActive : ''}`}
              key={item.key}
              onBlur={() => setHoveredKey(null)}
              onClick={() => setPinnedKey((current) => current === item.key ? null : item.key)}
              onFocus={() => setHoveredKey(item.key)}
              onPointerEnter={() => setHoveredKey(item.key)}
              title={item.detail}
              type="button"
            >
              <span className={styles.barLabel}>{item.label}</span>
              <span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} /></span>
              <strong className={styles.barValue}>{valueFormatter(item.value)}</strong>
            </button>
          );
        })}
      </div>
      {active?.secondaryLabel && active.secondaryValue !== undefined ? <p className={styles.hint}>{active.secondaryLabel}: {valueFormatter(active.secondaryValue)}{active.detail ? ` · ${active.detail}` : ''}</p> : active?.detail ? <p className={styles.hint}>{active.detail}</p> : null}
    </div>
  );
}

export function InteractiveDonutChart({
  data,
  ariaLabel,
  valueLabel = 'items',
  valueFormatter = defaultFormatter,
  hint,
}: {
  data: InteractiveDonutDatum[];
  ariaLabel: string;
  valueLabel?: string;
  valueFormatter?: ValueFormatter;
  hint?: string;
}) {
  const titleId = useId();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const activeKey = hoveredKey ?? pinnedKey;
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const segments = useMemo(() => {
    let offset = 0;
    return data.map((item) => {
      const percent = total > 0 ? (Math.max(0, item.value) / total) * 100 : 0;
      const segment = { item, percent, offset };
      offset += percent;
      return segment;
    });
  }, [data, total]);
  const active = data.find((item) => item.key === activeKey) ?? null;
  const activePercent = active && total > 0 ? (active.value / total) * 100 : null;

  if (!data.length) return null;

  function togglePin(key: string) {
    setPinnedKey((current) => current === key ? null : key);
  }

  return (
    <div aria-labelledby={titleId} className={styles.chart} data-chart-interactive="donut">
      <span className="sr-only" id={titleId}>{ariaLabel}</span>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <div className={styles.donutLayout} onPointerLeave={() => setHoveredKey(null)}>
        <div className={styles.donutStage}>
          <svg aria-label={ariaLabel} className={styles.donutSvg} role="group" viewBox="0 0 220 220">
            <circle className={styles.donutTrack} cx="110" cy="110" r="74" />
            <g transform="rotate(-90 110 110)">
              {segments.map((segment, index) => {
                const selected = activeKey === segment.item.key;
                const seriesClass = (styles as Record<string, string>)[`series${index % 6}`];
                return (
                  <circle
                    aria-label={`${segment.item.label}: ${valueFormatter(segment.item.value)} ${valueLabel}, ${segment.percent.toFixed(1)} percent`}
                    aria-pressed={pinnedKey === segment.item.key}
                    className={`${styles.donutSegment} ${seriesClass} ${selected ? styles.donutSegmentActive : ''}`}
                    cx="110"
                    cy="110"
                    key={segment.item.key}
                    onBlur={() => setHoveredKey(null)}
                    onClick={() => togglePin(segment.item.key)}
                    onFocus={() => setHoveredKey(segment.item.key)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      togglePin(segment.item.key);
                    }}
                    onPointerEnter={() => setHoveredKey(segment.item.key)}
                    pathLength="100"
                    r="74"
                    role="button"
                    strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
                    strokeDashoffset={-segment.offset}
                    tabIndex={0}
                  />
                );
              })}
            </g>
          </svg>
          <div aria-live="polite" className={styles.donutCenter} role="status">
            <strong>{active ? valueFormatter(active.value) : valueFormatter(total)}</strong>
            <span>{active ? `${active.label} · ${activePercent?.toFixed(1)}%` : `Total ${valueLabel}`}</span>
          </div>
        </div>
        <div className={styles.legend}>
          {segments.map((segment, index) => {
            const selected = activeKey === segment.item.key;
            const seriesClass = (styles as Record<string, string>)[`series${index % 6}`];
            return (
              <button
                aria-pressed={pinnedKey === segment.item.key}
                className={`${styles.legendButton} ${selected ? styles.legendButtonActive : ''}`}
                key={segment.item.key}
                onBlur={() => setHoveredKey(null)}
                onClick={() => togglePin(segment.item.key)}
                onFocus={() => setHoveredKey(segment.item.key)}
                onPointerEnter={() => setHoveredKey(segment.item.key)}
                type="button"
              >
                <span aria-hidden="true" className={`${styles.legendDot} ${seriesClass}`} />
                <span className={styles.legendLabel}>{segment.item.label}</span>
                <span className={styles.legendValue}>{valueFormatter(segment.item.value)}</span>
              </button>
            );
          })}
          {active?.detail ? <p className={styles.hint}>{active.detail}</p> : null}
        </div>
      </div>
    </div>
  );
}
