'use client';

export type ChartPoint = {
  label: string;
  value: number;
};

function safeMax(data: ChartPoint[]) {
  return Math.max(1, ...data.map((item) => item.value));
}

export function BarChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const max = safeMax(data);
  return (
    <div className="neo-card chart-card spatial-card">
      <h3>{title}</h3>
      <div className="bar-chart" aria-label={title}>
        {data.map((item) => (
          <div className="bar-row" key={item.label}>
            <span>{item.label}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} /></div>
            <strong>{item.value.toLocaleString()}</strong>
          </div>
        ))}
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
    const x = padding + (data.length <= 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth);
    const y = padding + usableHeight - (item.value / max) * usableHeight;
    return { ...item, x, y };
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
      <div className="chart-legend" aria-hidden="true">{data.map((item) => <div key={item.label}>{item.label}: <strong>{item.value.toLocaleString()}</strong></div>)}</div>
    </div>
  );
}

export function DonutChart({ title, data }: { title: string; data: ChartPoint[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  let offset = 0;
  const stops = data.map((item) => {
    const start = offset;
    const end = offset + (item.value / total) * 100;
    offset = end;
    return `var(--gold${start > 40 ? '-2' : ''}) ${start}% ${end}%`;
  }).join(', ');

  return (
    <div className="neo-card chart-card spatial-card">
      <h3>{title}</h3>
      <div className="donut-wrap">
        <div className="donut" style={{ background: `conic-gradient(${stops}, rgba(255,255,255,0.08) 0)` }}>
          <span>{total.toLocaleString()}</span>
        </div>
        <div className="chart-legend">
          {data.map((item) => (
            <div key={item.label}><span className="legend-dot" />{item.label}: <strong>{item.value.toLocaleString()}</strong></div>
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
          <div className="kpi-value">{item.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
