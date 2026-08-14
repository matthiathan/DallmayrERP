import type { NavSection } from '@/lib/auth/permissions';
import type { BusinessRole } from '@/types/dallmayrerp';

export function getSupplementalNavigationSections(role: BusinessRole, messagingEnabled: boolean): NavSection[] {
  const sections: NavSection[] = [];

  if (messagingEnabled) {
    sections.push({
      heading: 'Communications',
      items: [{
        href: '/work/messages',
        label: 'Messages',
        code: 'MSG01',
        roles: 'all',
        description: 'Direct and group conversations with colleagues.',
      }],
    });
  }

  if (role === 'admin' || role === 'executive') {
    sections.push({
      heading: 'Telemetry',
      items: [
        {
          href: '/telemetry',
          label: 'Machine Telemetry',
          code: 'TEL01',
          roles: ['admin', 'executive'],
          description: 'Daily, weekly, monthly and six-month machine sales and connectivity reporting.',
        },
        ...(role === 'admin' ? [{
          href: '/telemetry/devices',
          label: 'Telemetry Devices',
          code: 'TEL02',
          roles: ['admin'] as BusinessRole[],
          description: 'Assign devices to ERP machines and control telemetry ingestion.',
        }] : []),
      ],
    });
  }

  return sections;
}
