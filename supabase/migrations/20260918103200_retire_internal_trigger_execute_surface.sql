-- Trigger functions are invoked by PostgreSQL and do not need to be callable
-- through the public Data API.
revoke execute on function public.log_machine_creation() from public, anon, authenticated;
