-- Target only the Machines + Telemetry paths still used by the production app.
-- Retired ERP tables are intentionally not indexed just to satisfy advisor noise.

create index if not exists machines_customer_id_idx on public.machines(customer_id);
create index if not exists machines_site_id_idx on public.machines(site_id);
create index if not exists customer_sites_customer_id_idx on public.customer_sites(customer_id);
create index if not exists telemetry_fault_events_fault_rule_id_idx on public.telemetry_fault_events(fault_rule_id);
create index if not exists telemetry_fault_rule_candidates_device_id_idx on public.telemetry_fault_rule_candidates(device_id);
create index if not exists telemetry_fault_rule_candidates_fault_event_id_idx on public.telemetry_fault_rule_candidates(fault_event_id);
create index if not exists telemetry_fault_rule_candidates_machine_id_idx on public.telemetry_fault_rule_candidates(machine_id);
create index if not exists product_mapping_history_product_id_idx on public.product_mapping_history(product_id);
create index if not exists users_access_updated_by_idx on public.users(access_updated_by);
