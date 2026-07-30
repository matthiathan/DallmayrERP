import { redirect } from 'next/navigation';

export default function SharedDashboardsRedirectPage() {
  redirect('/workspace/dashboards');
}
