export type MachineSearchIdentity = {
  id: string;
  machine_barcode?: string | null;
  serial_number?: string | null;
  machine_name?: string | null;
  model?: string | null;
};

export function normaliseLookupTerm(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normaliseComparable(value: string | null | undefined) {
  return normaliseLookupTerm(value ?? '').toLowerCase();
}

export function containsMachineTerm(machine: MachineSearchIdentity, value: string) {
  const needle = normaliseComparable(value);
  if (!needle) return false;

  return [machine.id, machine.machine_barcode, machine.serial_number, machine.machine_name, machine.model]
    .some((candidate) => normaliseComparable(candidate).includes(needle));
}

export function isExactMachineMatch(machine: MachineSearchIdentity, value: string) {
  const needle = normaliseComparable(value);
  if (!needle) return false;

  return [machine.id, machine.machine_barcode, machine.serial_number]
    .some((candidate) => normaliseComparable(candidate) === needle);
}

function matchRank(machine: MachineSearchIdentity, value: string) {
  const needle = normaliseComparable(value);
  const identifiers = [machine.id, machine.machine_barcode, machine.serial_number].map(normaliseComparable);
  const descriptions = [machine.machine_name, machine.model].map(normaliseComparable);

  if (identifiers.some((candidate) => candidate === needle)) return 0;
  if (identifiers.some((candidate) => candidate.startsWith(needle))) return 1;
  if (identifiers.some((candidate) => candidate.includes(needle))) return 2;
  if (descriptions.some((candidate) => candidate.startsWith(needle))) return 3;
  if (descriptions.some((candidate) => candidate.includes(needle))) return 4;
  return 5;
}

export function rankMachineMatches<T extends MachineSearchIdentity>(machines: T[], value: string) {
  const filtered = machines.filter((machine) => containsMachineTerm(machine, value));

  return [...filtered].sort((left, right) => {
    const rankDifference = matchRank(left, value) - matchRank(right, value);
    if (rankDifference !== 0) return rankDifference;

    const leftLabel = left.machine_name ?? left.serial_number ?? left.machine_barcode ?? left.id;
    const rightLabel = right.machine_name ?? right.serial_number ?? right.machine_barcode ?? right.id;
    return leftLabel.localeCompare(rightLabel, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function machineSearchLabel(machine: MachineSearchIdentity) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}
