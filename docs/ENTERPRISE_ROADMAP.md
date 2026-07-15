# DallmayrERP Enterprise Roadmap

This roadmap turns DallmayrERP from a role-based operational web app into a fuller enterprise organisation-management system. It is intentionally phased so each improvement can be delivered without breaking the current live app.

## Current strengths

- Supabase-backed authentication and session handling.
- Role-based workspace routing for admin, operations, sales, finance, marketing, executive, warehouse, technician and road technician users.
- Admin user invite flow with role and branch assignment.
- Mobile-first technician and road-technician task closure workflow.
- Warehouse stock scanning, delivery-order scanning and document upload foundations.
- Executive dashboards using customer, contract, service, stock, document and operational capture data.
- Desktop top navigation with role-filtered category dropdowns and mobile hamburger navigation.
- Desktop-only spatial dashboard styling for executive and management pages.

## Enterprise target state

DallmayrERP should become the single operational control plane for Dallmayr South Africa:

- One source of truth for branches, users, customers, sites, machines, stock, orders, service work, contracts, marketing and finance signals.
- Role-specific workflows with strict permissions and audit trails.
- Executive dashboards that summarise performance, risk and accountability.
- Mobile field workflows that are fast enough for technicians working on-site.
- Exportable reporting for management, finance and branch reviews.
- Quality gates that prevent broken deployments.

## Phase 1 — Enterprise foundation

### 1. Data governance and auditability

Add an `activity_log` or `audit_events` table and log important actions:

- User invited, updated or removed.
- Stock scanned, created or adjusted.
- Delivery order created or status changed.
- Technician task closed.
- Document uploaded or downloaded.
- Marketing campaign created or changed.

Each audit event should include:

- Actor user id.
- Actor role.
- Branch.
- Entity type.
- Entity id.
- Action.
- Before and after payload where appropriate.
- Timestamp.

### 2. Normalised operational master data

Keep the raw imported tables unchanged, but build normalised operational tables on top:

- `customers`
- `customer_sites`
- `machines`
- `contracts`
- `service_jobs`
- `stock_locations`
- `warehouses`
- `suppliers`
- `delivery_routes`

Raw tables should remain upload-compatible. Normalised tables should power the ERP workflows.

### 3. Workflow state machines

Define clear statuses and allowed transitions:

- Delivery orders: `draft -> picked -> dispatched -> delivered -> closed`.
- Service jobs: `new -> assigned -> in_progress -> completed -> verified -> closed`.
- Stock movements: `received -> available -> reserved -> picked -> dispatched -> adjusted`.
- Campaigns: `planned -> active -> paused -> completed -> archived`.

Use secure database functions or server actions for important transitions.

## Phase 2 — Operational depth

### 1. Inventory ledger

Move from direct quantity updates toward append-only stock movement events:

- Stock received.
- Stock adjusted.
- Stock reserved.
- Stock picked.
- Stock transferred.
- Stock returned.

Current stock should be derived from ledger entries or updated only through secure functions.

### 2. Delivery and route operations

Add a real delivery module:

- Delivery order list.
- Status filters.
- Dispatch board.
- Driver / road technician assignment.
- Route proof photos.
- Customer sign-off.
- Delivery completion notes.

### 3. Service operations module

Add service job management:

- Job list by branch.
- Technician assignment.
- Job priority.
- SLA status.
- Customer/site/machine link.
- Closure validation.
- Repeat-fault detection by machine barcode or serial number.

### 4. Machine / asset register

Create a proper asset workspace:

- Machine profile.
- Customer/site association.
- Serial number and barcode.
- Contract link.
- Service history.
- Fault history.
- Preventive service schedule.
- Technician notes and photos.

## Phase 3 — Management and reporting

### 1. Executive command centre

Build executive dashboards around business questions:

- Which branch is at risk?
- Which customers have the most service load?
- Which machines are repeat offenders?
- Which contracts are expiring?
- Which stock items are blocking operations?
- Which technicians are overloaded?

### 2. Department reporting

Add exportable reports for:

- Branch performance.
- Warehouse risk.
- Service workload.
- Contract risk.
- Marketing activity.
- User activity.
- Stock movement.
- Delivery status.

Support CSV export first, then PDF packs later.

### 3. Actionable insights

Dashboards should not only show counts. They should include interpretation:

- Highest-risk branch.
- Stock items below reorder level.
- Contracts requiring follow-up.
- Repeat machine faults.
- Overdue jobs.
- Unverified task closures.

## Phase 4 — Enterprise platform quality

### 1. Quality gates

Keep a CI workflow that runs on push and pull request:

- Install dependencies.
- TypeScript check.
- Next.js build.
- Future: lint, unit tests and Playwright smoke tests.

### 2. Testing

Add automated tests in this order:

- Utility tests for permissions and formatting.
- Component tests for role navigation.
- Playwright smoke tests for login, navigation and core forms.
- Regression tests for mobile technician workflows.

### 3. Error handling and observability

Add:

- User-friendly error boundaries.
- Structured client error reporting.
- Admin-visible failed-action logs.
- Deployment health checks.

### 4. Security hardening

Review and harden:

- RLS policies per role and branch.
- Storage access policies.
- Secure functions for sensitive writes.
- Admin-only user management.
- No service-role key in client code.
- No role decisions based on user-editable metadata.

## Phase 5 — Enterprise polish

### 1. Design system

Standardise:

- Page headers.
- KPI cards.
- Risk cards.
- Status badges.
- Empty states.
- Table actions.
- Form validation.
- Mobile field controls.

### 2. Command palette / global search

Add fast search across:

- Customers.
- Machines.
- Stock items.
- Contracts.
- Service jobs.
- Delivery orders.

### 3. Notification centre

Add role-specific alerts:

- Low stock.
- Expiring contracts.
- Failed uploads.
- Overdue service jobs.
- Unverified closures.
- Delivery exceptions.

## Immediate recommended next builds

1. Add an audit-events table and logging helper.
2. Add delivery-order list and status management.
3. Add service-job list and assignment workflow.
4. Add machine/asset profile pages.
5. Add CSV export buttons on executive pages.
6. Add CI type/build gate and later smoke tests.
7. Harden stock scanning into an append-only movement ledger.
8. Build a command-centre executive dashboard with branch risk scoring.
