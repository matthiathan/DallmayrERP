# Telemetry status design: example review

Status: Confirmed by the user on 6 November 2026. Demonstration complete.

## Example prompt
Our telemetry dashboard sometimes shows a vending machine as online even though its sales data has stopped updating. Help design clearer status indicators so our maintenance team knows what needs attention.

## Scope
Dashboard indicators and attention list only. Notifications and automatic maintenance tickets are excluded. This is an illustrative design, not a production change or a statement about current firmware capabilities. No code or repository was inspected; implementation feasibility remains unverified.

## Agreed design
Display device connectivity, machine communication freshness, and sales report freshness independently. Zero sales alone never establishes a fault. Each warning clears only on evidence that its own condition recovered.

| Dimension | Rule |
|---|---|
| Device connectivity | Online through 2 expected heartbeat intervals; Delayed after 2 through 5; Offline after 5. Never seen before any contact. Unknown after contact when the interval is missing. |
| Machine communication | Current through 2 expected observation intervals; Stale after 2. Unknown when reliable evidence or the expected interval is unavailable. |
| Daily reports | Due 00:15 Africa/Johannesburg; missing report becomes overdue after 01:15. |
| Interval reports | Due according to configured interval, with a grace period of 20% of that interval. |
| Missing report schedule | Unknown. |
| Buffered information | Receipt establishes device contact now; observations retain their original time and assignment. Old reports fill their own reporting gaps. |
| Device replacement | New machine starts Unknown for communication until evidence for its assignment arrives. Unresolved assignments affect neither machine. |
| Dashboard disconnection | Preserve and visibly date last known values. Show Dashboard updates unavailable. Refresh all indicators on reconnection. |
| Attention list | Include Offline, Delayed, Stale, Overdue, Unknown, Never seen; explain each reason using labels and icons alongside colour. |

## Acceptance scenarios
These are review criteria, not executed tests.

| Scenario | Expected outcome |
|---|---|
| Heartbeat interval 5 minutes; last contact 10 minutes ago | Online at the boundary. |
| Same device; contact 11 minutes ago | Delayed. |
| Same device; contact 25 minutes ago | Delayed at the boundary. |
| Same device; contact 26 minutes ago | Offline. |
| Device has never contacted the service | Never seen. |
| Device has contacted the service; interval missing | Unknown plus last contact time and configuration explanation. |
| Heartbeats arrive but machine observations stop | Connectivity can be Online while communication is Stale. |
| No purchases, but valid communication continues | No communication fault inferred from zero sales. |
| Reliable periodic communication cannot be established | Communication Unknown. |
| Yesterday's observation arrives today | Device contact updates; observation does not become current. |
| Daily report missing at 01:15 local time | Still within the agreed grace boundary. |
| Daily report still missing after 01:15 | Overdue. |
| Valid report with zero sales arrives | Its reporting gap clears; communication freshness is evaluated separately. |
| Heartbeat arrives while a report is overdue | Connectivity recovers; report remains overdue. |
| Device moves A to B, then uploads A's old evidence | B does not become Current from A's evidence. |
| Assignment cannot be established | Information stays unresolved; neither machine status refreshes. |
| Dashboard loses service connection | Dated cached values and prominent update warning; no new live status claims. |
| Dashboard reconnects | All indicators refresh from service information. |

## Design tree coverage
- Meaning and scope: independent signals; dashboard only; sales inactivity is not fault evidence.
- Timing and evidence: heartbeat intervals; reliable machine observations; reporting schedules and grace periods.
- Recovery: delayed uploads; independent warning clearance; attention conditions.
- Boundaries: missing configuration; assignment history; dashboard connection failures and accessible labels.
- Final confirmation: the user confirmed shared understanding on 6 November 2026.

## Documents
GLOSSARY.md defines the domain language. docs/adr/0001-separate-telemetry-health-signals.md records the principal trade-off, alternatives, and consequences.
