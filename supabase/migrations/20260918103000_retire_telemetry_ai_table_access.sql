-- AI Insights was removed from DallmayrERP. Preserve the empty history tables,
-- but remove them from the authenticated/anonymous application surface.

revoke all privileges on table public.telemetry_ai_insight_cache from anon, authenticated;
revoke all privileges on table public.telemetry_ai_generation_log from anon, authenticated;

drop policy if exists telemetry_ai_insight_cache_select_own on public.telemetry_ai_insight_cache;
drop policy if exists telemetry_ai_insight_cache_insert_own on public.telemetry_ai_insight_cache;
drop policy if exists telemetry_ai_insight_cache_update_own on public.telemetry_ai_insight_cache;
drop policy if exists telemetry_ai_insight_cache_delete_own on public.telemetry_ai_insight_cache;
drop policy if exists telemetry_ai_generation_log_insert_own on public.telemetry_ai_generation_log;
drop policy if exists telemetry_ai_generation_log_select_admin on public.telemetry_ai_generation_log;
