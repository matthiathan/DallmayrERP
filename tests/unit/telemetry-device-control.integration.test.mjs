import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const read = (name) =>
  fs.readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
const migration = read('20261117053734_telemetry_cellular_admin_ota.sql');
const actor = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  machine = '11111111-1111-1111-1111-111111111111';
async function setup() {
  const db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create function public.current_app_role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
 create function public.is_active_app_user() returns boolean language sql stable as $$ select auth.uid() is not null $$;
 create function public.assert_telemetry_region_selected() returns text language sql stable as $$ select current_setting('test.region',true) $$;
 create function public.require_app_role(allowed text[]) returns void language plpgsql as $$ begin if auth.uid() is null or not public.current_app_role()=any(allowed) then raise exception 'insufficient privileges' using errcode='42501'; end if; end $$;
 create table public.machines(id uuid primary key,site_id uuid,telemetry_region text,serial_number text,asset_tag text,machine_barcode text);
 create table public.telemetry_devices(id uuid primary key default gen_random_uuid(),device_code text unique,hardware_uid text unique,credential_hash text,status text default 'active',machine_id uuid,site_id uuid,telemetry_region text,firmware_version text,telemetry_policy_id uuid,transport_preference text,wifi_enabled boolean,cellular_enabled boolean,reported_machine_serial text,reported_machine_asset text,machine_link_status text,machine_link_method text,machine_linked_at timestamptz,updated_at timestamptz);
 create table public.telemetry_machine_state(device_id uuid,machine_id uuid,site_id uuid,updated_at timestamptz);
 create table public.telemetry_enrollment_tokens(id uuid,token_hash text,used_at timestamptz,revoked_at timestamptz,expires_at timestamptz,expected_hardware_uid text,telemetry_region text,used_by_device_id uuid,expected_machine_id uuid);
 create table public.telemetry_policies(id uuid,policy_code text,heartbeat_interval_minutes integer);
 create table public.telemetry_enrollment_windows(id uuid,status text,expires_at timestamptz,closed_at timestamptz,expected_hardware_uid text,claimed_count integer,max_claims integer,opened_at timestamptz,telemetry_region text);
 create table public.telemetry_enrollment_window_claims(window_id uuid,device_id uuid,hardware_uid text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);
 create function storage.foldername(path text) returns text[] language sql immutable as $$ select string_to_array(path,'/') $$;
 create function public.telemetry_region_allows_device(device uuid) returns boolean language sql stable as $$ select exists(select 1 from public.telemetry_devices where id=device and telemetry_region=public.assert_telemetry_region_selected()) $$;
 grant usage on schema public,auth,storage to authenticated;
 `);
  await db.exec(migration);
  const link = read('20260928125000_machine_management_workflow.sql');
  const start = link.indexOf(
    'create or replace function public.link_telemetry_device(',
  );
  await db.exec(link.slice(start, link.indexOf('$$;', start) + 3));
  await db.exec(`select set_config('test.uid','${actor}',false),set_config('test.role','admin',false),set_config('test.region','za',false);
 insert into public.machines values('${machine}',null,'za','SERIAL1','QR1',null);`);
  return db;
}
async function provision(db, uid = 'AABBCCDDEEFF') {
  const { rows } = await db.query(
    `select public.provision_telemetry_device($1,$2) as result`,
    [uid, 'a'.repeat(64)],
  );
  return rows[0].result.device_id;
}
test('preprovisioned devices remain unmapped; identity suggests and only an admin confirms', async () => {
  const db = await setup();
  try {
    const device = await provision(db);
    await db.query('select public.try_auto_link_telemetry_device($1,$2)', [
      device,
      'SERIAL1',
    ]);
    let row = (
      await db.query(
        'select machine_id,suggested_machine_id from public.telemetry_devices where id=$1',
        [device],
      )
    ).rows[0];
    assert.equal(row.machine_id, null);
    assert.equal(row.suggested_machine_id, machine);
    await db.exec("select set_config('test.role','technician',false)");
    await assert.rejects(
      db.query('select public.link_telemetry_device($1,$2,$3)', [
        machine,
        device,
        'DLM-ESP32-AABBCCDDEEFF',
      ]),
      /confirmation|privileges/,
    );
    await db.exec("select set_config('test.role','admin',false)");
    await db.query('select public.link_telemetry_device($1,$2,$3)', [
      machine,
      device,
      'DLM-ESP32-AABBCCDDEEFF',
    ]);
    await db.query('select public.try_auto_link_telemetry_device($1,$2)', [
      device,
      'CONFLICTING-SERIAL',
    ]);
    row = (
      await db.query(
        'select machine_id,machine_link_method from public.telemetry_devices where id=$1',
        [device],
      )
    ).rows[0];
    assert.equal(row.machine_id, machine);
    assert.equal(row.machine_link_method, 'manual');
  } finally {
    await db.close();
  }
});
test('device registration ignores proposed machine; provisioning denies non-admin and duplicate hardware', async () => {
  const db = await setup();
  try {
    await db.query(
      'insert into public.telemetry_devices(device_code,machine_id,telemetry_region) values($1,$2,$3)',
      ['example', machine, 'za'],
    );
    assert.equal(
      (
        await db.query(
          "select machine_id from public.telemetry_devices where device_code='example'",
        )
      ).rows[0].machine_id,
      null,
    );
    await provision(db);
    await assert.rejects(provision(db), /unique|duplicate/);
    await db.exec("select set_config('test.role','operations',false)");
    await assert.rejects(provision(db, 'FFEEDDCCBBAA'), /privileges/);
  } finally {
    await db.close();
  }
});
test('OTA requires fresh rollback capability; requests are scoped, serialized and acknowledge only valid transitions', async () => {
  const db = await setup();
  try {
    const device = await provision(db);
    const other = await provision(db, 'FFEEDDCCBBAA');
    await db.query('insert into storage.objects values($1,$2)', [
      'telemetry-firmware',
      `za/${'b'.repeat(64)}.bin`,
    ]);
    const manifest = {
      version: '6.8.53',
      target: 'esp32s3-n16r8',
      generation: 53,
      size: 123456,
      sha256: 'b'.repeat(64),
      signature: '30'.repeat(70),
    };
    const release = (
      await db.query(
        'select public.register_telemetry_firmware_release($1) as id',
        [manifest],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query('select public.request_telemetry_firmware_update($1,$2)', [
        device,
        release,
      ]),
      /rollback/,
    );
    await db.query('select public.record_telemetry_firmware_status($1,$2)', [
      device,
      {
        status: 'idle',
        highwater: 52,
        rollback_capable: true,
        trust_ready: true,
      },
    ]);
    const job = (
      await db.query(
        'select public.request_telemetry_firmware_update($1,$2) as id',
        [device, release],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query('select public.request_telemetry_firmware_update($1,$2)', [
        device,
        release,
      ]),
      /unique|duplicate/,
    );
    const report = {
      job_id: job,
      generation: 53,
      status: 'installing',
      highwater: 52,
      rollback_capable: true,
      trust_ready: true,
    };
    await assert.rejects(
      db.query('select public.record_telemetry_firmware_status($1,$2)', [
        other,
        report,
      ]),
      /belong/,
    );
    await db.query('select public.record_telemetry_firmware_status($1,$2)', [
      device,
      report,
    ]);
    await assert.rejects(
      db.query('select public.record_telemetry_firmware_status($1,$2)', [
        device,
        { ...report, status: 'healthy' },
      ]),
      /confirmed/,
    );
    await db.query('select public.record_telemetry_firmware_status($1,$2)', [
      device,
      { ...report, status: 'awaiting_health' },
    ]);
    await db.query('select public.record_telemetry_firmware_status($1,$2)', [
      device,
      { ...report, status: 'healthy', highwater: 53 },
    ]);
    await assert.rejects(
      db.query('select public.request_telemetry_firmware_update($1,$2)', [
        device,
        release,
      ]),
      /newer/,
    );
    await db.exec("select set_config('test.region','de',false)");
    await assert.rejects(
      db.query('select public.request_telemetry_firmware_update($1,$2)', [
        device,
        release,
      ]),
      /region/,
    );
  } finally {
    await db.close();
  }
});
