'use client';

type SignalTransport = 'wifi' | 'cellular' | null | undefined;
type SignalLevel = 'low' | 'medium' | 'high' | 'unknown';

type SignalStrength = {
  bars: 0 | 1 | 2 | 3;
  level: SignalLevel;
  label: string;
  detail: string;
};

type SignalStrengthIndicatorProps = {
  transport: SignalTransport;
  wifiRssi?: number | null;
  cellularCsq?: number | null;
  compact?: boolean;
  className?: string;
};

function classifyWifi(rssi: number | null | undefined): SignalStrength {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi) || rssi >= 0 || rssi < -120) {
    return { bars: 0, level: 'unknown', label: 'Not reported', detail: 'Wi-Fi signal not reported' };
  }
  if (rssi >= -67) return { bars: 3, level: 'high', label: 'High', detail: `${rssi} dBm` };
  if (rssi >= -80) return { bars: 2, level: 'medium', label: 'Medium', detail: `${rssi} dBm` };
  return { bars: 1, level: 'low', label: 'Low', detail: `${rssi} dBm` };
}

function classifyCellular(csq: number | null | undefined): SignalStrength {
  if (csq === null || csq === undefined || !Number.isFinite(csq) || csq === 99 || csq < 0 || csq > 31) {
    return { bars: 0, level: 'unknown', label: 'Not reported', detail: 'Cellular signal not reported' };
  }
  if (csq >= 20) return { bars: 3, level: 'high', label: 'High', detail: `CSQ ${csq}` };
  if (csq >= 10) return { bars: 2, level: 'medium', label: 'Medium', detail: `CSQ ${csq}` };
  return { bars: 1, level: 'low', label: 'Low', detail: `CSQ ${csq}` };
}

export function signalStrengthForTransport(
  transport: SignalTransport,
  wifiRssi?: number | null,
  cellularCsq?: number | null,
): SignalStrength {
  if (transport === 'cellular') return classifyCellular(cellularCsq);
  if (transport === 'wifi') return classifyWifi(wifiRssi);

  const cellular = classifyCellular(cellularCsq);
  if (cellular.level !== 'unknown') return cellular;
  return classifyWifi(wifiRssi);
}

const levelColor: Record<SignalLevel, string> = {
  low: 'var(--color-danger, #b42318)',
  medium: 'var(--color-warning, #b54708)',
  high: 'var(--color-success, #027a48)',
  unknown: 'var(--color-text-muted, #667085)',
};

export function SignalStrengthIndicator({
  transport,
  wifiRssi = null,
  cellularCsq = null,
  compact = false,
  className,
}: SignalStrengthIndicatorProps) {
  const strength = signalStrengthForTransport(transport, wifiRssi, cellularCsq);
  const network = transport === 'cellular' ? 'Cellular' : transport === 'wifi' ? 'Wi-Fi' : 'Network';
  const ariaLabel = strength.level === 'unknown'
    ? `${network} signal not reported`
    : `${network} signal ${strength.label.toLowerCase()}, ${strength.detail}`;

  return (
    <span
      className={className}
      style={{
        alignItems: 'center',
        color: levelColor[strength.level],
        display: 'inline-flex',
        gap: compact ? 6 : 8,
        whiteSpace: 'nowrap',
      }}
      title={ariaLabel}
    >
      <span
        aria-label={ariaLabel}
        role="img"
        style={{ alignItems: 'flex-end', display: 'inline-flex', gap: 2, height: 16 }}
      >
        {[1, 2, 3].map((bar) => (
          <i
            aria-hidden="true"
            key={bar}
            style={{
              background: 'currentColor',
              borderRadius: '2px 2px 0 0',
              display: 'block',
              height: `${4 + bar * 4}px`,
              opacity: strength.bars >= bar ? 1 : 0.18,
              width: 4,
            }}
          />
        ))}
      </span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <strong style={{ fontSize: compact ? 12 : 13, fontWeight: 700 }}>{strength.label}</strong>
        {!compact ? <small style={{ color: 'var(--color-text-muted, #667085)', fontSize: 11 }}>{strength.detail}</small> : null}
      </span>
    </span>
  );
}
