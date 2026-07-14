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
