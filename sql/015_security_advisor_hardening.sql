-- Apply after the security hardening migration to preserve advisor-driven
-- RPC, view and RLS hygiene fixes outside the Supabase migrations path.
\ir ../supabase/migrations/20260803114102_harden_rpc_advisor_findings.sql
