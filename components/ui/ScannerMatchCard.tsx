import { StatusBadge } from '@/components/ui/StatusBadge';

export function ScannerMatchCard({
  title,
  barcode,
  unit,
  availableItems,
  availableBoxes,
  location,
}: {
  title: string;
  barcode: string;
  unit: 'item' | 'box' | string;
  availableItems?: number | null;
  availableBoxes?: number | null;
  location?: string | null;
}) {
  return (
    <div className="scanner-match-card" role="status">
      <div>
        <span className="minimal-kicker">Matched</span>
        <h3>{title}</h3>
        <p>{barcode || 'Barcode not recorded'}</p>
      </div>
      <div className="scanner-match-facts">
        <StatusBadge value={unit} label={unit === 'box' ? 'Box barcode' : unit === 'item' ? 'Item barcode' : unit} />
        {typeof availableItems === 'number' ? <span><strong>{availableItems}</strong> items</span> : null}
        {typeof availableBoxes === 'number' ? <span><strong>{availableBoxes}</strong> boxes</span> : null}
        {location ? <span>{location}</span> : null}
      </div>
    </div>
  );
}
