import { ErpMetricCard } from '@/components/ui/ErpLayout';

export function KpiCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return <ErpMetricCard helper={helper} label={label} value={value} />;
}
