export type MachineSelectionMode = 'direct-buttons' | 'touchscreen' | 'accessory' | 'manual';

export type MachineButtonPreset = {
  modelKey: string;
  buttonCount: number;
  controlType: 'direct-buttons' | 'touchscreen';
  note: string;
};

export type MachineSelectionProfile = {
  mode: MachineSelectionMode;
  buttonCount: number | null;
  verified: boolean;
  note: string;
};

const MACHINE_BUTTON_PRESETS: MachineButtonPreset[] = [
  {
    modelKey: 'SIELAFF BELLUNO',
    buttonCount: 14,
    controlType: 'direct-buttons',
    note: 'Verified Belluno direct-selection panel.',
  },
  {
    modelKey: 'SIELAFF BELLUNO PRO',
    buttonCount: 14,
    controlType: 'direct-buttons',
    note: 'Belluno Pro uses the Belluno 14-selection panel.',
  },
  {
    modelKey: 'RHEAVENDORS XS GRANDE E5 PRO',
    buttonCount: 10,
    controlType: 'direct-buttons',
    note: 'Rheavendors XS Grande E5 has 10 direct selections.',
  },
  {
    modelKey: 'RHEAVENDORS XS GRANDE I6 INSTANT',
    buttonCount: 10,
    controlType: 'direct-buttons',
    note: 'Rheavendors XS Grande I6 has 10 direct selections.',
  },
  {
    modelKey: 'RHEAVENDORS XX MICRO',
    buttonCount: 6,
    controlType: 'direct-buttons',
    note: 'Rheavendors XX Micro has six selection buttons.',
  },
  {
    modelKey: 'LARHEA GRANDE E5',
    buttonCount: 12,
    controlType: 'direct-buttons',
    note: 'Rhea laRhea V+ grande E5 configuration has 12 direct selections.',
  },
];

const ACCESSORY_PATTERNS = [
  'MILK COOLER',
  'MILK FRIDGE',
  'MINI COOLER',
  'MINI FRIDGE',
  'WAECO MINI',
  'GRINDER',
  'NAYAX READER',
  'MDB COIN',
  'NOTEREADER',
  'PAYMENT SYSTEM',
  'WATER COOLER',
];

const TOUCHSCREEN_PATTERNS = [
  'DR COFFEE F10',
  'DR COFFEE F11',
  'DR COFFEE F12',
  'DR COFFEE M12',
  'DR COFFEE MINI BAR',
  'VENEZIA F10',
  'VICENZA F11',
  'VERONA F12',
  'ONE TOUCH',
  'PIACENTO TOUCH',
  'JETINNO TOUCH',
  'JL300',
  'JL31D',
];

const MANUAL_ESPRESSO_PATTERNS = [
  '2 GROUP ESPRESSO',
  'ESPRESSO MILAND',
  'AURIELIA 2 GROUP',
  'CARIMALI 2 GROUP',
  'NOUVA SIMONELLI ESPRESSO',
  'NUOVA SIMONELLI APPIA',
  'POUR OVER',
];

function normaliseModel(value: string) {
  return value.trim().toLocaleUpperCase('en-ZA').replace(/\s+/g, ' ');
}

const PRESET_BY_MODEL = new Map(
  MACHINE_BUTTON_PRESETS.map((preset) => [normaliseModel(preset.modelKey), preset]),
);

function containsAny(model: string, patterns: string[]) {
  return patterns.some((pattern) => model.includes(pattern));
}

export function getMachineButtonPreset(modelKey: string | null | undefined) {
  if (!modelKey?.trim()) return null;
  return PRESET_BY_MODEL.get(normaliseModel(modelKey)) ?? null;
}

export function getMachineButtonPresets() {
  return MACHINE_BUTTON_PRESETS.slice();
}

export function getMachineSelectionProfile(modelKey: string | null | undefined): MachineSelectionProfile {
  if (!modelKey?.trim()) {
    return {
      mode: 'manual',
      buttonCount: null,
      verified: false,
      note: 'Machine model is missing. Identify the machine before applying a fleet-wide selection map.',
    };
  }

  const model = normaliseModel(modelKey);
  const preset = PRESET_BY_MODEL.get(model);
  if (preset) {
    return {
      mode: preset.controlType,
      buttonCount: preset.buttonCount,
      verified: true,
      note: preset.note,
    };
  }

  if (containsAny(model, ACCESSORY_PATTERNS)) {
    return {
      mode: 'accessory',
      buttonCount: null,
      verified: true,
      note: 'Accessory asset; no beverage-selection mapping is required.',
    };
  }

  if (containsAny(model, TOUCHSCREEN_PATTERNS)) {
    return {
      mode: 'touchscreen',
      buttonCount: null,
      verified: true,
      note: 'Touchscreen/logical menu. Learn the raw selection codes from telemetry instead of assuming a fixed physical button layout.',
    };
  }

  if (containsAny(model, MANUAL_ESPRESSO_PATTERNS)) {
    return {
      mode: 'manual',
      buttonCount: null,
      verified: true,
      note: 'Manual/semi-automatic equipment. Only create a telemetry selection map if this installation actually emits vend selections.',
    };
  }

  return {
    mode: 'manual',
    buttonCount: null,
    verified: false,
    note: 'Selection layout is not verified yet. Learn codes from telemetry or confirm the physical controls before applying a fleet-wide map.',
  };
}
