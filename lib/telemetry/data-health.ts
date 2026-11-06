/** These inputs require explicit evidence. Device receipt timestamps are not substitutes. */
export type MachineAssignment = { machineId: string | null; assignmentId: string | null };
export type DataHealthState = { key: 'current' | 'stale' | 'overdue' | 'unknown'; label: 'Current' | 'Stale' | 'Overdue' | 'Unknown'; reason: string };
export type MachineCommunicationEvidence = MachineAssignment & {
  observedAt: string;
  expectedIntervalMinutes: number;
  periodicEvidenceReliable: boolean;
};
export type SalesReportEvidence = MachineAssignment & {
  expectedPeriod: string;
  receivedPeriods: string[];
  dueAt: string;
  graceMinutes: number;
};

function sameAssignment(assignment: MachineAssignment, evidence: MachineAssignment) {
  return Boolean(assignment.machineId && assignment.assignmentId && assignment.machineId === evidence.machineId && assignment.assignmentId === evidence.assignmentId);
}

export function machineCommunicationState(assignment: MachineAssignment, evidence: MachineCommunicationEvidence | null, now = Date.now()): DataHealthState {
  if (!evidence || !sameAssignment(assignment, evidence) || !evidence.periodicEvidenceReliable || !Number.isFinite(evidence.expectedIntervalMinutes) || evidence.expectedIntervalMinutes <= 0) {
    return { key: 'unknown', label: 'Unknown', reason: 'Reliable periodic machine communication evidence for this assignment is unavailable. No sales alone does not indicate a fault.' };
  }
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observed) || observed > now) return { key: 'unknown', label: 'Unknown', reason: 'Machine observation time is invalid or in the future.' };
  return now - observed <= evidence.expectedIntervalMinutes * 2 * 60_000
    ? { key: 'current', label: 'Current', reason: 'Valid machine communication was observed within two expected intervals.' }
    : { key: 'stale', label: 'Stale', reason: 'Machine communication evidence is overdue. This does not establish that the machine is broken.' };
}

export function salesReportState(assignment: MachineAssignment, evidence: SalesReportEvidence | null, now = Date.now()): DataHealthState {
  const deadline = evidence ? Date.parse(evidence.dueAt) : NaN;
  if (!evidence || !sameAssignment(assignment, evidence) || !evidence.expectedPeriod || !Number.isFinite(deadline) || !Number.isFinite(evidence.graceMinutes) || evidence.graceMinutes < 0) {
    return { key: 'unknown', label: 'Unknown', reason: 'Reporting deadline or verified report-period coverage is unavailable. An upload does not prove that a sales report is complete.' };
  }
  if (evidence.receivedPeriods.includes(evidence.expectedPeriod)) return { key: 'current', label: 'Current', reason: 'The expected reporting period has been received, including any valid zero-sales report.' };
  return now > deadline + evidence.graceMinutes * 60_000
    ? { key: 'overdue', label: 'Overdue', reason: 'The expected sales report has not arrived by its delivery deadline and grace period.' }
    : { key: 'current', label: 'Current', reason: 'The expected report is still within its delivery deadline and grace period.' };
}

/** Existing device rows have receipt times but no assignment-bound periodic evidence or report coverage. */
export function deviceDataHealth(machineId: string | null) {
  const assignment = { machineId, assignmentId: null };
  return { communication: machineCommunicationState(assignment, null), reporting: salesReportState(assignment, null) };
}
