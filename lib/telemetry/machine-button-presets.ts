export type MachineButtonPreset = {
  modelKey: string;
  buttonCount: number;
  controlType: 'direct-buttons' | 'touchscreen';
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
];

function normaliseModel(value: string) {
  return value.trim().toLocaleUpperCase('en-ZA').replace(/\s+/g, ' ');
}

const PRESET_BY_MODEL = new Map(
  MACHINE_BUTTON_PRESETS.map((preset) => [normaliseModel(preset.modelKey), preset]),
);

export function getMachineButtonPreset(modelKey: string | null | undefined) {
  if (!modelKey?.trim()) return null;
  return PRESET_BY_MODEL.get(normaliseModel(modelKey)) ?? null;
}

export function getMachineButtonPresets() {
  return MACHINE_BUTTON_PRESETS.slice();
}
