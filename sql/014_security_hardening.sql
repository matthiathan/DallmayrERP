-- Apply after the early marketing/app support scripts to replace broad
-- authenticated policies with role-scoped access rules.
\ir ../supabase/migrations/20260803000000_harden_sales_marketing_security.sql
