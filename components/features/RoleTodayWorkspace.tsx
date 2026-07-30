'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { isNavItemAllowed, navSections, roleLabels } from '@/lib/auth/permissions';
import { readLocalStorage } from '@/lib/browser/safe-storage';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';
import type { BusinessRole } from '@/types/dallmayrerp';

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const RECENT_KEY = 'dallmayr-open-tabs';

type MetricKey =
  | 'my_active_work'
  | 'my_overdue_work'
  | 'my_high_priority_work'
  | 'my_open_service_jobs'
  | 'my_open_deliveries'
  | 'branch_open_work'
  | 'branch_overdue_work'
  | 'unassigned_work'
  | 'pending_work_approvals'
  | 'pending_purchase_approvals'
  | 'pending_approvals'
  | 'stock_alerts'
  | 'open_purchase_orders'
  | 'open_deliveries'
  | 'open_service_jobs'
  | 'business_users'
  | 'customer_count'
  | 'contract_records'
  | 'renewals_due_90'
  | 'open_opportunities'
  | 'commercial_accounts'
  | 'active_campaigns'
  | 'marketing_segments';

type WorkspaceSummary = Partial<Record<MetricKey, number>> & {
  user_id: string;
  role: BusinessRole;
  branch: string;
};

type TodayLink = { href: string; label: string; helper: string; badge?: MetricKey };
type TodayMetric = { key: MetricKey; label: string; helper: string };
type TodayDefinition = {
  description: string;
  attention: TodayLink[];
  work: TodayLink[];
  metrics: TodayMetric[];
};
type RecentPage = { href: string; label: string };

