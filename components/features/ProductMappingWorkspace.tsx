'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getMachineButtonPreset } from '@/lib/telemetry/machine-button-presets';
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

type ObservedCode = {
  selectionCode: string;
  deviceCode: string;
  machineLabel: string;
  profileKey: string | null;
  soldTotal: number;
  failedTotal: number;
  lastSeenAt: string;
};

const PAGE_SIZE = 1000;
const DEFAULT_BUTTON_COUNT = 1;
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
      selectionCode: existing?.selection_code?.trim() || '',
      productId: existing?.product_id ?? '',
    };
  });
}

function observedCodesFromRows(rows: UnmappedSelection[]) {
  const byCode = new Map<string, ObservedCode>();

  rows.forEach((row) => {
    const selectionCode = row.selection_code.trim();
    if (!selectionCode) return;
    const key = normalise(selectionCode);
    const next: ObservedCode = {
      selectionCode,
      deviceCode: row.device_code,
      machineLabel: row.machine_name || row.machine_model || 'Unassigned machine',
      profileKey: row.profile_key,
      soldTotal: Number(row.sold_total ?? 0),
      failedTotal: Number(row.failed_total ?? 0),
      lastSeenAt: row.last_seen_at,
    };
    const current = byCode.get(key);
    if (!current || new Date(next.lastSeenAt).getTime() > new Date(current.lastSeenAt).getTime()) {
      byCode.set(key, next);
    }
  });

  return Array.from(byCode.values()).sort((a, b) => (
    new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  ));
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
  const [pendingSelectionCode, setPendingSelectionCode] = useState('');
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

  const selectedPreset = useMemo(() => getMachineButtonPreset(selectedModel), [selectedModel]);
  const observedCodes = useMemo(() => observedCodesFromRows(operational.unmapped_selections), [operational.unmapped_selections]);
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
      const preset = getMachineButtonPreset(model);
      const nextCount = clampButtonCount(Number(profile?.button_count ?? preset?.buttonCount ?? DEFAULT_BUTTON_COUNT));
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
      return current[index] ?? { buttonNumber, selectionCode: '', productId: '' };
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

  function captureObservedSelection(row: UnmappedSelection) {
    setPendingSelectionCode(row.selection_code);
    setNotice(
      `Captured ${row.selection_code}. Choose the correct machine model, then assign it to the physical button that produced it. The detected profile (${row.profile_key || 'none'}) is not changed automatically.`,
    );
  }

  function openDetectedProfile(row: UnmappedSelection) {
    if (!row.profile_key) {
      setError(`Selection ${row.selection_code} has no effective decoder profile yet. Choose the correct machine model manually.`);
      return;
    }
    setSelectedModel(row.profile_key);
    setPendingSelectionCode(row.selection_code);
    setNotice(`Opened detected profile ${row.profile_key} and captured ${row.selection_code}. Verify the physical machine before assigning it.`);
  }

  async function saveMapping() {
    if (!selectedModel) return;
    setError(null);
    setNotice(null);

    const mapped = buttons.filter((row) => row.productId);
    const codes = mapped.map((row) => normalise(row.selectionCode));

    if (mapped.some((row) => !row.selectionCode.trim())) {
      setError('Every mapped product needs the telemetry selection code observed from the machine.');
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
        `Saved ${buttonCount} physical buttons and ${Number(result.mapping_count ?? mapped.length)} product mappings for ${selectedModel}. ${Number(result.refreshed_sales_rows ?? 0)} existing telemetry sales rows were relabelled where the effective profile matched.`,
      );
      setPendingSelectionCode('');
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
        `Copied ${Number(result.mapping_count ?? 0)} mappings from ${copySourceModel} to ${selectedModel}. ${Number(result.refreshed_sales_rows ?? 0)} existing telemetry sales rows were relabelled. Review every physical button before field use.`,
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
    <section className="fleet-route-page" data-product-mapping-workspace="operational-v3">
      <header className="fleet-page-heading">
        <div>
          <h1>Products</h1>
          <p>Map each machine&apos;s physical selections to the raw telemetry codes it actually sends, then assign the Dallmayr product name.</p>
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

      <div className="fleet-banner" role="note">
        <strong>Physical button numbers and MDB codes are separate.</strong>
        <span>An XS Grande has 10 physical selections, but one of those selections can still be reported as MDB-14. Always map the observed telemetry code to the physical button that produced it.</span>
      </div>

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
          <span>Observed raw codes</span>
          <h2>{observedCodes.length}</h2>
          <p>Unique live telemetry codes currently waiting to be assigned.</p>
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
            <div><span>Machine button library</span><h2>Choose machine model</h2></div>
            <span>{modelOptions.length} models</span>
          </header>
          <p>Every machine model in the fleet can have its own physical button count and raw telemetry mapping. Verified models start with their known selection count; other models remain manually configurable.</p>
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
                const preset = getMachineButtonPreset(entry.key);
                const status = stats ? ` · ${stats.mapped_count}/${stats.button_count} mapped` : preset ? ` · ${preset.buttonCount} verified buttons` : '';
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
              <div><dt>Profile status</dt><dd>{selectedProfile ? 'Configured' : selectedPreset ? 'Verified button preset' : 'New mapping'}</dd></div>
              <div><dt>Physical selections</dt><dd>{buttonCount}{selectedPreset ? ' · verified preset' : selectedProfile ? ' · configured' : ' · verify manually'}</dd></div>
              <div><dt>Mapping completeness</dt><dd>{selectedOperational ? `${selectedOperational.mapped_count} / ${selectedOperational.button_count} · ${selectedOperational.completeness_percent}%` : `${mappedButtons} / ${buttonCount}`}</dd></div>
              <div><dt>Active devices using profile</dt><dd>{selectedOperational?.active_device_count ?? 0}</dd></div>
            </dl>
          ) : null}
          {selectedPreset ? (
            <div className="fleet-banner" role="note">
              <strong>{selectedPreset.buttonCount} physical selections</strong>
              <span>{selectedPreset.note}</span>
            </div>
          ) : selectedModel && !selectedProfile ? (
            <div className="fleet-banner" role="note">
              <strong>Button count not yet verified</strong>
              <span>Set the physical selection count from the machine panel/manual before saving. DallmayrERP will not invent MDB codes for those buttons.</span>
            </div>
          ) : null}

          <hr />
          <div>
            <strong>Copy mapping</strong>
            <p>Use a verified compatible profile as a starting point. This replaces the target profile&apos;s button count and mappings, so only copy between genuinely identical button layouts.</p>
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
          <div><span>Live telemetry queue</span><h2>Observed selection codes</h2></div>
          <span>{operational.unmapped_selections.length} observations · {observedCodes.length} unique codes</span>
        </header>
        <p>These are raw codes seen in live vend counters. Capture a code first, then choose the physical machine model and button it belongs to. The currently detected profile is context only and is never trusted blindly.</p>
        {operational.unmapped_selections.length === 0 ? (
          <div className="fleet-empty-state">
            <strong>No observed selections need mapping</strong>
            <p>All currently observed counter selections resolve to configured product mappings, or no live counters have been received yet.</p>
          </div>
        ) : (
          <div className="fleet-table-scroll">
            <table className="fleet-machine-table">
              <thead><tr><th>Machine / device</th><th>Detected profile</th><th>Raw code</th><th>Observed counters</th><th>Last seen</th><th>Action</th></tr></thead>
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
                        <button className="fleet-button" onClick={() => captureObservedSelection(row)} type="button">
                          Capture code
                        </button>
                        <button className="fleet-button secondary" disabled={!row.profile_key} onClick={() => openDetectedProfile(row)} type="button">
                          Open detected profile
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
          <div><span>Physical button map</span><h2>{selectedModel || 'Choose a machine model'}</h2></div>
          <span>{mappedButtons} of {buttonCount} mapped</span>
        </header>

        {!selectedModel ? (
          <div className="fleet-empty-state">
            <strong>Select a machine model</strong>
            <p>Choose a model above to define its physical buttons and the raw telemetry codes those buttons actually produce.</p>
          </div>
        ) : loadingMap ? (
          <HamsterLoader label={`Loading ${selectedModel} mapping`} />
        ) : (
          <>
            {pendingSelectionCode ? (
              <div className="fleet-banner" role="status">
                <strong>Captured code: {pendingSelectionCode}</strong>
                <span>Press “Assign {pendingSelectionCode}” on the physical button that produced it. This is how MDB-14 can correctly map to one of the XS Grande&apos;s 10 buttons.</span>
              </div>
            ) : null}

            <div className="fleet-filters">
              <div>
                <strong>Number of physical selections</strong>
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
                    aria-label="Number of physical buttons"
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
                <p>{selectedPreset ? selectedPreset.note : 'Set this to the actual number of physical or logical drink selections on this machine model.'}</p>
              </div>
              <div>
                <strong>{selectedMachineCount.toLocaleString('en-ZA')} machines · {selectedOperational?.active_device_count ?? 0} active devices</strong>
                <p>Raw MDB identifiers are learned from telemetry. Blank buttons remain blank until a real code is observed or entered.</p>
              </div>
            </div>

            <datalist id="observed-telemetry-selection-codes">
              {observedCodes.map((observed) => (
                <option key={normalise(observed.selectionCode)} value={observed.selectionCode}>
                  {observed.machineLabel} · {observed.deviceCode}
                </option>
              ))}
            </datalist>

            <div className="fleet-table-scroll">
              <table className="fleet-machine-table">
                <thead><tr><th>Physical button</th><th>Observed telemetry code</th><th>Product</th><th>Result</th></tr></thead>
                <tbody>
                  {buttons.map((row) => {
                    const product = products.find((item) => item.id === row.productId);
                    const observed = observedCodes.find((item) => normalise(item.selectionCode) === normalise(row.selectionCode));
                    return (
                      <tr key={row.buttonNumber}>
                        <td><strong>Button {row.buttonNumber}</strong></td>
                        <td>
                          <input
                            aria-label={`Telemetry selection code for physical button ${row.buttonNumber}`}
                            list="observed-telemetry-selection-codes"
                            onChange={(event) => updateButton(row.buttonNumber, { selectionCode: event.target.value })}
                            placeholder="e.g. MDB-14"
                            value={row.selectionCode}
                          />
                          <select
                            aria-label={`Observed telemetry code for physical button ${row.buttonNumber}`}
                            onChange={(event) => {
                              if (event.target.value) updateButton(row.buttonNumber, { selectionCode: event.target.value });
                            }}
                            value=""
                          >
                            <option value="">Use observed code…</option>
                            {observedCodes.map((item) => (
                              <option key={`${row.buttonNumber}:${normalise(item.selectionCode)}`} value={item.selectionCode}>
                                {item.selectionCode} · {item.machineLabel}
                              </option>
                            ))}
                          </select>
                          {pendingSelectionCode ? (
                            <button
                              className="fleet-button secondary"
                              onClick={() => {
                                updateButton(row.buttonNumber, { selectionCode: pendingSelectionCode });
                                setNotice(`Assigned ${pendingSelectionCode} to physical Button ${row.buttonNumber} on ${selectedModel}. Choose the product, then save the model mapping.`);
                                setPendingSelectionCode('');
                              }}
                              type="button"
                            >
                              Assign {pendingSelectionCode}
                            </button>
                          ) : null}
                          {observed ? (
                            <span>Seen on {observed.machineLabel} · {observed.deviceCode} · {formatWhen(observed.lastSeenAt)}</span>
                          ) : row.selectionCode ? (
                            <span>Manual code · verify against live telemetry before fleet use.</span>
                          ) : (
                            <span>No code assigned yet.</span>
                          )}
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
                          {product && row.selectionCode.trim() ? (
                            <>
                              <strong>{product.product_name}</strong>
                              <span>Button {row.buttonNumber} ← {row.selectionCode}{product.is_active ? '' : ' · inactive product'}</span>
                            </>
                          ) : product ? (
                            <span className="fleet-status-pill is-warning"><i />Needs telemetry code</span>
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
                <strong>One physical layout, fleet-wide</strong>
                <span>Selection codes must be unique inside the profile. DallmayrERP never assumes that MDB-N means physical Button N.</span>
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
