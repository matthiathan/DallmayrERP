# DallmayrERP

Internal operations ERP for Dallmayr South Africa.

## Current scope

This repository starts the live Supabase-backed web app for:

- Business users and roles
- Warehouse stock register
- Marketing dashboards, segments and campaigns
- Executive dashboards and reports
- Raw imported source tables for customers, contracts, fixed assets and service calls

## Supabase project

Project: `DallmayrERP`  
Project ref: `egbiiizxsqlarqpnzxxs`

Set these environment variables before running the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://egbiiizxsqlarqpnzxxs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your Supabase publishable or anon key>
```

Never commit the Supabase service-role key.

## Development

```bash
npm install
npm run dev
```

## Main tables used

- `public.users`
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

## Role pages

- `/admin/users`
- `/warehouse/stock`
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
