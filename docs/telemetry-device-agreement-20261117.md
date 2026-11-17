# Telemetry device agreement and source audit

Approved product requirements: 17 November 2026. Source audited: commit
`4bef40feb9e95ad820ccde71d09b848a1b6bcf9f`, generated firmware V6.8.52.
This is a source audit, not verification of the deployed database or physical device.

## Agreed behaviour

1. Provision each device with its own authentication credential before field installation. Field startup requires neither an enrollment window nor an entered token. Show Online / Unmapped until an administrator confirms a machine.
2. Cellular is always preferred. Configured Wi-Fi is fallback when the cellular backend path fails. Resume cellular only after backend reachability is established and a stability delay prevents flapping.
3. Collect health and machine readings before mapping. Keep readings unassigned until an administrator confirms the machine and applicable time range.
4. Identity evidence may suggest a match but must never silently assign a machine. A model fingerprint is not a unique machine identifier.
5. Count successful vends per selection; exclude cancelled/failed vends from success totals. Unknown selections remain named selection codes until an approved machine/profile product mapping exists.
6. Establish an installation baseline. Keep pre-installation lifetime totals separate from new sales.
7. Persist unsent counts and fault changes across connection failures and power cycles. Retry idempotently. Expose overflow, invalid storage and data loss.
8. Send a heartbeat every minute independently of sales reporting. Report new faults promptly. Sales follow live/daily/monthly schedules in the machine's timezone, default Africa/Johannesburg. Delayed reports retain their original period.
9. Mark a device offline after five minutes without a heartbeat. Keep device connectivity, machine communication and report freshness distinct.
10. Preserve prior machine history on reassignment and establish a separate baseline. Uncertain transition readings stay unresolved for review.
11. Approximate cellular location has its own source, observation time and accuracy where available. It must not overwrite the confirmed machine placement.
12. Active faults clear only on confirmed recovery. Missing communication or reboot is not recovery. Unsupported measurements are unavailable, not healthy.
13. Retry automatically, recover the modem and restart the MCU only as a last resort. Preserve data and report the reason.
14. Allow remote reporting/network configuration, diagnostics and restart with request/acknowledgement audit history. Do not operate vending, payment approvals or machine resets.
15. Permit administrator-initiated authenticated firmware updates during the pilot, preserving credentials/data and rolling back a firmware that cannot start correctly.
16. Offer downloadable device diagnostics without passwords or private device credentials.
17. Remain passive and electrically isolated; telemetry failure must not interrupt normal vending.
18. Approve support per physically tested machine model/interface. Require first-boot, mapping, counts, cancelled vends, network/power recovery and portal-status acceptance evidence.
19. Use existing infrastructure; no additional paid services or separate database.

## Findings