const definitions: Record<BusinessRole, TodayDefinition> = {
  admin: {
    description: 'System access, national exceptions, approvals and operational control.',
    attention: [
      { href: '/work', label: 'Approvals waiting', helper: 'Work and purchase decisions still require action.', badge: 'pending_approvals' },
      { href: '/work', label: 'Overdue work', helper: 'National work has moved beyond its due or SLA date.', badge: 'branch_overdue_work' },
      { href: '/warehouse/planning', label: 'Stock exceptions', helper: 'Inventory alerts require review or redistribution.', badge: 'stock_alerts' },
      { href: '/operations/service-jobs', label: 'Open service jobs', helper: 'Service work remains open nationally.', badge: 'open_service_jobs' },
    ],
    work: [
      { href: '/work', label: 'Open Action Centre', helper: 'Review approvals, exceptions and unassigned work.', badge: 'pending_approvals' },
      { href: '/admin/users', label: 'Manage user access', helper: 'Maintain invitations, roles, branches and permissions.', badge: 'business_users' },
      { href: '/operations/exceptions', label: 'Review Exception Centre', helper: 'Assign, escalate, snooze or resolve persistent cases.', badge: 'branch_overdue_work' },
      { href: '/warehouse/stock', label: 'Open Stock Control', helper: 'Receive, issue, transfer, adjust and count inventory.', badge: 'stock_alerts' },
    ],
    metrics: [
      { key: 'branch_open_work', label: 'Open work', helper: 'Active operational work nationally.' },
      { key: 'pending_approvals', label: 'Pending approvals', helper: 'Decisions waiting across work and purchasing.' },
      { key: 'business_users', label: 'Business users', helper: 'ERP access records currently configured.' },
      { key: 'customer_count', label: 'Customers', helper: 'Customer records available in the ERP.' },
    ],
  },
  operations: {
    description: 'Branch workload, dispatch pressure, exceptions and service delivery.',
    attention: [
      { href: '/work', label: 'Overdue branch work', helper: 'Work is beyond its due or SLA date.', badge: 'branch_overdue_work' },
      { href: '/operations/dispatch', label: 'Unassigned work', helper: 'Open work still requires an accountable owner.', badge: 'unassigned_work' },
      { href: '/operations/service-jobs', label: 'Open service jobs', helper: 'Service work still requires completion.', badge: 'open_service_jobs' },
      { href: '/operations/deliveries', label: 'Open deliveries', helper: 'Delivery orders have not yet been closed.', badge: 'open_deliveries' },
    ],
    work: [
      { href: '/operations/dispatch', label: 'Open dispatch overview', helper: 'Balance routes, technicians, service and delivery pressure.', badge: 'unassigned_work' },
      { href: '/operations/exceptions', label: 'Triage exceptions', helper: 'Acknowledge, assign, escalate and resolve operational cases.', badge: 'branch_overdue_work' },
      { href: '/operations/service-planning', label: 'Plan today’s routes', helper: 'Assign drivers, route numbers, stop order and reschedules.' },
      { href: '/operations/service-jobs', label: 'Manage service jobs', helper: 'Create requested work and dispatch technicians.', badge: 'open_service_jobs' },
    ],
    metrics: [
      { key: 'branch_open_work', label: 'Open branch work', helper: 'Active work in your branch scope.' },
      { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Work beyond its due or SLA date.' },
      { key: 'unassigned_work', label: 'Unassigned', helper: 'Work still requiring an owner.' },
      { key: 'open_service_jobs', label: 'Service jobs', helper: 'Open service work in your scope.' },
    ],
  },
  warehouse_staff: {
    description: 'Inventory exceptions, receiving, movement control and assigned warehouse work.',
    attention: [
      { href: '/warehouse/planning', label: 'Stock alerts', helper: 'Items require replenishment or branch redistribution.', badge: 'stock_alerts' },
      { href: '/warehouse/purchasing', label: 'Purchase orders open', helper: 'Orders remain partially received or outstanding.', badge: 'open_purchase_orders' },
      { href: '/work', label: 'Delivery work open', helper: 'Warehouse-related delivery work still requires action.', badge: 'open_deliveries' },
      { href: '/work', label: 'Assigned work', helper: 'Warehouse tasks are assigned directly to you.', badge: 'my_active_work' },
    ],
    work: [
      { href: '/warehouse/stock', label: 'Open Stock Control', helper: 'Scan, receive, issue, transfer, adjust or count stock.', badge: 'stock_alerts' },
      { href: '/warehouse/purchasing', label: 'Receive purchase orders', helper: 'Receive stock into the correct warehouse location.', badge: 'open_purchase_orders' },
      { href: '/warehouse/locations', label: 'Manage locations', helper: 'Maintain warehouses, stockrooms, shelves and bins.' },
      { href: '/warehouse/ledger', label: 'Review inventory ledger', helper: 'Inspect movement references and resulting balances.' },
    ],
    metrics: [
      { key: 'stock_alerts', label: 'Stock alerts', helper: 'Inventory exceptions requiring review.' },
      { key: 'open_purchase_orders', label: 'Purchase orders', helper: 'Orders not fully received or closed.' },
      { key: 'open_deliveries', label: 'Delivery work', helper: 'Delivery-related work not yet closed.' },
      { key: 'my_active_work', label: 'My work', helper: 'Open tasks assigned directly to you.' },
    ],
  },
  technician: {
    description: 'Assigned service work, high-priority jobs and evidence capture.',
    attention: [
      { href: '/technician', label: 'High-priority work', helper: 'High or critical assigned work requires attention.', badge: 'my_high_priority_work' },
      { href: '/technician', label: 'Overdue work', helper: 'Assigned work is beyond its due or SLA date.', badge: 'my_overdue_work' },
      { href: '/technician', label: 'Service jobs open', helper: 'Assigned machine work remains incomplete.', badge: 'my_open_service_jobs' },
      { href: '/work/execution', label: 'Active assigned work', helper: 'Open work is ready for execution.', badge: 'my_active_work' },
    ],
    work: [
      { href: '/technician', label: 'Open my technician jobs', helper: 'Start or continue machine work assigned by Operations.', badge: 'my_open_service_jobs' },
      { href: '/operations/assets/scan', label: 'Scan a machine', helper: 'Find a machine, assigned job or asset identifier.' },
      { href: '/work/execution', label: 'Execute assigned work', helper: 'Complete checklists, evidence, comments and parts used.', badge: 'my_active_work' },
      { href: '/operations/reliability', label: 'Capture reliability evidence', helper: 'Record meter readings, downtime and restoration.' },
    ],
    metrics: [
      { key: 'my_active_work', label: 'Active work', helper: 'Open work assigned directly to you.' },
      { key: 'my_overdue_work', label: 'Overdue', helper: 'Assigned work beyond its due date.' },
      { key: 'my_open_service_jobs', label: 'Service jobs', helper: 'Open service jobs assigned to you.' },
      { key: 'my_high_priority_work', label: 'High priority', helper: 'High or critical assigned work.' },
    ],
  },
  road_technician: {
    description: 'Assigned routes, delivery work, service jobs and field evidence.',
    attention: [
      { href: '/road-tech', label: 'Overdue field work', helper: 'Assigned work is beyond its due or SLA date.', badge: 'my_overdue_work' },
      { href: '/road-tech', label: 'Deliveries open', helper: 'Assigned delivery work still requires completion.', badge: 'my_open_deliveries' },
      { href: '/road-tech', label: 'Service jobs open', helper: 'Assigned machine work remains incomplete.', badge: 'my_open_service_jobs' },
      { href: '/work/execution', label: 'Active assigned work', helper: 'Open field tasks are ready for execution.', badge: 'my_active_work' },
    ],
    work: [
      { href: '/road-tech', label: 'Open today’s routes', helper: 'Continue assigned route, service and delivery work.', badge: 'my_open_deliveries' },
      { href: '/operations/assets/scan', label: 'Scan a machine or job', helper: 'Find field work from a barcode, QR code or identifier.' },
      { href: '/work/execution', label: 'Execute assigned work', helper: 'Capture checklist results, evidence and parts used.', badge: 'my_active_work' },
      { href: '/operations/reliability', label: 'Capture reliability evidence', helper: 'Record meter readings, downtime and restoration.' },
    ],
    metrics: [
      { key: 'my_active_work', label: 'Active work', helper: 'Open work assigned directly to you.' },
      { key: 'my_overdue_work', label: 'Overdue', helper: 'Assigned work beyond its due date.' },
      { key: 'my_open_deliveries', label: 'Deliveries', helper: 'Open deliveries assigned to you.' },
      { key: 'my_open_service_jobs', label: 'Service jobs', helper: 'Open service jobs assigned to you.' },
    ],
  },
  sales: {
    description: 'Customer coverage, opportunities and assigned account work.',
    attention: [
      { href: '/sales', label: 'Open opportunities', helper: 'Pipeline items require follow-up or quotation.', badge: 'open_opportunities' },
      { href: '/sales', label: 'Contract exposure', helper: 'Contract records indicate upcoming renewal pressure.', badge: 'renewals_due_90' },
      { href: '/work', label: 'Assigned requests', helper: 'Open requests or tasks are assigned to you.', badge: 'my_active_work' },
    ],
    work: [
      { href: '/sales', label: 'Open sales workspace', helper: 'Review pipeline, account work and opportunities.', badge: 'open_opportunities' },
      { href: '/customers', label: 'Find a customer', helper: 'Search account, branch, phone, email or address.', badge: 'customer_count' },
      { href: '/sales', label: 'Review account follow-up', helper: 'Prioritize opportunities and contract-related account work.', badge: 'renewals_due_90' },
      { href: '/work', label: 'Track my requests', helper: 'Review your assigned tasks and operational requests.', badge: 'my_active_work' },
    ],
    metrics: [
      { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.' },
      { key: 'contract_records', label: 'Contracts', helper: 'Contract records in scope.' },
      { key: 'open_opportunities', label: 'Opportunities', helper: 'Open or follow-up pipeline items.' },
      { key: 'my_active_work', label: 'My work', helper: 'Open requests or tasks assigned to you.' },
    ],
  },
  finance: {
    description: 'Commercial account coverage, purchase approvals and finance decisions.',
    attention: [
      { href: '/warehouse/purchasing/approvals', label: 'Purchase approvals', helper: 'Purchase orders are waiting for a finance decision.', badge: 'pending_purchase_approvals' },
      { href: '/work', label: 'Work approvals', helper: 'Work items require approval or rejection.', badge: 'pending_work_approvals' },
      { href: '/work', label: 'Assigned finance work', helper: 'Open finance tasks are assigned directly to you.', badge: 'my_active_work' },
    ],
    work: [
      { href: '/warehouse/purchasing/approvals', label: 'Review purchase approvals', helper: 'Assess purchasing risk and approve or reject requests.', badge: 'pending_purchase_approvals' },
      { href: '/work', label: 'Open approval queue', helper: 'Review finance requests and assigned decisions.', badge: 'pending_work_approvals' },
      { href: '/finance', label: 'Open finance workspace', helper: 'Review commercial accounts and finance reporting.', badge: 'commercial_accounts' },
      { href: '/finance/service-coverage', label: 'Review service coverage', helper: 'Compare monthly payments with completed customer service.' },
    ],
    metrics: [
      { key: 'commercial_accounts', label: 'Commercial accounts', helper: 'Accounts available in your branch scope.' },
      { key: 'pending_purchase_approvals', label: 'Purchase approvals', helper: 'Purchase decisions waiting for action.' },
      { key: 'pending_work_approvals', label: 'Work approvals', helper: 'Work decisions waiting for action.' },
      { key: 'my_active_work', label: 'My work', helper: 'Open work assigned directly to you.' },
    ],
  },
  marketing: {
    description: 'Campaign delivery, audience segments, renewals and customer coverage.',
    attention: [
      { href: '/marketing/contract-renewals', label: 'Renewals due', helper: 'Contracts are expired or due within 90 days.', badge: 'renewals_due_90' },
      { href: '/marketing/campaigns', label: 'Campaigns active', helper: 'Campaigns are currently in planning or execution.', badge: 'active_campaigns' },
    ],
    work: [
      { href: '/marketing', label: 'Open marketing dashboard', helper: 'Review campaign, segment and renewal performance.', badge: 'active_campaigns' },
      { href: '/marketing/contract-renewals', label: 'Prioritize renewals', helper: 'Focus account follow-up on upcoming exposure.', badge: 'renewals_due_90' },
      { href: '/marketing/campaigns', label: 'Manage campaigns', helper: 'Plan, launch and track campaign activity.', badge: 'active_campaigns' },
      { href: '/marketing/segments', label: 'Manage audience segments', helper: 'Maintain target groups for campaign planning.', badge: 'marketing_segments' },
    ],
    metrics: [
      { key: 'active_campaigns', label: 'Active campaigns', helper: 'Campaigns not completed or cancelled.' },
      { key: 'marketing_segments', label: 'Segments', helper: 'Saved audience segments.' },
      { key: 'renewals_due_90', label: 'Renewals due', helper: 'Contracts expired or due within 90 days.' },
      { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.' },
    ],
  },
  executive: {
    description: 'National risk, service pressure, approvals and inventory exposure.',
    attention: [
      { href: '/executive/command-centre', label: 'Overdue operational work', helper: 'National work is beyond its due or SLA date.', badge: 'branch_overdue_work' },
      { href: '/warehouse/purchasing/approvals', label: 'Approvals waiting', helper: 'Work and purchase approvals require attention.', badge: 'pending_approvals' },
      { href: '/executive/warehouse', label: 'Stock risk', helper: 'Inventory alerts require management visibility.', badge: 'stock_alerts' },
      { href: '/executive/command-centre', label: 'Open operational work', helper: 'Active work remains open nationally.', badge: 'branch_open_work' },
    ],
    work: [
      { href: '/executive/command-centre', label: 'Open command centre', helper: 'Review branch risk and operational performance.', badge: 'branch_overdue_work' },
      { href: '/executive/service', label: 'Review service performance', helper: 'Inspect SLA pressure, downtime and reliability.' },
      { href: '/executive/warehouse', label: 'Review warehouse risk', helper: 'Inspect stock alerts and inventory exposure.', badge: 'stock_alerts' },
      { href: '/executive/contracts', label: 'Review contract risk', helper: 'Inspect renewal pressure and commercial exposure.' },
    ],
    metrics: [
      { key: 'branch_open_work', label: 'Open work', helper: 'Active operational work nationally.' },
      { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Work beyond its due or SLA date.' },
      { key: 'pending_approvals', label: 'Approvals', helper: 'Work and purchase decisions waiting.' },
      { key: 'stock_alerts', label: 'Stock alerts', helper: 'Inventory exceptions requiring visibility.' },
    ],
  },
};

function formatBranch(branch: string) {
  if (branch === 'jhb') return 'Johannesburg';
  if (branch === 'cpt') return 'Cape Town';
  if (branch === 'kzn') return 'KwaZulu-Natal';
  return 'National';
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

function metricNumber(summary: WorkspaceSummary | null, key: MetricKey) {
  return Number(summary?.[key] ?? 0);
}

function metricValue(summary: WorkspaceSummary | null, key: MetricKey) {
  return metricNumber(summary, key).toLocaleString('en-ZA');
}

function greetingFor(date: Date) {
  if (date.getHours() < 12) return 'Good morning';
  if (date.getHours() < 18) return 'Good afternoon';
  return 'Good evening';
}

function safeFavorites(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}

function safeRecent(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentPage[] => {
      if (!item || typeof item !== 'object' || !('href' in item) || !('label' in item)) return [];
      return typeof item.href === 'string' && typeof item.label === 'string' ? [{ href: item.href, label: item.label }] : [];
    });
  } catch {
    return [];
  }
}

export function RoleTodayWorkspace() {
  const { businessProfile, businessUser, userDetails } = useAuth();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>([]);
  const [recentPages, setRecentPages] = useState<RecentPage[]>([]);
  const role = userDetails?.role;

  const loadSummary = useCallback(async () => {
    if (!businessUser?.id || !role) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: summaryError } = await getSupabaseClient().rpc('get_role_workspace_summary');
      if (summaryError) throw summaryError;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The Today summary returned an invalid response.');
      setSummary(data as WorkspaceSummary);
      setLastUpdated(new Date());
    } catch (loadError) {
      setSummary(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load your Today workspace.');
    } finally {
      setLoading(false);
    }
  }, [businessUser?.id, role]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  useEffect(() => {
    const loadLocalNavigation = () => {
      setFavoriteHrefs(safeFavorites(readLocalStorage(FAVORITES_KEY)));
      setRecentPages(safeRecent(readLocalStorage(RECENT_KEY)).slice(-9));
    };
    loadLocalNavigation();
    window.addEventListener('storage', loadLocalNavigation);
    window.addEventListener('focus', loadLocalNavigation);
    return () => {
      window.removeEventListener('storage', loadLocalNavigation);
      window.removeEventListener('focus', loadLocalNavigation);
    };
  }, []);

  const allowedItems = useMemo(() => {
    if (!role) return [];
    const seen = new Set<string>();
    return navSections.flatMap((section) => section.items)
      .filter((item) => isNavItemAllowed(role, item))
      .filter((item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      });
  }, [role]);

  const allowedByHref = useMemo(() => new Map(allowedItems.map((item) => [item.href, item])), [allowedItems]);
  const pinnedPages = useMemo(() => favoriteHrefs.flatMap((href) => {
    const item = allowedByHref.get(href);
    return item ? [item] : [];
  }), [allowedByHref, favoriteHrefs]);
  const visibleRecent = useMemo(() => {
    const seen = new Set<string>();
    return [...recentPages].reverse()
      .filter((page) => page.href !== '/workspace' && allowedByHref.has(page.href))
      .filter((page) => {
        if (seen.has(page.href)) return false;
        seen.add(page.href);
        return true;
      })
      .slice(0, 5);
  }, [allowedByHref, recentPages]);

  if (!role || !businessUser || !userDetails) {
    return <EmptyState title="Today workspace unavailable" message="Your role and profile details are still loading. Refresh the page if this does not update." />;
  }

  const definition = definitions[role];
  const userName = displayProfileName(businessProfile);
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const accessibleAttention = definition.attention.filter((item) => allowedByHref.has(item.href));
  const accessibleWork = definition.work.filter((item) => allowedByHref.has(item.href));
  const attentionItems = accessibleAttention.filter((item) => item.badge && metricNumber(summary, item.badge) > 0);

  return (
    <div className="today-workspace-stage">
      <header className="today-workspace-hero">
        <div className="today-user-avatar" aria-hidden="true">{initialsFor(userName)}</div>
        <div className="today-workspace-heading">
          <span>{dateLabel}</span>
          <h1>{greetingFor(now)}, {userName}</h1>
          <p>{definition.description}</p>
          <div className="today-context-row"><span>{roleLabels[role]}</span><span>{formatBranch(summary?.branch ?? userDetails.branch)}</span></div>
        </div>
        <div className="today-refresh-block">
          <button className="button secondary" disabled={loading} onClick={() => void loadSummary()} type="button">{loading ? 'Refreshing…' : 'Refresh Today'}</button>
          <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Live role data'}</small>
        </div>
      </header>

      {error ? <div className="error today-workspace-error" role="alert"><strong>Today could not be refreshed.</strong><span>{error}</span></div> : null}
      {loading ? <HamsterLoader label="Loading your Today workspace" /> : null}

      {!loading ? (
        <>
          <section aria-labelledby="today-attention-title" className="today-section today-attention-section">
            <div className="today-section-heading">
              <div><span>Needs attention</span><h2 id="today-attention-title">What should happen next</h2></div>
              <small>{attentionItems.length ? `${attentionItems.length} priority area${attentionItems.length === 1 ? '' : 's'}` : 'No urgent signals'}</small>
            </div>
            {attentionItems.length ? (
              <div className="today-attention-grid">
                {attentionItems.map((item) => (
                  <Link className="today-attention-card" href={item.href} key={`${item.href}:${item.badge}`}>
                    <span className="today-attention-count">{item.badge ? metricValue(summary, item.badge) : '0'}</span>
                    <div><strong>{item.label}</strong><p>{item.helper}</p></div><span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="today-clear-state"><span aria-hidden="true">✓</span><div><strong>No urgent role signals</strong><p>Your summary does not show overdue, unassigned or approval pressure. Continue with the prioritized work below.</p></div></div>
            )}
          </section>

          <div className="today-primary-grid">
            <section aria-labelledby="today-work-title" className="today-section today-work-section">
              <div className="today-section-heading"><div><span>Your work</span><h2 id="today-work-title">Prioritized role actions</h2></div></div>
              <div className="today-work-list">
                {accessibleWork.map((item, index) => (
                  <Link className={`today-work-row ${index === 0 ? 'is-primary' : ''}`} href={item.href} key={`${item.href}:${item.label}`}>
                    <span className="today-work-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{item.label}</strong><p>{item.helper}</p></div>
                    {item.badge ? <span className="today-work-count">{metricValue(summary, item.badge)}</span> : <span aria-hidden="true" className="today-work-arrow">→</span>}
                  </Link>
                ))}
              </div>
            </section>

            <aside aria-labelledby="today-snapshot-title" className="today-section today-snapshot-section">
              <div className="today-section-heading"><div><span>Snapshot</span><h2 id="today-snapshot-title">Current role position</h2></div></div>
              <div className="today-metric-list">
                {definition.metrics.map((metric) => (
                  <article className="today-metric-row" key={metric.key}><div><strong>{metric.label}</strong><p>{metric.helper}</p></div><span>{metricValue(summary, metric.key)}</span></article>
                ))}
              </div>
            </aside>
          </div>

          <section aria-label="Pinned and recent pages" className="today-shortcuts-grid">
            <div className="today-section today-shortcut-section">
              <div className="today-section-heading"><div><span>Pinned</span><h2>Pages you keep close</h2></div></div>
              {pinnedPages.length ? <div className="today-link-list">{pinnedPages.map((page) => <Link href={page.href} key={page.href}><span>★</span><div><strong>{page.label}</strong><small>{page.description ?? 'Pinned application page'}</small></div><span aria-hidden="true">→</span></Link>)}</div> : <p className="today-shortcut-empty">Pin up to four pages from the application navigation. They will appear here and in the desktop rail.</p>}
            </div>
            <div className="today-section today-shortcut-section">
              <div className="today-section-heading"><div><span>Recent</span><h2>Continue where you left off</h2></div></div>
              {visibleRecent.length ? <div className="today-link-list">{visibleRecent.map((page) => <Link href={page.href} key={page.href}><span>↗</span><div><strong>{page.label}</strong><small>Recently opened</small></div><span aria-hidden="true">→</span></Link>)}</div> : <p className="today-shortcut-empty">Recently opened role pages will appear here as you use the application.</p>}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
