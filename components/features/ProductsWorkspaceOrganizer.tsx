'use client';

import { useState } from 'react';
import { FleetMachineSelectionCatalog } from './FleetMachineSelectionCatalog';
import { ProductMappingWorkspace } from './ProductMappingWorkspace';
import { SelectionLearnModePanel } from './SelectionLearnModePanel';
import styles from './ProductsWorkspaceOrganizer.module.css';

type ProductView = 'catalogue' | 'mappings' | 'unmapped' | 'history';

const PRODUCT_VIEWS: Array<{ id: ProductView; label: string; helper: string }> = [
  { id: 'catalogue', label: 'Product Catalogue', helper: 'Names and active products' },
  { id: 'mappings', label: 'Machine Mappings', helper: 'Models, buttons and telemetry codes' },
  { id: 'unmapped', label: 'Unmapped Selections', helper: 'Live codes that need a product' },
  { id: 'history', label: 'Mapping History', helper: 'Audit trail for mapping changes' },
];

export function ProductsWorkspaceOrganizer() {
  const [view, setView] = useState<ProductView>('catalogue');

  return (
    <section className={styles.workspace} data-product-view={view}>
      <nav aria-label="Product workspace sections" className={styles.tabs} role="tablist">
        {PRODUCT_VIEWS.map((item) => (
          <button
            aria-selected={view === item.id}
            className={`${styles.tab} ${view === item.id ? styles.active : ''}`}
            key={item.id}
            onClick={() => setView(item.id)}
            role="tab"
            type="button"
          >
            <strong>{item.label}</strong>
            <span>{item.helper}</span>
          </button>
        ))}
      </nav>

      <div className={styles.context}>
        <strong>{PRODUCT_VIEWS.find((item) => item.id === view)?.label}</strong>
        <span>{PRODUCT_VIEWS.find((item) => item.id === view)?.helper}</span>
      </div>

      {view === 'mappings' ? <FleetMachineSelectionCatalog /> : null}
      {view === 'unmapped' ? <SelectionLearnModePanel /> : null}

      <div className={styles.mappingHost}>
        <ProductMappingWorkspace />
      </div>
    </section>
  );
}
