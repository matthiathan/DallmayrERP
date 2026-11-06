import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Regression contracts only: these inspect SQL source, without impersonating a
// real Supabase user or claiming to prove runtime cross-region isolation.
const migrations = [
  ['customers', '20261019160000_paginate_customer_site_directory.sql', ['get_telemetry_customer_site_directory']],
  ['archive', '20261020070000_paginate_telemetry_archive.sql', ['get_telemetry_archive']],
  ['factory', '20261020074500_paginate_factory_directory.sql', ['get_telemetry_factory_directory']],
  ['profiles', '20261020081500_paginate_machine_profiles.sql', ['get_machine_profile_directory', 'get_machine_profile_detail']],
  ['maintenance', '20261021070000_paginate_maintenance_directory.sql', ['get_telemetry_maintenance_directory']],
];

for (const [workspace, filename, functions] of migrations) {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/' + filename, import.meta.url), 'utf8');
  test(workspace + ' read RPCs require account-derived region, staff, and authenticated grants', () => {
    assert.match(sql, /public\.assert_telemetry_region_selected\s*\(\s*\)/i);
    assert.match(sql, /public\.is_dallmayr_app_user\s*\(\s*\)/i);
    assert.match(sql, /security definer/i);
    assert.match(sql, /set search_path\s*=\s*public\s*,\s*pg_temp/i);
    assert.doesNotMatch(sql, /\bp_region\b/i, 'region must not be selected using a client argument');
    for (const name of functions) {
      assert.match(sql, new RegExp('create or replace function public\\.' + name + '\\s*\\(', 'i'));
      assert.match(sql, new RegExp('revoke all on function public\\.' + name + '\\(', 'i'));
      assert.match(sql, new RegExp('grant execute on function public\\.' + name + '\\([^;]+\\) to authenticated\\s*;', 'i'));
    }
  });
}

test('customer/site aggregates cannot count machines, sites or faults outside account region', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20261019160000_paginate_customer_site_directory.sql', import.meta.url), 'utf8');
  assert.match(sql, /s\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /m\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /d\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /public\.telemetry_account_allows_machine\s*\(m\.id\)/i);
  assert.match(sql, /public\.telemetry_account_allows_device\s*\(d\.id\)/i);
  assert.match(sql, /regional_jobs\s+as/i);
  assert.match(sql, /from regional_jobs rj/i);
});
test('archive and factory restrict every base and summary to the selected region', () => {
  for (const name of ['20261020070000_paginate_telemetry_archive.sql', '20261020074500_paginate_factory_directory.sql']) {
    const sql = fs.readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
    assert.match(sql, /d\.telemetry_region\s*=\s*v_region/i);
    assert.match(sql, /public\.telemetry_account_allows_device\s*\(d\.id\)/i);
  }
  const archive = fs.readFileSync(new URL('../../supabase/migrations/20261020070000_paginate_telemetry_archive.sql', import.meta.url), 'utf8');
  assert.match(archive, /m\.telemetry_region\s*=\s*v_region/i);
  assert.match(archive, /public\.telemetry_account_allows_machine\s*\(m\.id\)/i);
});
test('factory and machine profiles enforce administrator role in both list and detail', () => {
  for (const filename of ['20261020074500_paginate_factory_directory.sql', '20261020081500_paginate_machine_profiles.sql']) {
    const sql = fs.readFileSync(new URL('../../supabase/migrations/' + filename, import.meta.url), 'utf8');
    const checks = [...sql.matchAll(/public\.current_app_role\s*\(\s*\)\s*<>\s*'admin'/gi)];
    assert.ok(checks.length >= (filename.includes('machine_profiles') ? 2 : 1));
  }
});
test('maintenance scoped base and plan totals use the authenticated region', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20261021070000_paginate_maintenance_directory.sql', import.meta.url), 'utf8');
  assert.match(sql, /m\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /s\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /sm\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /mm\.telemetry_region\s*=\s*v_region/i);
  assert.match(sql, /public\.telemetry_account_allows_machine\s*\(mm\.id\)/i);
});
