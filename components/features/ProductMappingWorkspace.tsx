'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';

type ProductRecord = {
  id: string;
  product_name: string;
  is_active: boolean;
  updated_at: string;
};

type ProfileRecord = {
  id: string;
  model_key: string;
  display_name: string;
  button_count: number;
  updated_at: string;
};

type MapRow = {
  profile_id: string;
  model_key: string;
  display_name: string;
  button_count: number;
  button_number: number | null;
  selection_code: string | null;
  product_id: string | null;
  product_name: string | null;
  product_active: boolean | null;
};

type ButtonDraft = {
  buttonNumber: number;
  selectionCode: string;
  productId: string;
};

type FleetModel = {
  key: string;
  count: number;
  configured: boolean;
};

type OperationalProfile = {
  id: string;
  model_key: string;
  display_name: string;
  button_count: number;
  mapped_count: number;
  unmapped_count: number;
  completeness_percent: number;
  inactive_product_count: number;
  machine_count: number;
  active_device_count: number;
  updated_at: string;
};

type UnmappedSelection = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  machine_model: string | null;
  profile_key: string | null;
  selection_code: string;
  sold_total: number;
  failed_total: number;
  last_seen_at: string;
};

type OperationalSummary = {
  profiles: OperationalProfile[];
  unmapped_selections: UnmappedSelection[];
};

type HistoryRow = {
  id: number;
  model_key: string;
  event_type: string;
  button_number: number | null;
  selection_code: string | null;
  product_name: string | null;
  source_model_key: string | null;
  changed_at: string;
};

const PAGE_SIZE = 1000;
const DEFAULT_BUTTON_COUNT = 12;
const MIN_BUTTON_COUNT = 1;
const MAX_BUTTON_COUNT = 100;

function modelKey(model: string | null, machineName: string | null) {
  return model?.trim() || machineName?.trim() || '';
}

function normalise(value: string) {
  return value.trim().toLocaleLowerCase('en-ZA');
}

function formatWhen(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function historyLabel(eventType: string) {
  switch (eventType) {
    case 'baseline': return 'Existing mapping';
    case 'map_insert': return 'Mapping added';
    case 'map_update': return 'Mapping changed';
    case 'map_delete': return 'Mapping removed';
    case 'copy': return 'Profile copied';
    default: return eventType.replaceAll('_', ' ');
  }
}

async function loadFleetModels() {
  const client = getSupabaseClient();
  const counts = new Map<string, { key: string; count: number }>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('machines')
      .select('model,machine_name')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as Array<{ model: string | null; machine_name: string | null }>;
    page.forEach((machine) => {
      const key = modelKey(machine.model, machine.machine_name);
      if (!key) return;
      const lookup = normalise(key);
      const existing = counts.get(lookup);
      counts.set(lookup, { key: existing?.key ?? key, count: (existing?.count ?? 0) + 1 });
    });

    if (page.length < PAGE_SIZE) break;
  }

  return counts;
}

function clampButtonCount(value: number) {
  if (!Number.isFinite(value)) return MIN_BUTTON_COUNT;
  return Math.max(MIN_BUTTON_COUNT, Math.min(MAX_BUTTON_COUNT, Math.trunc(value)));
}

function mappingDraft(buttonCount: number, rows: MapRow[]) {
  const byButton = new Map(
    rows
      .filter((row) => row.button_number !== null)
      .map((row) => [Number(row.button_number), row]),
  );

  return Array.from({ length: buttonCount }, (_, index): ButtonDraft => {
    const buttonNumber = index + 1;
    const existing = byButton.get(buttonNumber);
    return {
      buttonNumber,
      selectionCode: existing?.selection_code?.trim() || `MDB-${buttonNumber}`,
      productId: existing?.product_id ?? '',
    };
  });
}

