'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  ErpContentGrid,
  ErpFormSection,
  ErpPage,
  ErpPageHeader,
  ErpPanel,
  ErpStateBanner,
  ErpToolbar,
} from '@/components/ui/ErpLayout';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { roleLabels } from '@/lib/auth/permissions';
import {
  sharedDashboardBranchLabel,
  sharedDashboardBranchOptions,
  sharedDashboardMetricForRole,
  sharedDashboardMetricsForRole,
  sharedDashboardRoleAllowsMetric,
  sharedDashboardRoleOptions,
  sharedDashboardSlug,
  type SharedDashboardMetricKey,
  type SharedDashboardRecord,
  type SharedDashboardWidgetRecord,
} from '@/lib/dashboards/shared-dashboard-catalog';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole } from '@/types/dallmayrerp';

function sortedWidgets(dashboard: SharedDashboardRecord | null) {
  return [...(dashboard?.shared_dashboard_widgets ?? [])]
    .sort((left, right) => left.position - right.position || left.created_at.localeCompare(right.created_at));
}

function isValidSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 3 && value.length <= 80;
}

export function AdminSharedDashboardManager() {
  const { businessUser, userDetails } = useAuth();
  const [dashboards, setDashboards] = useState<SharedDashboardRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<BusinessRole>('operations');
  const [newBranch, setNewBranch] = useState<Branch | ''>('');

  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRole, setEditRole] = useState<BusinessRole>('operations');
  const [editBranch, setEditBranch] = useState<Branch | ''>('');
  const [addMetricKey, setAddMetricKey] = useState<SharedDashboardMetricKey | ''>('');

  const isAdmin = userDetails?.role === 'admin';

  const loadDashboards = useCallback(async () => {
    if (!businessUser?.id || !isAdmin) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await getSupabaseClient()
        .from('shared_dashboards')
        .select(`
          id, name, slug, description, target_role, branch_scope, is_published,
          published_at, created_by, updated_by, created_at, updated_at,
          shared_dashboard_widgets(id, dashboard_id, metric_key, position, created_at, updated_at)
        `)
        .order('name');

      if (loadError) throw loadError;
      const next = (data ?? []) as SharedDashboardRecord[];
      setDashboards(next);
      setSelectedId((current) => current && next.some((dashboard) => dashboard.id === current)
        ? current
        : next[0]?.id ?? null);
    } catch (loadError) {
      setDashboards([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load shared dashboards.');
    } finally {
      setLoading(false);
    }
  }, [businessUser?.id, isAdmin]);

  useEffect(() => {
    loadDashboards().catch(() => undefined);
  }, [loadDashboards]);

  const selected = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === selectedId) ?? null,
    [dashboards, selectedId],
  );
  const widgets = useMemo(() => sortedWidgets(selected), [selected]);

  useEffect(() => {
    if (!selected) return;
    setEditName(selected.name);
    setEditSlug(selected.slug);
    setEditDescription(selected.description ?? '');
    setEditRole(selected.target_role);
    setEditBranch(selected.branch_scope ?? '');
  }, [selected]);

  const invalidWidgets = useMemo(
    () => widgets.filter((widget) => !sharedDashboardRoleAllowsMetric(editRole, widget.metric_key)),
    [editRole, widgets],
  );

  const availableMetrics = useMemo(() => {
    if (!selected) return [];
    const existing = new Set(widgets.map((widget) => widget.metric_key));
    return sharedDashboardMetricsForRole(selected.target_role).filter((metric) => !existing.has(metric.key));
  }, [selected, widgets]);

  useEffect(() => {
    if (!availableMetrics.some((metric) => metric.key === addMetricKey)) {
      setAddMetricKey(availableMetrics[0]?.key ?? '');
    }
  }, [addMetricKey, availableMetrics]);

  function clearNotice() {
    setError(null);
    setMessage(null);
  }

  async function createDashboard() {
    if (!businessUser?.id || !isAdmin) return;
    const name = newName.trim();
    const slug = sharedDashboardSlug(name);
    if (name.length < 3 || !isValidSlug(slug)) {
      setError('Enter a dashboard name of at least three characters.');
      return;
    }

    clearNotice();
    setSaving(true);
    try {
      const { data, error: createError } = await getSupabaseClient()
        .from('shared_dashboards')
        .insert({
          name,
          slug,
          target_role: newRole,
          branch_scope: newBranch || null,
          is_published: false,
          created_by: businessUser.id,
          updated_by: businessUser.id,
        })
        .select('id')
        .single();
      if (createError) throw createError;
      setNewName('');
      setMessage('Draft shared dashboard created. Add permitted metrics before publishing.');
      await loadDashboards();
      if (data?.id) setSelectedId(data.id as string);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the shared dashboard.');
    } finally {
      setSaving(false);
    }
  }

  async function saveDashboard() {
    if (!businessUser?.id || !selected) return;
    const name = editName.trim();
    const slug = editSlug.trim().toLowerCase();
    if (name.length < 3 || !isValidSlug(slug)) {
      setError('Dashboard name and slug must both be valid before saving.');
      return;
    }
    if (invalidWidgets.length > 0) {
      setError('Remove widgets that are not permitted for the selected role before saving the role change.');
      return;
    }

    clearNotice();
    setSaving(true);
    try {
      const { error: saveError } = await getSupabaseClient()
        .from('shared_dashboards')
        .update({
          name,
          slug,
          description: editDescription.trim() || null,
          target_role: editRole,
          branch_scope: editBranch || null,
          updated_by: businessUser.id,
        })
        .eq('id', selected.id);
      if (saveError) throw saveError;
      setMessage('Shared dashboard settings saved.');
      await loadDashboards();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the shared dashboard.');
    } finally {
      setSaving(false);
    }
  }

  async function addWidget() {
    if (!selected || !addMetricKey) return;
    if (editRole !== selected.target_role) {
      setError('Save the dashboard role change before adding widgets for the new role.');
      return;
    }

    clearNotice();
    setSaving(true);
    try {
      const nextPosition = widgets.length ? Math.max(...widgets.map((widget) => widget.position)) + 1 : 0;
      const { error: insertError } = await getSupabaseClient()
        .from('shared_dashboard_widgets')
        .insert({ dashboard_id: selected.id, metric_key: addMetricKey, position: nextPosition });
      if (insertError) throw insertError;
      setMessage('Metric widget added.');
      await loadDashboards();
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : 'Could not add the metric widget.');
    } finally {
      setSaving(false);
    }
  }

  async function moveWidget(widget: SharedDashboardWidgetRecord, direction: -1 | 1) {
    const index = widgets.findIndex((item) => item.id === widget.id);
    const swap = widgets[index + direction];
    if (!swap) return;

    clearNotice();
    setSaving(true);
    try {
      const client = getSupabaseClient();
      const [first, second] = await Promise.all([
        client.from('shared_dashboard_widgets').update({ position: swap.position }).eq('id', widget.id),
        client.from('shared_dashboard_widgets').update({ position: widget.position }).eq('id', swap.id),
      ]);
      if (first.error) throw first.error;
      if (second.error) throw second.error;
      await loadDashboards();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Could not reorder dashboard widgets.');
    } finally {
      setSaving(false);
    }
  }

  async function removeWidget(widget: SharedDashboardWidgetRecord) {
    if (!selected) return;
    if (selected.is_published && widgets.length === 1) {
      setError('Unpublish the dashboard before removing its final widget.');
      return;
    }
    const metric = sharedDashboardMetricForRole(selected.target_role, widget.metric_key);
    if (!window.confirm(`Remove ${metric?.label ?? widget.metric_key} from ${selected.name}?`)) return;

    clearNotice();
    setSaving(true);
    try {
      const { error: deleteError } = await getSupabaseClient()
        .from('shared_dashboard_widgets')
        .delete()
        .eq('id', widget.id);
      if (deleteError) throw deleteError;
      setMessage('Metric widget removed.');
      await loadDashboards();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the metric widget.');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublication() {
    if (!businessUser?.id || !selected) return;
    if (!selected.is_published && widgets.length === 0) {
      setError('Add at least one permitted metric before publishing this dashboard.');
      return;
    }
    if (invalidWidgets.length > 0 || editRole !== selected.target_role) {
      setError('Save a valid role/widget configuration before changing publication status.');
      return;
    }

    clearNotice();
    setSaving(true);
    try {
      const nextPublished = !selected.is_published;
      const { error: publishError } = await getSupabaseClient()
        .from('shared_dashboards')
        .update({ is_published: nextPublished, updated_by: businessUser.id })
        .eq('id', selected.id);
      if (publishError) throw publishError;
      setMessage(nextPublished ? 'Shared dashboard published.' : 'Shared dashboard returned to draft.');
      await loadDashboards();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Could not change dashboard publication status.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDashboard() {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected.name} and its shared widgets? This cannot be undone.`)) return;

    clearNotice();
    setSaving(true);
    try {
      const { error: deleteError } = await getSupabaseClient()
        .from('shared_dashboards')
        .delete()
        .eq('id', selected.id);
      if (deleteError) throw deleteError;
      setMessage('Shared dashboard deleted.');
      setSelectedId(null);
      await loadDashboards();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the shared dashboard.');
    } finally {
      setSaving(false);
    }
  }

  if (!userDetails) return <HamsterLoader label="Loading administrator permissions" />;

  if (!isAdmin) {
    return (
      <ErpStateBanner
        message="Only administrators can create, configure or publish shared dashboards."
        title="Administrator access required"
        tone="danger"
      />
    );
  }

  return (
    <ErpPage variant="form">
      <ErpPageHeader
        actions={<Link className="button secondary" href="/workspace/dashboards">Open shared dashboards</Link>}
        description="Publish constrained metric dashboards by role and optional branch audience. Widgets reuse the existing authorised role summary; no custom SQL, RPC or arbitrary drill-down can be configured here."
        eyebrow="Administrator only"
        title="Shared dashboard publishing"
      />

      {error ? <ErpStateBanner message={error} title="Dashboard update failed" tone="danger" /> : null}
      {message ? <ErpStateBanner message={message} title="Dashboard updated" tone="success" /> : null}

      <ErpFormSection
        actions={<button className="button" disabled={saving || newName.trim().length < 3} onClick={createDashboard} type="button">Create draft dashboard</button>}
        description="New dashboards always begin as drafts. Add allowed metrics, review the audience, then publish."
        title="Create shared dashboard"
      >
        <div className="grid grid-3">
          <label>
            Dashboard name
            <input maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="Operations daily overview" value={newName} />
          </label>
          <label>
            Target role
            <select onChange={(event) => setNewRole(event.target.value as BusinessRole)} value={newRole}>
              {sharedDashboardRoleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select>
          </label>
          <label>
            Branch audience
            <select onChange={(event) => setNewBranch(event.target.value as Branch | '')} value={newBranch}>
              <option value="">All branches</option>
              {sharedDashboardBranchOptions.map((branch) => <option key={branch} value={branch}>{sharedDashboardBranchLabel(branch)}</option>)}
            </select>
          </label>
        </div>
      </ErpFormSection>

      {loading ? <HamsterLoader label="Loading shared dashboard administration" /> : null}

      {!loading ? (
        <ErpContentGrid columns={2}>
          <ErpPanel
            description="Select a draft or published dashboard to configure."
            title={`Dashboards (${dashboards.length})`}
          >
            <div className="grid">
              {dashboards.length === 0 ? <p>No shared dashboards have been created.</p> : null}
              {dashboards.map((dashboard) => (
                <button
                  className={dashboard.id === selectedId ? 'button' : 'button secondary'}
                  key={dashboard.id}
                  onClick={() => setSelectedId(dashboard.id)}
                  type="button"
                >
                  {dashboard.name} · {roleLabels[dashboard.target_role]} · {sharedDashboardBranchLabel(dashboard.branch_scope)}
                </button>
              ))}
            </div>
          </ErpPanel>

          <ErpPanel
            actions={selected ? <StatusBadge value={selected.is_published ? 'published' : 'draft'} /> : undefined}
            description={selected ? `${roleLabels[selected.target_role]} · ${sharedDashboardBranchLabel(selected.branch_scope)}` : 'Choose a dashboard to edit.'}
            title={selected?.name ?? 'Dashboard settings'}
          >
            {!selected ? <p>Select or create a dashboard to continue.</p> : (
              <div className="grid">
                <ErpFormSection title="Publication settings">
                  <div className="grid grid-2">
                    <label>
                      Name
                      <input maxLength={80} onChange={(event) => setEditName(event.target.value)} value={editName} />
                    </label>
                    <label>
                      Slug
                      <input maxLength={80} onChange={(event) => setEditSlug(event.target.value)} value={editSlug} />
                    </label>
                    <label>
                      Target role
                      <select onChange={(event) => setEditRole(event.target.value as BusinessRole)} value={editRole}>
                        {sharedDashboardRoleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>
                    </label>
                    <label>
                      Branch audience
                      <select onChange={(event) => setEditBranch(event.target.value as Branch | '')} value={editBranch}>
                        <option value="">All branches</option>
                        {sharedDashboardBranchOptions.map((branch) => <option key={branch} value={branch}>{sharedDashboardBranchLabel(branch)}</option>)}
                      </select>
                    </label>
                  </div>
                  <label>
                    Description
                    <textarea maxLength={280} onChange={(event) => setEditDescription(event.target.value)} rows={3} value={editDescription} />
                  </label>
                  {invalidWidgets.length > 0 ? (
                    <ErpStateBanner
                      message={`Remove ${invalidWidgets.length} widget(s) that are not allowed for ${roleLabels[editRole]} before saving this role change.`}
                      title="Role change needs widget cleanup"
                      tone="warning"
                    />
                  ) : null}
                  <ErpToolbar
                    primary={<button className="button" disabled={saving || invalidWidgets.length > 0} onClick={saveDashboard} type="button">Save settings</button>}
                    secondary={(
                      <>
                        <button className="button secondary" disabled={saving} onClick={togglePublication} type="button">
                          {selected.is_published ? 'Return to draft' : 'Publish dashboard'}
                        </button>
                        <button className="button danger" disabled={saving} onClick={deleteDashboard} type="button">Delete</button>
                      </>
                    )}
                  />
                  <p>
                    Shareable route for the authorised target audience: <code>/workspace/dashboards/{selected.slug}</code>
                  </p>
                </ErpFormSection>

                <ErpFormSection
                  description="Only the fixed metrics authorised for this dashboard role can be added. Values remain scoped by the viewer's existing role and branch permissions."
                  title={`Metric widgets (${widgets.length})`}
                >
                  {editRole !== selected.target_role ? (
                    <ErpStateBanner
                      message="Save the role change before adding new widgets. Existing widgets can still be removed to resolve incompatibilities."
                      title="Unsaved role change"
                      tone="info"
                    />
                  ) : null}

                  <ErpToolbar
                    primary={(
                      <label>
                        Add metric
                        <select disabled={availableMetrics.length === 0 || editRole !== selected.target_role} onChange={(event) => setAddMetricKey(event.target.value as SharedDashboardMetricKey)} value={addMetricKey}>
                          {availableMetrics.length === 0 ? <option value="">All permitted metrics added</option> : null}
                          {availableMetrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
                        </select>
                      </label>
                    )}
                    secondary={<button className="button secondary" disabled={saving || !addMetricKey || editRole !== selected.target_role} onClick={addWidget} type="button">Add widget</button>}
                  />

                  <div className="grid">
                    {widgets.length === 0 ? <p>No metric widgets yet. Add at least one before publishing.</p> : null}
                    {widgets.map((widget, index) => {
                      const definition = sharedDashboardMetricForRole(selected.target_role, widget.metric_key);
                      return (
                        <div className="card" key={widget.id}>
                          <strong>{definition?.label ?? widget.metric_key}</strong>
                          <p>{definition?.helper ?? 'Metric is no longer permitted for this role.'}</p>
                          <div className="action-row">
                            <button className="button secondary" disabled={saving || index === 0} onClick={() => moveWidget(widget, -1)} type="button">Move up</button>
                            <button className="button secondary" disabled={saving || index === widgets.length - 1} onClick={() => moveWidget(widget, 1)} type="button">Move down</button>
                            <button className="button secondary" disabled={saving || (selected.is_published && widgets.length === 1)} onClick={() => removeWidget(widget)} type="button">Remove</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ErpFormSection>
              </div>
            )}
          </ErpPanel>
        </ErpContentGrid>
      ) : null}
    </ErpPage>
  );
}
