import type { ReactNode } from 'react';

type TicketField = {
  label: string;
  value: ReactNode;
};

export type AssetTicketData = {
  id?: string | null;
  machineName?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  barcode?: string | null;
  branch?: string | null;
  status?: string | null;
  condition?: string | null;
  criticality?: string | null;
  custodyStatus?: string | null;
  customerName?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  custodian?: string | null;
  nextAuditAt?: string | null;
  warrantyExpiresAt?: string | null;
};

type AssetTicketCardProps = {
  asset: AssetTicketData;
  eyebrow?: string;
  action?: ReactNode;
  compact?: boolean;
};

function cleanValue(value: ReactNode, fallback = 'Not recorded') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function ticketCode(asset: AssetTicketData) {
  return asset.barcode || asset.serialNumber || asset.id || 'NO-CODE';
}

export function AssetTicketCard({ asset, eyebrow = 'Asset Pass', action, compact = false }: AssetTicketCardProps) {
  const title = asset.machineName || asset.serialNumber || asset.barcode || 'Unnamed asset';
  const subtitle = [asset.model, asset.customerName, asset.branch?.toUpperCase()].filter(Boolean).join(' • ') || 'Machine asset profile';
  const fields: TicketField[] = [
    { label: 'Customer', value: cleanValue(asset.customerName, 'Unassigned') },
    { label: 'Branch', value: cleanValue(asset.branch?.toUpperCase()) },
    { label: 'Serial', value: cleanValue(asset.serialNumber) },
    { label: 'Site', value: cleanValue(asset.siteName, 'No site linked') },
    { label: 'Condition', value: cleanValue(asset.condition) },
    { label: 'Criticality', value: cleanValue(asset.criticality) },
    { label: 'Custody', value: cleanValue(asset.custodyStatus) },
    { label: 'Custodian', value: cleanValue(asset.custodian, 'Available') },
  ];

  return (
    <div className={`asset-ticket-canvas ${compact ? 'is-compact' : ''}`}>
      <div className="asset-ticket-wrapper">
        <article className="asset-ticket" aria-label={`Asset information for ${title}`}>
          <section className="asset-ticket-main">
            <div className="asset-ticket-content">
              <div className="asset-ticket-header">
                <div className="asset-ticket-logo">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                  DALLMAYRERP
                </div>
                <div className="asset-ticket-type">{eyebrow}</div>
              </div>

              <h2 className="asset-ticket-title">{title}</h2>
              <p className="asset-ticket-subtitle">{subtitle}</p>

              <div className="asset-ticket-details">
                {fields.map((field) => (
                  <div className="asset-ticket-detail" key={field.label}>
                    <span className="asset-ticket-label">{field.label}</span>
                    <span className="asset-ticket-value">{field.value}</span>
                  </div>
                ))}
              </div>

              {asset.siteAddress ? <p className="asset-ticket-address">{asset.siteAddress}</p> : null}
            </div>
            <div className="asset-ticket-perforation" aria-hidden="true"><div /></div>
          </section>

          <section className="asset-ticket-stub">
            <div className="asset-ticket-barcode-block">
              <div className="asset-ticket-barcode" aria-hidden="true" />
              <div className="asset-ticket-barcode-id">{ticketCode(asset)}</div>
            </div>
            <div className="asset-ticket-admit">
              <div className="asset-ticket-admit-text">Status</div>
              <div className="asset-ticket-admit-num">{asset.status || 'unknown'}</div>
              <small>Audit: {formatDateTime(asset.nextAuditAt)}</small>
              <small>Warranty: {asset.warrantyExpiresAt ? formatDateTime(asset.warrantyExpiresAt) : 'Not recorded'}</small>
            </div>
          </section>
        </article>
        {action ? <div className="asset-ticket-actions">{action}</div> : null}
      </div>
    </div>
  );
}

export default AssetTicketCard;
