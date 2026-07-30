export type PageTemplate = 'dashboard' | 'list' | 'record' | 'operational' | 'form' | 'default';

const dashboardPaths = new Set([
  '/',
  '/workspace',
  '/operations/dashboard',
  '/operations/reports',
  '/sales',
  '/finance',
  '/marketing',
  '/marketing/reports',
  '/executive',
  '/executive/command-centre',
  '/executive/branches',
  '/executive/contracts',
  '/executive/service',
  '/executive/warehouse',
  '/executive/reports',
]);

const operationalPrefixes = [
  '/work',
  '/technician',
  '/road-tech',
  '/admin/users',
  '/operations/dispatch',
  '/operations/exceptions',
  '/operations/service-planning',
  '/operations/service-jobs',
  '/operations/deliveries',
  '/warehouse/purchasing/approvals',
];

const listPaths = new Set([
  '/customers',
  '/operations/assets',
  '/operations/assets/lifecycle',
  '/operations/reliability',
  '/operations/maintenance',
  '/warehouse/stock',
  '/warehouse/planning',
  '/warehouse/purchasing',
  '/warehouse/locations',
  '/warehouse/traceability',
  '/warehouse/ledger',
  '/admin/activity',
  '/marketing/segments',
  '/marketing/campaigns',
  '/marketing/contract-renewals',
  '/finance/service-coverage',
  '/utilities/data-matching',
]);

const formPaths = new Set([
  '/onboarding',
]);

const recordRoots = [
  '/customers',
  '/operations/assets',
  '/warehouse/stock',
];

function startsWithRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isRecordRoute(pathname: string) {
  if (pathname.endsWith('/scan')) return false;

  return recordRoots.some((root) => {
    if (!pathname.startsWith(`${root}/`)) return false;
    const remainder = pathname.slice(root.length + 1);
    return Boolean(remainder) && !remainder.includes('/');
  });
}

export function getPageTemplate(pathname: string): PageTemplate {
  if (dashboardPaths.has(pathname)) return 'dashboard';
  if (operationalPrefixes.some((route) => startsWithRoute(pathname, route))) return 'operational';
  if (listPaths.has(pathname)) return 'list';
  if (isRecordRoute(pathname)) return 'record';
  if (formPaths.has(pathname)) return 'form';
  return 'default';
}

export function pageTemplateLabel(template: PageTemplate) {
  if (template === 'dashboard') return 'Dashboard workspace';
  if (template === 'list') return 'List workspace';
  if (template === 'record') return 'Record workspace';
  if (template === 'operational') return 'Operational workspace';
  if (template === 'form') return 'Form workspace';
  return 'Application workspace';
}