| Area | Evidence in current source | Required work or verification |
| --- | --- | --- |
| First registration | `telemetry-enroll/index.ts` chooses a one-time token or administrator-window RPC. Firmware retries that flow. | Add a controlled pre-installation provisioning path and verify restart/retry behaviour without an on-site window. Do not replace authentication with an unrestricted UID-only registration endpoint. |
| Cellular preference | Firmware `getTransportOrder()` puts Wi-Fi first for `auto`; `maintainCellular()` can stop PPP while Wi-Fi is healthy. | Change both routing and modem lifecycle, including failover/recovery stability. Merely changing a default string is insufficient. |
| Admin-confirmed mapping | Ingest calls `try_auto_link_telemetry_device`; the identity reconciliation SQL writes `machine_id`, and an identity trigger invokes reconciliation. Enrollment tokens can also pre-pair machines. | Audit and close every automatic assignment path together; retain suggested matches. Avoid changing only the ingest handler. |
| Counter persistence | `saveCountersNow()` and `loadCounters()` use NVS; local vends save counters immediately. Invalid storage rotates the epoch. | Validate actual power-cut durability, failed writes and backend deduplication. Cumulative totals alone do not preserve original reporting periods. |
| Fault persistence | `setLocalFaultState()` and `flushPendingFaults()` retain pending state in the RAM fault table. No fault-table NVS save/load path was found in the generated sketch. | Persist fault changes before upload and restore on restart; preserve evidence/time and overflow status. |
| Heartbeat cadence | Firmware uses remotely configured heartbeat minutes; config falls back to ten minutes. | Align server policy, firmware schedule and portal expectations to one minute. |
| Offline status | `lib/telemetry/device-health.ts` uses latest contact across four fields and five expected heartbeat intervals. | Implement the agreed heartbeat-based five-minute boundary consistently across portal and server status calculations. |
| First counter baseline | The first-vend migration intentionally preserves a first observed cumulative vend as a delta. | Distinguish locally counted post-installation events from imported machine lifetime audits. Blanket suppression of the first snapshot would lose genuine sales. |
| Assignment history | Existing reconciliation updates device and machine-state associations. | Trace all manual assignment paths and aggregation tables before designing observation-time assignment and effective-time review. Not yet verified end to end. |
| Reporting periods | Firmware has interval-based cumulative counter scheduling. | Verify calendar-period capture, timezone boundaries and late uploads; do not infer original daily distribution from a later lifetime total. |
| Independent health | Portal already has independent device/machine/report health helpers and summary UI. | Reuse them; check real payload evidence and stale dashboard behaviour. |
| Location | A separate cellular LBS sketch is supplied with V6.8.52. | Validate provider availability, accuracy/staleness display and separation from confirmed machine coordinates. No GPS accuracy claim. |
| Remote configuration | Config acknowledgements and history already exist. | Verify requested versus applied state, command allowlist and restart audit/recovery. |
| Firmware updates | No OTA update API or boot rollback implementation was found in generated V6.8.52. The observed rollback text concerns MDB pin order. | Implement authenticated artifact delivery, partition/boot rollback and physical failure tests. Do not label pin rollback as firmware rollback. |
| Diagnostics | Console status and Remote Test Center exist. | Audit export coverage and redact secrets; download acceptance remains outstanding. |
| Passive MDB | Active TX is compile-time disabled and guarded in the generator. | Preserve that guard and physically verify interface isolation and machine independence. |

## Approved testing boundaries

The user confirmed these testing boundaries on 17 November 2026 and reaffirmed
cellular preference, administrator assignment finality and remote update/rollback.

| Boundary | Catches | Does not prove |
| --- | --- | --- |
| Firmware transport/persistence public interface in a host harness, plus Arduino build | Routing, fallback timing, restored readings, retries and build compatibility | Actual modem, flash power-cut or electrical behaviour |
| Enrollment, ingest and assignment public APIs against a disposable local database | Authorization, unmapped registration, no automatic assignment, replay safety, effective-time attribution | Production configuration or machine decoding |
| Rendered portal with API-backed fixtures | Unmapped workflow, heartbeat boundary, unknown products, independent statuses, diagnostic redaction | Real connectivity or hardware correctness |
| Physical pilot checklist | Real vends, failed vends, power/network failures, modem recovery, safe operation and update rollback | Untested machine models/interfaces |

## Implementation order

1. Preserve this agreement; prepare isolated change branch and reproducible build/test tooling.
2. Deliver cellular-first routing with stable fallback and a one-minute heartbeat end to end.
3. Deliver controlled pre-provisioning and admin-confirmed unmapped onboarding across all assignment paths.
4. Deliver durable observation/fault storage and idempotent replay with explicit storage-failure reporting.
5. Deliver assignment history, installation baselines and calendar-period reporting together.
6. Complete fault/location/diagnostic/remote-control presentation and acknowledgement contracts.
7. Deliver authenticated firmware update/rollback with the actual board partition configuration.
8. Run complete automated checks, independent review and physical pilot acceptance; package a new version.

Do not merge or represent a new firmware as rollout-ready while these requirements
or physical checks remain incomplete. No live database or production deployment
was changed during this source audit.

## Verification performed

Generated V6.8.52 successfully. Ran the existing V6.8.52, zero-touch enrollment,
current transport contract, machine identification and deletion test files:
21 passed, 0 failed. These are source-contract checks of current behaviour,
not acceptance tests for this agreement. No firmware compilation or physical
device test has been performed in this audit.

## Current branch progress

Cellular-first routing, administrator-confirmed assignment, bench pre-provisioning
and signed remote update/rollback control are implemented on the review branch.
See `telemetry-remote-update-pilot.md` for activation prerequisites, verification
and the explicitly outstanding wider requirements. This is not a full-spec
completion or physical rollout approval.
