-- Keep commissioning intent durable. A machine reserved by an enrollment token
-- must not be deletable in a way that silently removes the pre-pair target.

alter table public.telemetry_enrollment_tokens
  drop constraint if exists telemetry_enrollment_tokens_expected_machine_id_fkey;

alter table public.telemetry_enrollment_tokens
  add constraint telemetry_enrollment_tokens_expected_machine_id_fkey
  foreign key (expected_machine_id)
  references public.machines(id)
  on delete restrict;
