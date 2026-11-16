# ADR 0001: Separate telemetry health signals

Status: Accepted for this illustrative design on 6 November 2026.

## Context
A device may send heartbeats while machine communication stops or a sales report is missing. A quiet machine may have no sales without having a fault. Buffered uploads may arrive long after the observations they contain. One overall online indicator would conceal these differences.

## Decision
Represent device connectivity, machine communication freshness, and sales report freshness independently. Preserve both receipt time and observation/report period information. A new upload establishes device contact but does not make old machine observations current. Historical reports can fill their own reporting gaps.

Each warning clears only when its underlying condition recovers. Missing evidence is Unknown rather than a claim of failure. No recent sales alone never establishes a machine fault.

## Alternatives
- One overall online flag: simpler, but hides missing machine information and overdue reports.
- Infer machine faults from sales inactivity: requires less evidence, but misclassifies quiet machines.
- Treat receipt time as observation time: simplifies timestamps, but buffered uploads falsely imply current machine communication.

## Consequences
Independent evidence, timestamps, and reporting expectations must be retained. The interface needs separate indicators and explanations. This increases model and display complexity but allows staff to distinguish connectivity, communication, and reporting problems. Changing these meanings later would affect historical interpretation and dependent workflows.

## Agreed example rules
- Device connectivity: Online at age <= 2 expected heartbeat intervals; Delayed at age > 2 and <= 5 intervals; Offline at age > 5 intervals. Never seen when there has been no contact.
- Reliable machine communication evidence: Current at age <= 2 expected observation intervals; Stale after that. Unknown when reliable evidence or its expected interval is unavailable.
- Daily reports: due at 00:15 Africa/Johannesburg, with a one-hour grace period. The report becomes overdue after 01:15 if missing.
- Interval reports: configured interval plus a grace period of 20% of that interval.
- Missing reporting schedule: Unknown.
- Attention list includes Offline, Delayed, Stale, Overdue, Unknown, and Never seen with a plain-language reason.
- Scope: dashboard indicators and attention list. Notifications and automatic maintenance tickets are excluded.

## Assignment and dashboard boundaries
Machine observations and sales reports belong to the device assignment at observation time. Reassignment does not transfer old evidence to the new machine. Unresolvable assignments remain unresolved and do not refresh either machine's indicators.

A device that has contacted the service but lacks an expected heartbeat interval shows Unknown with its last contact time. Never seen applies only when no contact exists.

When dashboard updates fail, preserve last known values, mark them potentially outdated, show Dashboard updates unavailable and the last refresh time, and do not present newly calculated warnings as live facts. Refresh all indicators on reconnection. Labels and icons accompany colour.

## Confirmation
The user confirmed shared understanding on 6 November 2026. The demonstration is complete. Acceptance scenarios remain review criteria, not executed tests. No production implementation is authorized by this example.
