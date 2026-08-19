# Dallmayr Machine Telemetry

Focused machine and telemetry monitoring for Dallmayr South Africa.

The application links Dallmayr machine records to their installed telemetry controllers and provides one operational view of fleet connectivity, item quantities, machine faults, locations and device configuration. Legacy ERP modules remain in the repository for migration safety, but they are no longer exposed by the primary application navigation.

## Current product scope

- Fleet overview with total, online, delayed, offline, never-connected and unlinked machines.
- Searchable machine register with machine type, brand, model, serial number and QR number.
- Machine-to-telemetry-device assignment and connection health.
- Independent heartbeat monitoring, separate from detailed sales upload schedules.
- Remote live, daily and monthly telemetry modes.
- Item quantities, failed vends, product rankings and reporting trends.
- Active fault codes with severity and first/last detection times.
- Telemetry connection details, firmware, Wi-Fi and cellular signal information.
- Last-known machine locations and movement monitoring.
- Detailed per-machine overview, sales, errors, telemetry and configuration views.

## Main routes

- `/workspace` — Fleet overview
- `/machines` — Machine and device register
- `/alerts` — Active machine errors
- `/telemetry` — Sales and telemetry analytics
- `/map` — Machine location map
- `/telemetry/devices` — Administrator device assignment

## Supabase project

Project: `DallmayrERP`  
Project ref: `egbiiizxsqlarqpnzxxs`

Set these environment variables before running the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://egbiiizxsqlarqpnzxxs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your Supabase publishable or anon key>
```

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The GitHub Actions workflow runs the locked install and production build for pushes and pull requests to `main`.
