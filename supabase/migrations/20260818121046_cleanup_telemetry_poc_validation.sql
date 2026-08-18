delete from public.telemetry_machine_state where device_id = '6e1c0036-d109-452e-bfe5-fb035a318846'::uuid;
delete from public.telemetry_devices where id = '6e1c0036-d109-452e-bfe5-fb035a318846'::uuid;
delete from public.telemetry_enrollment_tokens where token_hash = 'validation-token-hash';
