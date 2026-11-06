# Website telemetry health correction

The approved design is recorded in DESIGN-REVIEW.md. The scope is the fleet dashboard, active device register, machine detail, and device attention screens. Factory device connectivity also uses the shared rule.

## Implemented
- Device connectivity loads the existing region-scoped get_telemetry_device_policy_states RPC and uses each device's effective heartbeat interval.
- Online through 2 intervals; Delayed after 2 through 5; Offline after 5. Missing policy is Unknown; no contact is Never seen. Disabled remains an administrative status.
- Machine communication freshness and sales report freshness are separate from device connectivity. Device receipt timestamps and zero sales never prove a machine fault or complete report.
- Required refresh failures retain the last successful snapshot and refresh time. Visible warnings mark the data potentially outdated. Superseded requests cannot overwrite a newer snapshot. Indicators use the successful snapshot time until the next successful refresh.
- The attention list distinguishes delayed, offline, unknown and never-seen connectivity from machine communication and report evidence gaps. Existing configuration, SIM-balance and network checks remain.

## Existing data boundary
Current production device rows do not expose assignment-bound periodic machine communication evidence, a verified expected report period, or complete report-period coverage. last_upload_at and last_counter_at are server receipt times. Therefore machine communication and sales report freshness display Unknown with explanations. No freshness or assignment claim is manufactured from those fields. This is the agreed Unknown behavior, not evidence that machine communications or sales ingestion have failed.

The data-health functions define and test the evidence contract needed to evaluate Current/Stale and Current/Overdue. They are not connected to a production evidence producer; wiring real periodic observations and reporting coverage requires a separate ingestion/data-contract task. The functions require matching machine and assignment identities, observation time, explicit deadlines, and grace periods. They do not infer a schedule from the live/daily/monthly mode alone. The approved daily deadline is 00:15 Africa/Johannesburg plus 60 minutes grace; interval grace is 20 percent. Monthly reporting deadlines were not specified in the interview and remain Unknown.

No schema, live database, firmware, hosting plan, credentials, role model or maintenance workflow is changed. No new dependencies or paid services are added. PR #309 must remain unmerged. Production deployment is outside this branch update.

## Verification
Run npm test, npm run typecheck, npm run build, npm run sourcecheck, npm run contractcheck, npm run design-system:check, npm run stylecheck, npm run accessibility:check.

Focused public-boundary tests: telemetry-device-health.test.mjs, telemetry-data-health.test.mjs, telemetry-health-summary.test.mjs, fleet-attention.test.mjs, device-attention.test.mjs, telemetry-devices-workspace.test.mjs.

Manual checks: load the dashboard and device register; verify heartbeat-policy thresholds and explanations; open a device snapshot and machine detail; confirm independent Unknown indicators; interrupt requests and refresh; verify old counts remain with an outdated-data warning; restore requests and verify warning clearance. Confirm both desktop and mobile layouts, including status filtering.
