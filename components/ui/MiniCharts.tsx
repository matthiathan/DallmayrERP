'use client';

export type ChartPoint = {
  label: string;
  value: number;
};

const DONUT_SEGMENT_COLORS = [
  'var(--ui-gold-dark, #6d4b16)',
  'var(--ui-gold, #b8862f)',
  'var(--ui-focus, #2563eb)',
  'var(--ui-success, #2f7d4a)',
  'var(--ui-warning, #9a6a14)',
  'var(--ui-danger, #a32222)',
];

function finiteValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeValue(value: number) {
  return Math.max(0, finiteValue(value));
}

function safeMax(data: ChartPoint[]) {
  return Math.max(1, ...data.map((item) => nonNegativeValue(item.value)));
}

export function BarChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const max = safeMax(data);
  return (
    <div className="neo-card chart-card spatial-card">
      <h3>{title}</h3>
      <div className="bar-chart" aria-label={title}>
        {data.map((item) => {
          const value = nonNegativeValue(item.value);
          const width = (value / max) * 100;
          return (
            <div className="bar-row" key={item.label}>
              <span>{item.label}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
              <strong>{value.toLocaleString()}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LineChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const max = safeMax(data);
  const width = 520;
  const height = 180;
  const padding = 18;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const points = data.map((item, index) => {
    const value = nonNegativeValue(item.value);
    const x = padding + (data.length <= 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth);
    const y = padding + usableHeight - (value / max) * usableHeight;
    return { ...item, value, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="neo-card chart-card spatial-card">
      <h3>{title}</h3>
      <svg aria-label={title} role="img" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', minHeight: 190, overflow: 'visible' }}>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="var(--content-border)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--content-accent-text)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} fill="var(--content-surface)" r="5" stroke="var(--content-accent-text)" strokeWidth="3" />
            <text fill="var(--content-muted)" fontSize="11" textAnchor="middle" x={point.x} y={height - 2}>{point.label}</text>
            <title>{point.label}: {point.value.toLocaleString()}</title>
          </g>
        ))}
      </svg>
      <div className="chart-legend" aria-hidden="true">{points.map((item) => <div key={item.label}>{item.label}: <strong>{item.value.toLocaleString()}</strong></div>)}</div>
    </div>
  );
}

export function DonutChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const values = data.map((item) => ({ ...item, value: nonNegativeValue(item.value) }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const positiveSegments = values.filter((item) => item.value > 0);
  const stops = positiveSegments.map((item, index) => {
    const start = offset;
    const end = offset + (item.value / total) * 100;
    offset = end;
    return `${DONUT_SEGMENT_COLORS[index % DONUT_SEGMENT_COLORS.length]} ${start}% ${end}%`;
  }).join(', ');
  const background = total > 0
    ? `conic-gradient(${stops})`
    : 'var(--content-border, #d8cdbc)';

  return (
    <div className="neo-card chart-card spatial-card">
      <h3>{title}</h3>
      <div className="donut-wrap">
        <div className="donut" style={{ background }}>
          <span>{total.toLocaleString()}</span>
        </div>
        <div className="chart-legend">
          {values.map((item, index) => (
            <div key={item.label}>
              <span
                className="legend-dot"
                style={{ background: item.value > 0 ? DONUT_SEGMENT_COLORS[index % DONUT_SEGMENT_COLORS.length] : 'var(--content-border, #d8cdbc)' }}
              />
              {item.label}: <strong>{item.value.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatStrip({ data }: { data: ChartPoint[] }) {
  return (
    <div className="grid grid-3 spatial-kpi-grid" style={{ marginBottom: 20 }}>
      {data.map((item) => (
        <div className="card spatial-card" key={item.label}>
          <div className="nav-heading">{item.label}</div>
          <div className="kpi-value">{nonNegativeValue(item.value).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
