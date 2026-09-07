'use client';

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

const PAGE_SIZE = 1000;
const DEFAULT_BUTTON_COUNT = 12;

function modelKey(model: string | null, machineName: string | null) {
  return model?.trim() || machineName?.trim() || '';
}

function normalise(value: string) {
  return value.trim().toLocaleLowerCase('en-ZA');
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

function mappingDraft(buttonCount: number, rows: MapRow[]) {
  const byButton = new Map(rows.filter((row) => row.button_number !== null).map((row) => [Number(row.button_number), row]));
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
  const [selectedModel, setSelectedModel] = useState('');
  const [buttonCount, setButtonCount] = useState(DEFAULT_BUTTON_COUNT);
  const [buttons, setButtons] = useState<ButtonDraft[]>(mappingDraft(DEFAULT_BUTTON_COUNT, []));
  const [newProductName, setNewProductName] = useState('');
  const [productDrafts, setProductDrafts] = useState<Record<string, string>>({});
  const [modelSearch, setModelSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMap, setLoadingMap] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    try {
      const [productResult, profileResult, modelCounts] = await Promise.all([
        client.from('products').select('id,product_name,is_active,updated_at').order('product_name'),
        client.from('machine_model_profiles').select('id,model_key,display_name,button_count,updated_at').order('display_name'),
        loadFleetModels(),
      ]);
      if (productResult.error) throw productResult.error;
      if (profileResult.error) throw profileResult.error;
      const nextProducts = (productResult.data ?? []) as ProductRecord[];
      const nextProfiles = (profileResult.data ?? []) as ProfileRecord[];
      setProducts(nextProducts);
      setProfiles(nextProfiles);
      setFleetModels(modelCounts);
      setProductDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, product.product_name])));

      if (!selectedModel) {
        const belluno = Array.from(modelCounts.values()).find((entry) => normalise(entry.key) === 'sielaff belluno');
        const firstProfile = nextProfiles[0]?.model_key;
        const firstFleetModel = Array.from(modelCounts.values()).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0]?.key;
        setSelectedModel(belluno?.key ?? firstProfile ?? firstFleetModel ?? '');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load product mapping data.');
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  useEffect(() => { loadBase().catch(() => undefined); }, [loadBase]);

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
  const selectedMachineCount = fleetModels.get(normalise(selectedModel))?.count ?? 0;

  const loadMap = useCallback(async (model: string) => {
    if (!model) return;
    setLoadingMap(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: mapError } = await getSupabaseClient().rpc('get_machine_model_button_map', { p_model_key: model });
      if (mapError) throw mapError;
      const rows = (data ?? []) as MapRow[];
      const profile = rows[0] ?? profiles.find((item) => normalise(item.model_key) === normalise(model));
      const nextCount = Math.max(1, Math.min(100, Number(profile?.button_count ?? DEFAULT_BUTTON_COUNT)));
      setButtonCount(nextCount);
      setButtons(mappingDraft(nextCount, rows));
    } catch (mapLoadError) {
      setError(mapLoadError instanceof Error ? mapLoadError.message : 'Could not load this machine model mapping.');
    } finally {
      setLoadingMap(false);
    }
  }, [profiles]);

  useEffect(() => { loadMap(selectedModel).catch(() => undefined); }, [loadMap, selectedModel]);

  function changeButtonCount(value: number) {
    const nextCount = Math.max(1, Math.min(100, Number.isFinite(value) ? value : 1));
    setButtonCount(nextCount);
    setButtons((current) => Array.from({ length: nextCount }, (_, index) => {
      const buttonNumber = index + 1;
      return current[index] ?? { buttonNumber, selectionCode: `MDB-${buttonNumber}`, productId: '' };
    }));
  }

  function updateButton(buttonNumber: number, patch: Partial<ButtonDraft>) {
    setButtons((current) => current.map((row) => row.buttonNumber === buttonNumber ? { ...row, ...patch } : row));
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
      setNotice(`Saved ${Number(result.mapping_count ?? mapped.length)} button mappings for ${selectedModel}. ${Number(result.refreshed_sales_rows ?? 0)} existing telemetry sales rows were relabelled.`);
      await loadBase();
      await loadMap(selectedModel);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the machine model mapping.');
    } finally {
      setSavingMap(false);
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
      const { error: updateError } = await getSupabaseClient().from('products').update({ product_name: nextName }).eq('id', product.id);
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
      const { error: updateError } = await getSupabaseClient().from('products').update({ is_active: !product.is_active }).eq('id', product.id);
      if (updateError) throw updateError;
      setNotice(`${product.product_name} is now ${product.is_active ? 'inactive' : 'active'}. Existing mappings are preserved.`);
      await loadBase();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the product status.');
    }
  }

  if (loading) return <HamsterLoader label="Loading products and machine models" />;

  return (
    <section className="fleet-route-page">
      <header className="fleet-page-heading">
        <div>
          <h1>Products</h1>
          <p>Maintain the product catalog and map each machine model&apos;s physical buttons and telemetry selections once for the whole fleet.</p>
        </div>
        <button className="fleet-button secondary" onClick={() => loadBase()} type="button"><NavigationIcon kind="telemetry" />Refresh</button>
      </header>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Product mapping needs attention.</strong><span>{error}</span></div> : null}
      {notice ? <div className="fleet-banner" role="status"><strong>Saved.</strong><span>{notice}</span></div> : null}

      <div className="grid grid-2">
        <section className="fleet-panel">
          <header className="fleet-table-heading"><div><span>Catalog</span><h2>Products</h2></div><span>{products.length} products</span></header>
          <p>Create the names that should appear in vending reports and machine dashboards. A product can be reused across any number of machine models and buttons.</p>
          <form className="fleet-filters" onSubmit={addProduct}>
            <label className="fleet-search"><NavigationIcon kind="search" /><input aria-label="New product name" onChange={(event) => setNewProductName(event.target.value)} placeholder="e.g. Hot Chocolate" value={newProductName} /></label>
            <button className="fleet-button" disabled={savingProduct || !newProductName.trim()} type="submit">{savingProduct ? 'Adding…' : 'Add product'}</button>
          </form>
          {products.length === 0 ? <div className="fleet-empty-state"><strong>No products yet</strong><p>Add your first product, then assign it to machine buttons.</p></div> : <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Product name</th><th>Status</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><input aria-label={`Product name for ${product.product_name}`} onChange={(event) => setProductDrafts((current) => ({ ...current, [product.id]: event.target.value }))} value={productDrafts[product.id] ?? product.product_name} /></td><td><span className={`fleet-status-pill is-${product.is_active ? 'success' : 'neutral'}`}><i />{product.is_active ? 'Active' : 'Inactive'}</span></td><td><div className="fleet-heading-actions"><button className="fleet-button secondary" disabled={!productDrafts[product.id]?.trim() || productDrafts[product.id]?.trim() === product.product_name} onClick={() => renameProduct(product)} type="button">Save name</button><button className="fleet-button secondary" onClick={() => toggleProduct(product)} type="button">{product.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>}
        </section>

        <section className="fleet-panel">
          <header className="fleet-table-heading"><div><span>Fleet model</span><h2>Choose machine model</h2></div><span>{modelOptions.length} models</span></header>
          <p>A mapping applies automatically to every machine whose model exactly matches the selected profile. Similar variants such as Belluno and Belluno Pro remain separate.</p>
          <label><span>Find model</span><input onChange={(event) => setModelSearch(event.target.value)} placeholder="Search Belluno, Dr Coffee, Rhea…" value={modelSearch} /></label>
          <label><span>Machine model</span><select onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}><option value="">Choose model</option>{modelOptions.map((entry) => <option key={normalise(entry.key)} value={entry.key}>{entry.key} · {entry.count} machine{entry.count === 1 ? '' : 's'}{entry.configured ? ' · configured' : ''}</option>)}</select></label>
          {selectedModel ? <dl><div><dt>Selected profile</dt><dd>{selectedModel}</dd></div><div><dt>Affects</dt><dd>{selectedMachineCount.toLocaleString('en-ZA')} current machine{selectedMachineCount === 1 ? '' : 's'}</dd></div><div><dt>Profile status</dt><dd>{selectedProfile ? 'Configured' : 'New mapping'}</dd></div></dl> : null}
        </section>
      </div>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading"><div><span>Button map</span><h2>{selectedModel || 'Choose a machine model'}</h2></div><span>{buttons.filter((row) => row.productId).length} of {buttonCount} mapped</span></header>
        {!selectedModel ? <div className="fleet-empty-state"><strong>Select a machine model</strong><p>Choose a model above to define its physical buttons and telemetry selection codes.</p></div> : loadingMap ? <HamsterLoader label={`Loading ${selectedModel} mapping`} /> : <>
          <div className="fleet-filters"><label><span>Number of buttons</span><input max={100} min={1} onChange={(event) => changeButtonCount(Number(event.target.value))} type="number" value={buttonCount} /></label><div><strong>{selectedMachineCount.toLocaleString('en-ZA')} machines</strong><p>Saving this profile affects all current and future machines with the exact model <strong>{selectedModel}</strong>.</p></div></div>
          <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Button</th><th>Telemetry selection code</th><th>Product</th><th>Result</th></tr></thead><tbody>{buttons.map((row) => {
            const product = products.find((item) => item.id === row.productId);
            return <tr key={row.buttonNumber}><td><strong>Button {row.buttonNumber}</strong></td><td><input aria-label={`Telemetry selection code for button ${row.buttonNumber}`} onChange={(event) => updateButton(row.buttonNumber, { selectionCode: event.target.value })} value={row.selectionCode} /></td><td><select aria-label={`Product for button ${row.buttonNumber}`} onChange={(event) => updateButton(row.buttonNumber, { productId: event.target.value })} value={row.productId}><option value="">Not mapped</option>{products.map((item) => <option key={item.id} value={item.id}>{item.product_name}{item.is_active ? '' : ' (inactive)'}</option>)}</select></td><td>{product ? <><strong>{product.product_name}</strong><span>{row.selectionCode}</span></> : <span>Raw selection only</span>}</td></tr>;
          })}</tbody></table></div>
          <footer className="fleet-table-footer"><div className="fleet-table-footer-copy"><strong>One profile, fleet-wide</strong><span>Selection codes remain visible for diagnostics even after the product name is applied.</span></div><button className="fleet-button" disabled={savingMap} onClick={saveMapping} type="button">{savingMap ? 'Saving mapping…' : 'Save model mapping'}</button></footer>
        </>}
      </section>
    </section>
  );
}
