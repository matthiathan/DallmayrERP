export function KpiCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return (
    <div className="card kpi-card">
      <div className="nav-heading">{label}</div>
      <div className="kpi-value">{value}</div>
      {helper ? <p>{helper}</p> : null}
    </div>
  );
}
