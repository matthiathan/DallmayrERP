# DallmayrERP

Internal operations ERP for Dallmayr South Africa.

DallmayrERP is being developed as a role-based enterprise organisation-management system covering branch operations, users, customers, contracts, warehouse stock, service activity, delivery orders, technician workflows, marketing activity and executive reporting.

## Enterprise direction

The target is a single operational control plane for Dallmayr South Africa:

- Role-based workspaces for admin, operations, sales, finance, marketing, executives, warehouse staff, technicians and road technicians.
- Branch-aware dashboards for JHB, CPT, KZN and national activity.
- Mobile-first field workflows for technicians and road technicians.
- Desktop executive dashboards with branch, service, warehouse, contract and machine/asset reporting.
- Barcode, photo and document capture for operational proof and auditability.
- Supabase-backed authentication, row-level security and storage controls.
- Continuous quality gates before deployment.

See [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md) for the phased enterprise upgrade plan.

## Current scope

This repository currently includes the live Supabase-backed web app for:

- Business users, role invites and user details.
- Role-filtered desktop dropdown navigation and mobile hamburger navigation.
- Warehouse stock register and stock scanning.
- Delivery-order creation by scanning picked stock.
- Technician and road-technician task closure with machine barcode and photo proof.
- Marketing dashboards, segments and campaigns.
- Executive dashboards and reports.
- Raw imported source tables for customers, contracts, fixed assets and service calls.
- Desktop-only spatial dashboard accents for executive and management views.

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

## Build check

```bash
npm run build
```

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml` that runs an install and production build on pushes and pull requests to `main`.

## Main tables used

- `public.users`
- `public.user_details`
- `public.stock_items`
- `public.customer_master_jhb`
- `public.customer_master_cpt`
- `public.customer_master_kzn`
- `public.contract_agreement_jhb`
- `public.contract_agreement_cpt`
- `public.contract_agreement_kzn`
- `public.fixed_assets`
- `public.service_call_log_jhb`
- `public.service_call_log_kzn`
- `public.preventive_service_log_cpt`
- `public.app_documents`
- `public.task_closures`
- `public.stock_scan_events`
- `public.delivery_orders`
- `public.delivery_order_lines`

## Role pages

- `/admin/users`
- `/operations`
- `/warehouse/stock`
- `/technician`
- `/road-tech`
- `/sales`
- `/finance`
- `/marketing`
- `/marketing/segments`
- `/marketing/campaigns`
- `/marketing/contract-renewals`
- `/marketing/reports`
- `/executive`
- `/executive/branches`
- `/executive/contracts`
- `/executive/service`
- `/executive/warehouse`
- `/executive/reports`

## Immediate next enterprise builds

1. Audit events and admin activity trail.
2. Inventory movement ledger.
3. Delivery order status board.
4. Service job assignment and SLA tracking.
5. Machine/asset profile pages.
6. Exportable executive reports.
7. Command-centre dashboard with branch risk scoring.
