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

type MatchScore = {
  exactRank: number;
  position: number;
  fieldPriority: number;
};

function matchScore(machine: MachineSearchIdentity, value: string): MatchScore {
  const needle = normaliseComparable(value);
  const candidates = [
    machine.id,
    machine.machine_barcode,
    machine.serial_number,
    machine.machine_name,
    machine.model,
  ].map(normaliseComparable);

  const positions = candidates.map((candidate) => candidate.indexOf(needle));
  const matchingPositions = positions.filter((position) => position >= 0);
  const earliestPosition = matchingPositions.length > 0 ? Math.min(...matchingPositions) : Number.POSITIVE_INFINITY;
  const fieldPriority = positions.findIndex((position) => position === earliestPosition);

  return {
    exactRank: candidates.some((candidate) => candidate === needle) ? 0 : 1,
    position: earliestPosition,
    fieldPriority: fieldPriority >= 0 ? fieldPriority : candidates.length,
  };
}

export function rankMachineMatches<T extends MachineSearchIdentity>(machines: T[], value: string) {
  const filtered = machines.filter((machine) => containsMachineTerm(machine, value));

  return [...filtered].sort((left, right) => {
    const leftScore = matchScore(left, value);
    const rightScore = matchScore(right, value);

    if (leftScore.exactRank !== rightScore.exactRank) return leftScore.exactRank - rightScore.exactRank;
    if (leftScore.position !== rightScore.position) return leftScore.position - rightScore.position;
    if (leftScore.fieldPriority !== rightScore.fieldPriority) return leftScore.fieldPriority - rightScore.fieldPriority;

    const leftLabel = left.machine_name ?? left.serial_number ?? left.machine_barcode ?? left.id;
    const rightLabel = right.machine_name ?? right.serial_number ?? right.machine_barcode ?? right.id;
    return leftLabel.localeCompare(rightLabel, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function machineSearchLabel(machine: MachineSearchIdentity) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}
