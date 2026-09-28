-- Remove direct browser execution from internal resolver/admin helpers.
-- These functions are not referenced by RLS policies and all current database callers
-- execute as SECURITY DEFINER, so browser roles do not need direct RPC access.
-- Keep service_role execution for maintenance/backward compatibility.

revoke execute on function public.admin_update_user_access(uuid, text, text, boolean, text) from authenticated;
revoke execute on function public.admin_update_user_access(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_update_user_access(uuid, text, text, boolean, text) to service_role;

revoke execute on function public.resolve_effective_telemetry_profile_key(uuid, uuid) from authenticated;
revoke execute on function public.resolve_effective_telemetry_profile_key(uuid, uuid) from public, anon;
grant execute on function public.resolve_effective_telemetry_profile_key(uuid, uuid) to service_role;

revoke execute on function public.resolve_mapped_product_name(uuid, uuid, text) from authenticated;
revoke execute on function public.resolve_mapped_product_name(uuid, uuid, text) from public, anon;
grant execute on function public.resolve_mapped_product_name(uuid, uuid, text) to service_role;

revoke execute on function public.resolve_mapped_product_name(uuid, text) from authenticated;
revoke execute on function public.resolve_mapped_product_name(uuid, text) from public, anon;
grant execute on function public.resolve_mapped_product_name(uuid, text) to service_role;
