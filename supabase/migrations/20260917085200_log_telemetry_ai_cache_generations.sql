create or replace function public.log_telemetry_ai_cache_generation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_analysis_scope text;
  v_machine_id uuid;
begin
  v_analysis_scope := case
    when new.scope_key like '%:machine:%' then 'machine'
    else 'fleet'
  end;

  if v_analysis_scope = 'machine' then
    begin
      v_machine_id := nullif(split_part(new.scope_key, ':machine:', 2), '')::uuid;
    exception when invalid_text_representation then
      v_machine_id := null;
    end;
  end if;

  insert into public.telemetry_ai_generation_log (
    user_id,
    scope_key,
    analysis_scope,
    machine_id,
    period,
    model,
    event_type,
    input_tokens,
    output_tokens,
    cache_write_ok,
    created_at
  ) values (
    new.user_id,
    new.scope_key,
    v_analysis_scope,
    v_machine_id,
    new.period,
    new.model,
    'success',
    new.input_tokens,
    new.output_tokens,
    true,
    new.generated_at
  );

  return new;
end;
$$;

drop trigger if exists telemetry_ai_cache_generation_log on public.telemetry_ai_insight_cache;
create trigger telemetry_ai_cache_generation_log
after insert or update of payload, model, input_tokens, output_tokens, generated_at
on public.telemetry_ai_insight_cache
for each row
execute function public.log_telemetry_ai_cache_generation();

revoke all on function public.log_telemetry_ai_cache_generation() from public;

grant execute on function public.log_telemetry_ai_cache_generation() to authenticated;

comment on function public.log_telemetry_ai_cache_generation() is
  'Records payload-free operational metadata when an authenticated AI insight cache entry is generated or refreshed.';
