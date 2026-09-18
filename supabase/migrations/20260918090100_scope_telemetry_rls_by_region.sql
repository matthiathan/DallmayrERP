-- Region is a second authorization boundary layered on top of existing role policies.
-- Restrictive policies mean an authenticated row must pass both its existing role
-- policy and this telemetry-region policy.

drop policy if exists telemetry_region_scope_machines on public.machines;
create policy telemetry_region_scope_machines on public.machines as restrictive for all to authenticated using (telemetry_region=public.current_telemetry_region()) with check (telemetry_region=public.current_telemetry_region());
drop policy if exists telemetry_region_scope_devices on public.telemetry_devices;
create policy telemetry_region_scope_devices on public.telemetry_devices as restrictive for all to authenticated using (telemetry_region=public.current_telemetry_region()) with check (telemetry_region=public.current_telemetry_region());

drop policy if exists telemetry_region_scope_fault_events on public.telemetry_fault_events;
create policy telemetry_region_scope_fault_events on public.telemetry_fault_events as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_machine_state on public.telemetry_machine_state;
create policy telemetry_region_scope_machine_state on public.telemetry_machine_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_counter_state on public.telemetry_counter_state;
create policy telemetry_region_scope_counter_state on public.telemetry_counter_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_daily_sales on public.telemetry_daily_item_sales;
create policy telemetry_region_scope_daily_sales on public.telemetry_daily_item_sales as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_simulation_sales on public.telemetry_daily_simulation_sales;
create policy telemetry_region_scope_simulation_sales on public.telemetry_daily_simulation_sales as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));

drop policy if exists telemetry_region_scope_usage_daily on public.telemetry_data_usage_daily;
create policy telemetry_region_scope_usage_daily on public.telemetry_data_usage_daily as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_usage_state on public.telemetry_data_usage_state;
create policy telemetry_region_scope_usage_state on public.telemetry_data_usage_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_prepaid_state on public.telemetry_prepaid_balance_state;
create policy telemetry_region_scope_prepaid_state on public.telemetry_prepaid_balance_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_prepaid_history on public.telemetry_prepaid_balance_history;
create policy telemetry_region_scope_prepaid_history on public.telemetry_prepaid_balance_history as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));

drop policy if exists telemetry_region_scope_location_state on public.telemetry_device_location_state;
create policy telemetry_region_scope_location_state on public.telemetry_device_location_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_location_history on public.telemetry_device_location_history;
create policy telemetry_region_scope_location_history on public.telemetry_device_location_history as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_diagnostics on public.telemetry_diagnostics;
create policy telemetry_region_scope_diagnostics on public.telemetry_diagnostics as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_config_history on public.telemetry_device_config_history;
create policy telemetry_region_scope_config_history on public.telemetry_device_config_history as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_selection_observations on public.telemetry_selection_observations;
create policy telemetry_region_scope_selection_observations on public.telemetry_selection_observations as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_vend_evidence on public.telemetry_vend_evidence;
create policy telemetry_region_scope_vend_evidence on public.telemetry_vend_evidence as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_dex_audit on public.telemetry_dex_audit_state;
create policy telemetry_region_scope_dex_audit on public.telemetry_dex_audit_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_sim_counter on public.telemetry_simulation_counter_state;
create policy telemetry_region_scope_sim_counter on public.telemetry_simulation_counter_state as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));

drop policy if exists telemetry_region_scope_test_sessions on public.telemetry_test_sessions;
create policy telemetry_region_scope_test_sessions on public.telemetry_test_sessions as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_test_commands on public.telemetry_test_commands;
create policy telemetry_region_scope_test_commands on public.telemetry_test_commands as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_debug_logs on public.telemetry_debug_logs;
create policy telemetry_region_scope_debug_logs on public.telemetry_debug_logs as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));

drop policy if exists telemetry_region_scope_alarm_workflow on public.telemetry_alarm_workflow;
create policy telemetry_region_scope_alarm_workflow on public.telemetry_alarm_workflow as restrictive for all to authenticated using (public.telemetry_region_allows_fault(fault_id)) with check (public.telemetry_region_allows_fault(fault_id));
drop policy if exists telemetry_region_scope_alarm_workflow_history on public.telemetry_alarm_workflow_history;
create policy telemetry_region_scope_alarm_workflow_history on public.telemetry_alarm_workflow_history as restrictive for all to authenticated using (public.telemetry_region_allows_fault(fault_id)) with check (public.telemetry_region_allows_fault(fault_id));
drop policy if exists telemetry_region_scope_attention_workflow on public.telemetry_fleet_attention_workflow;
create policy telemetry_region_scope_attention_workflow on public.telemetry_fleet_attention_workflow as restrictive for all to authenticated using (public.telemetry_region_allows_device(device_id)) with check (public.telemetry_region_allows_device(device_id));
drop policy if exists telemetry_region_scope_attention_history on public.telemetry_fleet_attention_workflow_history;
create policy telemetry_region_scope_attention_history on public.telemetry_fleet_attention_workflow_history as restrictive for all to authenticated using (public.telemetry_region_allows_attention_source(source_key)) with check (public.telemetry_region_allows_attention_source(source_key));

drop policy if exists telemetry_region_scope_enrollment_tokens on public.telemetry_enrollment_tokens;
create policy telemetry_region_scope_enrollment_tokens on public.telemetry_enrollment_tokens as restrictive for all to authenticated using (telemetry_region=public.current_telemetry_region()) with check (telemetry_region=public.current_telemetry_region());
drop policy if exists telemetry_region_scope_enrollment_windows on public.telemetry_enrollment_windows;
create policy telemetry_region_scope_enrollment_windows on public.telemetry_enrollment_windows as restrictive for all to authenticated using (telemetry_region=public.current_telemetry_region()) with check (telemetry_region=public.current_telemetry_region());
drop policy if exists telemetry_region_scope_enrollment_claims on public.telemetry_enrollment_window_claims;
create policy telemetry_region_scope_enrollment_claims on public.telemetry_enrollment_window_claims as restrictive for all to authenticated using (public.telemetry_region_allows_enrollment_window(window_id)) with check (public.telemetry_region_allows_enrollment_window(window_id));
