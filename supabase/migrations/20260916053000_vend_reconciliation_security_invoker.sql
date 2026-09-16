-- The reconciliation RPC is read-only. Run it as the caller so the existing
-- telemetry_vend_evidence and telemetry_daily_item_sales RLS policies remain the
-- authorization boundary instead of elevating authenticated callers.
alter function public.get_telemetry_vend_reconciliation(integer, uuid)
  security invoker;

revoke all on function public.get_telemetry_vend_reconciliation(integer, uuid)
  from public, anon;
grant execute on function public.get_telemetry_vend_reconciliation(integer, uuid)
  to authenticated, service_role;
