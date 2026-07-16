# DallmayrERP Professional System Benchmark

## Purpose

This benchmark compares DallmayrERP with established inventory, asset, maintenance, operations and work-management products. The objective is not to reproduce any one product. It is to adopt the strongest transferable enterprise patterns while preserving Dallmayr South Africa's customer, machine, warehouse, service and delivery workflows.

## Benchmark systems

| Product | Strongest patterns | DallmayrERP position after this sprint |
|---|---|---|
| Sortly | Mobile barcode/QR workflows, item photos, check-in/out, low-stock alerts, labels and simple deployment | Strong match on mobile scanning, photos, stock profiles, audited transactions and alerts. Label generation, offline work and report subscriptions remain. |
| Odoo Inventory | Multi-warehouse control, replenishment rules, put-away, cycle counts, serial/lot traceability and advanced picking | Strong match on warehouses, bins, purchase receiving, transfers, cycle counts and atomic fulfilment. Min/max automation, lot/serial stock and wave/batch picking remain. |
| Snipe-IT | Asset assignment, custody, acceptance, audits, warranty alerts, QR labels and complete history | Machine assets now include custody, condition, criticality, audits, warranty dates and lifecycle history. Acceptance signatures, asset models and generated labels remain. |
| MaintainX | Work orders, preventive maintenance, procedures, inspections, asset history and parts linkage | Work intake, maintenance tasks, required checklists, approvals, asset audits and stock/service links are now present. Automatic recurring preventive schedules and procedure templates remain. |
| Jira Service Management | Structured requests, queues, SLAs, approvals, incidents, changes, assets and knowledge management | Action Centre, request types, priorities, assignment, SLA targets, approvals and controlled transitions are now present. Knowledge articles, configurable portals and automation rules remain. |
| Asana | Cross-department task ownership, workload, portfolios, goals, reporting and workflow automation | Cross-role work items, ownership, comments, checklists and due-date queues are present. Dependencies, recurring work, workload planning, portfolios and goal tracking remain. |

## Current professional capability map

### Inventory and purchasing

- Live phone camera scanning for item and box barcodes.
- Atomic receive, issue, adjustment, cycle-count and transfer transactions.
- Warehouse and bin balances.
- Purchase orders with partial and complete receiving.
- Delivery picking with automatic stock deduction.
- Item photos, cost fields, stock valuation and movement evidence.
- Automatic low-stock records and reorder visibility.

### Asset lifecycle

- Customer/site-linked machine records.
- QR/barcode and serial identification.
- Condition and criticality classifications.
- Installation and warranty dates.
- Custody assignment, checkout, check-in and service states.
- Scheduled and completed audits.
- Complete lifecycle event history.
- Linked service history, comments and maintenance tasks.

### Operations and work management

- Unified Action Centre across work, service, stock, purchasing, delivery and asset exceptions.
- Structured request, task, approval, inspection, maintenance and incident records.
- Ownership, department, branch, priority, due date and SLA target.
- Controlled lifecycle transitions.
- Required checklists enforced before approval or completion.
- Approval decisions for authorised roles.
- Comments and audit timeline.
- Global search across work and operational records.

## Priority roadmap

### P1 — Operational reliability

1. Generate Supabase TypeScript types in CI and remove remaining handwritten query casts.
2. Add Playwright smoke tests for login, scanning, stock transactions, work-item transitions and asset custody.
3. Add branch-scoped RLS to work items, assets, stock balances and operational queues.
4. Move all audit-event creation into trusted database functions.
5. Add robust error telemetry and an administrator error console.

### P2 — Inventory maturity

1. Automatic min/max replenishment proposals.
2. Supplier lead times and preferred-supplier rules.
3. Lot, batch, expiry and serial tracking for applicable stock.
4. Put-away rules and suggested receiving bins.
5. Pick lists, reservations and wave/batch picking.
6. Printable QR/barcode labels and stock-count sheets.
7. Offline-capable scanning queue with conflict-safe synchronisation.

### P3 — Asset and maintenance maturity

1. Asset models and reusable specification templates.
2. Preventive-maintenance plans that automatically create scheduled work.
3. Meter readings and condition-based maintenance triggers.
4. Acceptance signatures for asset handover.
5. Generated QR labels with asset-profile deep links.
6. Warranty-expiry notifications and renewal actions.
7. Failure-code and recurring-fault analytics.

### P4 — Work-management maturity

1. Procedure/checklist templates.
2. Recurring work and task dependencies.
3. Configurable request forms by department.
4. Saved views and personal dashboards.
5. Workload and capacity planning.
6. Escalation rules for breached SLAs.
7. Knowledge articles linked to work and machine models.
8. Scheduled email/Teams summaries and approval notifications.

### P5 — Executive control

1. Drill-through KPIs for stock turns, fulfilment, SLA compliance and asset reliability.
2. Cost per customer, machine, service event and delivery.
3. First-time-fix rate and repeat-fault analysis.
4. Asset lifecycle cost and replacement forecasting.
5. Branch scorecards with consistent targets and period comparisons.

## Architecture principles

- Raw import table layouts remain unchanged.
- Operational changes must be transactional and auditable.
- Quantities, status changes, approvals and custody changes should pass through secured RPCs.
- Mobile workflows must retain manual fallback.
- Record detail pages are the authoritative workspaces; dashboards are navigation and exception surfaces.
- New modules must be branch-aware and role-aware from the database layer upward.