export function ProductMappingWorkspace() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [fleetModels, setFleetModels] = useState<Map<string, { key: string; count: number }>>(new Map());
  const [operational, setOperational] = useState<OperationalSummary>({ profiles: [], unmapped_selections: [] });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [buttonCount, setButtonCount] = useState(DEFAULT_BUTTON_COUNT);
  const [buttons, setButtons] = useState<ButtonDraft[]>(mappingDraft(DEFAULT_BUTTON_COUNT, []));
  const [newProductName, setNewProductName] = useState('');
  const [productDrafts, setProductDrafts] = useState<Record<string, string>>({});
  const [modelSearch, setModelSearch] = useState('');
  const [copySourceModel, setCopySourceModel] = useState('');
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMap, setLoadingMap] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [copyingMap, setCopyingMap] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    try {
      const [productResult, profileResult, modelCounts, operationalResult] = await Promise.all([
        client.from('products').select('id,product_name,is_active,updated_at').order('product_name'),
        client.from('machine_model_profiles').select('id,model_key,display_name,button_count,updated_at').order('display_name'),
        loadFleetModels(),
        client.rpc('get_product_mapping_operational_summary'),
      ]);

      if (productResult.error) throw productResult.error;
      if (profileResult.error) throw profileResult.error;
      if (operationalResult.error) throw operationalResult.error;

      const nextProducts = (productResult.data ?? []) as ProductRecord[];
      const nextProfiles = (profileResult.data ?? []) as ProfileRecord[];
      const nextOperational = (operationalResult.data ?? {}) as Partial<OperationalSummary>;
      setProducts(nextProducts);
      setProfiles(nextProfiles);
      setFleetModels(modelCounts);
      setOperational({
        profiles: Array.isArray(nextOperational.profiles) ? nextOperational.profiles : [],
        unmapped_selections: Array.isArray(nextOperational.unmapped_selections) ? nextOperational.unmapped_selections : [],
      });
      setProductDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, product.product_name])));

      setSelectedModel((current) => {
        if (current) return current;
        const firstAttentionProfile = (nextOperational.profiles ?? [])
          .find((profile) => profile.unmapped_count > 0 || profile.inactive_product_count > 0)?.model_key;
        const belluno = Array.from(modelCounts.values()).find((entry) => normalise(entry.key) === 'sielaff belluno');
        const firstProfile = nextProfiles[0]?.model_key;
        const firstFleetModel = Array.from(modelCounts.values())
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0]?.key;
        return firstAttentionProfile ?? belluno?.key ?? firstProfile ?? firstFleetModel ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load product mapping data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBase().catch(() => undefined);
  }, [loadBase]);

  const modelOptions = useMemo<FleetModel[]>(() => {
    const combined = new Map<string, FleetModel>();
    fleetModels.forEach((entry, key) => combined.set(key, { key: entry.key, count: entry.count, configured: false }));
    profiles.forEach((profile) => {
      const key = normalise(profile.model_key);
      const existing = combined.get(key);
      combined.set(key, { key: profile.model_key, count: existing?.count ?? 0, configured: true });
    });

    const term = normalise(modelSearch);
    return Array.from(combined.values())
      .filter((entry) => !term || normalise(entry.key).includes(term))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [fleetModels, modelSearch, profiles]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => normalise(profile.model_key) === normalise(selectedModel)) ?? null,
    [profiles, selectedModel],
  );

  const selectedOperational = useMemo(
    () => operational.profiles.find((profile) => normalise(profile.model_key) === normalise(selectedModel)) ?? null,
    [operational.profiles, selectedModel],
  );

  const selectedMachineCount = fleetModels.get(normalise(selectedModel))?.count ?? selectedOperational?.machine_count ?? 0;
  const configuredProfiles = operational.profiles.length;
  const completeProfiles = operational.profiles.filter((profile) => profile.unmapped_count === 0 && profile.inactive_product_count === 0).length;
  const attentionProfiles = operational.profiles.filter((profile) => profile.unmapped_count > 0 || profile.inactive_product_count > 0).length;
  const mappedButtons = buttons.filter((row) => row.productId).length;

  const loadMap = useCallback(async (model: string) => {
    if (!model) return;
    setLoadingMap(true);
    setError(null);

    try {
      const { data, error: mapError } = await getSupabaseClient().rpc('get_machine_model_button_map', {
        p_model_key: model,
      });
      if (mapError) throw mapError;

      const rows = (data ?? []) as MapRow[];
      const profile = rows[0] ?? profiles.find((item) => normalise(item.model_key) === normalise(model));
      const nextCount = clampButtonCount(Number(profile?.button_count ?? DEFAULT_BUTTON_COUNT));
      setButtonCount(nextCount);
      setButtons(mappingDraft(nextCount, rows));
    } catch (mapLoadError) {
      setError(mapLoadError instanceof Error ? mapLoadError.message : 'Could not load this machine model mapping.');
    } finally {
      setLoadingMap(false);
    }
  }, [profiles]);

  const loadHistory = useCallback(async (model: string) => {
    if (!model) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const { data, error: historyError } = await getSupabaseClient().rpc('get_product_mapping_history', {
        p_model_key: model,
        p_limit: 40,
      });
      if (historyError) throw historyError;
      setHistory((data ?? []) as HistoryRow[]);
    } catch (historyLoadError) {
      setError(historyLoadError instanceof Error ? historyLoadError.message : 'Could not load mapping history.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    loadMap(selectedModel).catch(() => undefined);
    loadHistory(selectedModel).catch(() => undefined);
    setCopyConfirmed(false);
  }, [loadHistory, loadMap, selectedModel]);

  function changeButtonCount(value: number) {
    const nextCount = clampButtonCount(value);
    setButtonCount(nextCount);
    setButtons((current) => Array.from({ length: nextCount }, (_, index) => {
      const buttonNumber = index + 1;
      return current[index] ?? { buttonNumber, selectionCode: `MDB-${buttonNumber}`, productId: '' };
    }));
  }

  function addButton() {
    if (buttonCount >= MAX_BUTTON_COUNT) return;
    changeButtonCount(buttonCount + 1);
  }

  function removeButton() {
    if (buttonCount <= MIN_BUTTON_COUNT) return;
    changeButtonCount(buttonCount - 1);
  }

  function updateButton(buttonNumber: number, patch: Partial<ButtonDraft>) {
    setButtons((current) => current.map((row) => (
      row.buttonNumber === buttonNumber ? { ...row, ...patch } : row
    )));
  }

  function openUnmappedProfile(row: UnmappedSelection) {
    if (!row.profile_key) {
      setError(`Selection ${row.selection_code} has no effective decoder profile yet. Assign or detect a profile on the machine first.`);
      return;
    }
    setSelectedModel(row.profile_key);
    setNotice(`Opened ${row.profile_key}. Map observed telemetry selection ${row.selection_code} to the correct physical button and product.`);
  }

  async function saveMapping() {
    if (!selectedModel) return;
    setError(null);
    setNotice(null);

    const mapped = buttons.filter((row) => row.productId);
    const codes = mapped.map((row) => normalise(row.selectionCode));

    if (mapped.some((row) => !row.selectionCode.trim())) {
      setError('Every mapped button needs a telemetry selection code.');
      return;
    }

    if (new Set(codes).size !== codes.length) {
      setError('A telemetry selection code can only be mapped once within the same machine model.');
      return;
    }

    setSavingMap(true);
    try {
      const { data, error: saveError } = await getSupabaseClient().rpc('save_machine_model_button_map', {
        p_model_key: selectedModel,
        p_display_name: selectedModel,
        p_button_count: buttonCount,
        p_mappings: mapped.map((row) => ({
          button_number: row.buttonNumber,
          selection_code: row.selectionCode.trim(),
          product_id: row.productId,
        })),
      });
      if (saveError) throw saveError;

      const result = (data ?? {}) as { mapping_count?: number; refreshed_sales_rows?: number };
      setNotice(
        `Saved ${buttonCount} buttons and ${Number(result.mapping_count ?? mapped.length)} product mappings for ${selectedModel}. ${Number(result.refreshed_sales_rows ?? 0)} existing telemetry sales rows were relabelled.`,
      );
      await loadBase();
      await loadMap(selectedModel);
      await loadHistory(selectedModel);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the machine model mapping.');
    } finally {
      setSavingMap(false);
    }
  }

  async function copyMapping() {
    if (!selectedModel || !copySourceModel || !copyConfirmed) return;
    setError(null);
    setNotice(null);
    setCopyingMap(true);

    try {
      const { data, error: copyError } = await getSupabaseClient().rpc('copy_machine_model_profile_mappings', {
        p_source_model_key: copySourceModel,
        p_target_model_key: selectedModel,
      });
      if (copyError) throw copyError;
      const result = (data ?? {}) as { mapping_count?: number; refreshed_sales_rows?: number };
      setNotice(
        `Copied ${Number(result.mapping_count ?? 0)} mappings from ${copySourceModel} to ${selectedModel}. ${Number(result.refreshed_sales_rows ?? 0)} existing telemetry sales rows were relabelled. Review the target before using it on a different machine variant.`,
      );
      setCopyConfirmed(false);
      await loadBase();
      await loadMap(selectedModel);
      await loadHistory(selectedModel);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Could not copy the profile mapping.');
    } finally {
      setCopyingMap(false);
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProductName.trim();
    if (!name) return;

    setSavingProduct(true);
    setError(null);
    setNotice(null);

    try {
      const { error: insertError } = await getSupabaseClient().from('products').insert({ product_name: name });
      if (insertError) throw insertError;
      setNewProductName('');
      setNotice(`Added ${name} to the product catalog.`);
      await loadBase();
    } catch (productError) {
      setError(productError instanceof Error ? productError.message : 'Could not add the product.');
    } finally {
      setSavingProduct(false);
    }
  }

  async function renameProduct(product: ProductRecord) {
    const nextName = (productDrafts[product.id] ?? '').trim();
    if (!nextName || nextName === product.product_name) return;

    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await getSupabaseClient()
        .from('products')
        .update({ product_name: nextName })
        .eq('id', product.id);
      if (updateError) throw updateError;
      setNotice(`Renamed ${product.product_name} to ${nextName}. Existing mapped telemetry labels were refreshed.`);
      await loadBase();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Could not rename the product.');
    }
  }

  async function toggleProduct(product: ProductRecord) {
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await getSupabaseClient()
        .from('products')
        .update({ is_active: !product.is_active })
        .eq('id', product.id);
      if (updateError) throw updateError;
      setNotice(`${product.product_name} is now ${product.is_active ? 'inactive' : 'active'}. Existing mappings are preserved.`);
      await loadBase();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the product status.');
    }
  }

  if (loading) return <HamsterLoader label="Loading products and machine models" />;

  return (
    <section className="fleet-route-page" data-product-mapping-workspace="operational-v2">
      <header className="fleet-page-heading">
        <div>
          <h1>Products</h1>
          <p>Maintain the product catalog, map machine selections once per decoder profile, and surface live telemetry selections that still need mapping.</p>
        </div>
        <button className="fleet-button secondary" onClick={() => loadBase()} type="button">
          <NavigationIcon kind="telemetry" />
          Refresh
        </button>
      </header>

      {error ? (
        <div className="fleet-banner is-error" role="alert">
          <strong>Product mapping needs attention.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {notice ? (
        <div className="fleet-banner" role="status">
          <strong>Updated.</strong>
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="grid grid-4">
        <section className="fleet-panel">
          <span>Mapping completeness</span>
          <h2>{completeProfiles} / {configuredProfiles}</h2>
          <p>Configured profiles with every button mapped to an active product.</p>
        </section>
        <section className="fleet-panel">
          <span>Needs mapping</span>
          <h2>{attentionProfiles}</h2>
          <p>Profiles with open button slots or inactive mapped products.</p>
        </section>
        <section className="fleet-panel">
          <span>Unmapped selections</span>
          <h2>{operational.unmapped_selections.length}</h2>
          <p>Observed live counter selections that do not currently resolve to a product.</p>
        </section>
        <section className="fleet-panel">
          <span>Product catalog</span>
          <h2>{products.length}</h2>
          <p>{products.filter((product) => product.is_active).length} active products available for mapping.</p>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="fleet-panel">
          <header className="fleet-table-heading">
            <div><span>Catalog</span><h2>Products</h2></div>
            <span>{products.length} products</span>
          </header>
          <p>Create the names that should appear in vending reports and machine dashboards. A product can be reused across any number of machine models and buttons.</p>
          <form className="fleet-filters" onSubmit={addProduct}>
            <label className="fleet-search">
              <NavigationIcon kind="search" />
              <input
                aria-label="New product name"
                onChange={(event) => setNewProductName(event.target.value)}
                placeholder="e.g. Hot Chocolate"
                value={newProductName}
              />
            </label>
            <button className="fleet-button" disabled={savingProduct || !newProductName.trim()} type="submit">
              {savingProduct ? 'Adding…' : 'Add product'}
            </button>
          </form>

          {products.length === 0 ? (
            <div className="fleet-empty-state">
              <strong>No products yet</strong>
              <p>Add your first product, then assign it to machine buttons.</p>
            </div>
          ) : (
            <div className="fleet-table-scroll">
              <table className="fleet-machine-table">
                <thead><tr><th>Product name</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <input
                          aria-label={`Product name for ${product.product_name}`}
                          onChange={(event) => setProductDrafts((current) => ({ ...current, [product.id]: event.target.value }))}
                          value={productDrafts[product.id] ?? product.product_name}
                        />
                      </td>
                      <td>
                        <span className={`fleet-status-pill is-${product.is_active ? 'success' : 'neutral'}`}>
                          <i />
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="fleet-heading-actions">
                          <button
                            className="fleet-button secondary"
                            disabled={!productDrafts[product.id]?.trim() || productDrafts[product.id]?.trim() === product.product_name}
                            onClick={() => renameProduct(product)}
                            type="button"
                          >
                            Save name
                          </button>
                          <button className="fleet-button secondary" onClick={() => toggleProduct(product)} type="button">
                            {product.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="fleet-panel">
          <header className="fleet-table-heading">
            <div><span>Decoder profile</span><h2>Choose machine model</h2></div>
            <span>{modelOptions.length} models</span>
          </header>
          <p>A mapping applies to machines using this effective decoder profile. Automatic identification and manual profile assignment both resolve into the same product map.</p>
          <label>
            <span>Find model</span>
            <input
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Search Belluno, Dr Coffee, Rhea…"
              value={modelSearch}
            />
          </label>
          <label>
            <span>Machine model</span>
            <select onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}>
              <option value="">Choose model</option>
              {modelOptions.map((entry) => {
                const stats = operational.profiles.find((profile) => normalise(profile.model_key) === normalise(entry.key));
                const status = stats ? ` · ${stats.mapped_count}/${stats.button_count} mapped` : '';
                return (
                  <option key={normalise(entry.key)} value={entry.key}>
                    {entry.key} · {entry.count} machine{entry.count === 1 ? '' : 's'}{entry.configured ? ' · configured' : ''}{status}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedModel ? (
            <dl>
              <div><dt>Selected profile</dt><dd>{selectedModel}</dd></div>
              <div><dt>Affects</dt><dd>{selectedMachineCount.toLocaleString('en-ZA')} current machine{selectedMachineCount === 1 ? '' : 's'}</dd></div>
              <div><dt>Profile status</dt><dd>{selectedProfile ? 'Configured' : 'New mapping'}</dd></div>
              <div><dt>Mapping completeness</dt><dd>{selectedOperational ? `${selectedOperational.mapped_count} / ${selectedOperational.button_count} · ${selectedOperational.completeness_percent}%` : `${mappedButtons} / ${buttonCount}`}</dd></div>
              <div><dt>Active devices using profile</dt><dd>{selectedOperational?.active_device_count ?? 0}</dd></div>
              <div><dt>Attention</dt><dd>{selectedOperational && (selectedOperational.unmapped_count > 0 || selectedOperational.inactive_product_count > 0) ? 'Needs mapping' : selectedProfile ? 'Complete' : 'Needs mapping'}</dd></div>
            </dl>
          ) : null}

          <hr />
          <div>
            <strong>Copy mapping</strong>
            <p>Use a verified compatible profile as a starting point. This replaces the target profile&apos;s button count and mappings, so review the target before saving it for field use.</p>
            <label>
              <span>Copy from profile</span>
              <select onChange={(event) => { setCopySourceModel(event.target.value); setCopyConfirmed(false); }} value={copySourceModel}>
                <option value="">Choose source profile</option>
                {operational.profiles
                  .filter((profile) => normalise(profile.model_key) !== normalise(selectedModel) && profile.mapped_count > 0)
                  .map((profile) => (
                    <option key={profile.id} value={profile.model_key}>
                      {profile.display_name} · {profile.mapped_count}/{profile.button_count} mapped
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <input
                checked={copyConfirmed}
                disabled={!copySourceModel || !selectedModel}
                onChange={(event) => setCopyConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>I understand this replaces the current target mapping.</span>
            </label>
            <button
              className="fleet-button secondary"
              disabled={!selectedModel || !copySourceModel || !copyConfirmed || copyingMap}
              onClick={copyMapping}
              type="button"
            >
              {copyingMap ? 'Copying mapping…' : 'Copy mapping to selected profile'}
            </button>
          </div>
        </section>
      </div>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading">
          <div><span>Live telemetry queue</span><h2>Unmapped selections</h2></div>
          <span>{operational.unmapped_selections.length} observed</span>
        </header>
        <p>These selection codes have real sold or failed counter activity but no matching product in their effective profile. They are never silently relabelled.</p>
        {operational.unmapped_selections.length === 0 ? (
          <div className="fleet-empty-state">
            <strong>No observed selections need mapping</strong>
            <p>All currently observed counter selections resolve to configured product mappings, or no live counters have been received yet.</p>
          </div>
        ) : (
          <div className="fleet-table-scroll">
            <table className="fleet-machine-table">
              <thead><tr><th>Machine / device</th><th>Effective profile</th><th>Selection</th><th>Observed counters</th><th>Last seen</th><th>Action</th></tr></thead>
              <tbody>
                {operational.unmapped_selections.map((row) => (
                  <tr key={`${row.device_id}:${row.selection_code}`}>
                    <td>
                      <strong>{row.machine_name || row.machine_model || 'Unassigned machine'}</strong>
                      <span>{row.device_code}</span>
                    </td>
                    <td>{row.profile_key || <span className="fleet-status-pill is-warning"><i />Needs profile</span>}</td>
                    <td><strong>{row.selection_code}</strong></td>
                    <td><strong>{Number(row.sold_total ?? 0).toLocaleString('en-ZA')} sold</strong><span>{Number(row.failed_total ?? 0).toLocaleString('en-ZA')} failed</span></td>
                    <td>{formatWhen(row.last_seen_at)}</td>
                    <td>
                      <div className="fleet-heading-actions">
                        <button className="fleet-button secondary" onClick={() => openUnmappedProfile(row)} type="button">
                          Open profile
                        </button>
                        {row.machine_id ? <Link className="fleet-button secondary" href={`/machines/${row.machine_id}`}>Machine</Link> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading">
          <div><span>Button map</span><h2>{selectedModel || 'Choose a machine model'}</h2></div>
          <span>{mappedButtons} of {buttonCount} mapped</span>
        </header>

        {!selectedModel ? (
          <div className="fleet-empty-state">
            <strong>Select a machine model</strong>
            <p>Choose a model above to define its physical buttons and telemetry selection codes.</p>
          </div>
        ) : loadingMap ? (
          <HamsterLoader label={`Loading ${selectedModel} mapping`} />
        ) : (
          <>
            <div className="fleet-filters">
              <div>
                <strong>Number of buttons</strong>
                <div className="fleet-heading-actions">
                  <button
                    aria-label={`Remove button ${buttonCount}`}
                    className="fleet-button secondary"
                    disabled={buttonCount <= MIN_BUTTON_COUNT}
                    onClick={removeButton}
                    type="button"
                  >
                    Remove button
                  </button>
                  <input
                    aria-label="Number of buttons"
                    max={MAX_BUTTON_COUNT}
                    min={MIN_BUTTON_COUNT}
                    onChange={(event) => changeButtonCount(Number(event.target.value))}
                    type="number"
                    value={buttonCount}
                  />
                  <button
                    aria-label={`Add button ${buttonCount + 1}`}
                    className="fleet-button secondary"
                    disabled={buttonCount >= MAX_BUTTON_COUNT}
                    onClick={addButton}
                    type="button"
                  >
                    Add button
                  </button>
                </div>
                <p>Add or remove buttons to match this exact machine model. Changes take effect fleet-wide when you save the profile mapping.</p>
              </div>
              <div>
                <strong>{selectedMachineCount.toLocaleString('en-ZA')} machines · {selectedOperational?.active_device_count ?? 0} active devices</strong>
                <p>The machine dashboard resolves cup counters through this effective profile rather than inventing labels for unknown selections.</p>
              </div>
            </div>

            <div className="fleet-table-scroll">
              <table className="fleet-machine-table">
                <thead><tr><th>Button</th><th>Telemetry selection code</th><th>Product</th><th>Result</th></tr></thead>
                <tbody>
                  {buttons.map((row) => {
                    const product = products.find((item) => item.id === row.productId);
                    return (
                      <tr key={row.buttonNumber}>
                        <td><strong>Button {row.buttonNumber}</strong></td>
                        <td>
                          <input
                            aria-label={`Telemetry selection code for button ${row.buttonNumber}`}
                            onChange={(event) => updateButton(row.buttonNumber, { selectionCode: event.target.value })}
                            value={row.selectionCode}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Product for button ${row.buttonNumber}`}
                            onChange={(event) => updateButton(row.buttonNumber, { productId: event.target.value })}
                            value={row.productId}
                          >
                            <option value="">Not mapped</option>
                            {products.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.product_name}{item.is_active ? '' : ' (inactive)'}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {product ? (
                            <>
                              <strong>{product.product_name}</strong>
                              <span>{row.selectionCode}{product.is_active ? '' : ' · inactive product'}</span>
                            </>
                          ) : (
                            <span className="fleet-status-pill is-warning"><i />Needs mapping</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="fleet-table-footer">
              <div className="fleet-table-footer-copy">
                <strong>One decoder profile, fleet-wide</strong>
                <span>Selection codes must be unique inside the profile. Removing buttons removes mappings above the new count when the profile is saved.</span>
              </div>
              <button className="fleet-button" disabled={savingMap} onClick={saveMapping} type="button">
                {savingMap ? 'Saving mapping…' : 'Save model mapping'}
              </button>
            </footer>
          </>
        )}
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading">
          <div><span>Audit trail</span><h2>Mapping history</h2></div>
          <span>{selectedModel || 'Choose a profile'}</span>
        </header>
        <p>Mapping inserts, removals, replacements and profile copies are recorded separately from telemetry so product-label changes remain traceable.</p>
        {!selectedModel ? (
          <div className="fleet-empty-state"><strong>Select a profile</strong><p>Choose a machine model to review its mapping history.</p></div>
        ) : loadingHistory ? (
          <HamsterLoader label={`Loading ${selectedModel} mapping history`} />
        ) : history.length === 0 ? (
          <div className="fleet-empty-state"><strong>No mapping history yet</strong><p>The first saved or copied mapping will appear here.</p></div>
        ) : (
          <div className="fleet-table-scroll">
            <table className="fleet-machine-table">
              <thead><tr><th>When</th><th>Change</th><th>Button</th><th>Selection</th><th>Product / source</th></tr></thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.changed_at)}</td>
                    <td><strong>{historyLabel(row.event_type)}</strong></td>
                    <td>{row.button_number ? `Button ${row.button_number}` : 'Profile'}</td>
                    <td>{row.selection_code || '—'}</td>
                    <td>{row.event_type === 'copy' ? `Copied from ${row.source_model_key || 'profile'}` : row.product_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
