import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20261021070000_paginate_maintenance_directory.sql', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../../components/telemetry-platform/MaintenanceWorkspace.tsx', import.meta.url), 'utf8');

test('maintenance directory is server paginated, staff-only and region scoped', () => {
  assert.match(migration, /get_telemetry_maintenance_directory/);
  assert.match(migration, /is_dallmayr_app_user/);
  assert.match(migration, /assert_telemetry_region_selected/);
  assert.match(migration, /telemetry_account_allows_machine/);
  assert.match(migration, /limit v_limit offset v_offset/);
  assert.match(migration, /grant execute.*authenticated/);
});
test('maintenance workspace uses the read RPC and never downloads bulk service jobs or plans', () => {
  assert.match(workspace, /rpc\('get_telemetry_maintenance_directory'/);
  assert.match(workspace, /p_offset: page \* PAGE_SIZE/);
  assert.match(workspace, /p_limit: PAGE_SIZE/);
  assert.doesNotMatch(workspace, /from\('service_jobs'\)/);
  assert.doesNotMatch(workspace, /from\('maintenance_plans'\)/);
  assert.match(workspace, /setDebouncedSearch\(search\.trim\(\)\)/);
});
test('secure mutation RPCs remain unchanged and separate from read path', () => {
  assert.match(workspace, /rpc\('assign_service_job'/);
  assert.match(workspace, /rpc\('transition_service_job'/);
  assert.doesNotMatch(migration, /create or replace function public\.(assign_service_job|transition_service_job|complete_assigned_service_job)/);
});

test('Kanban columns and calendar have independent bounded queries', () => {
  assert.match(workspace, /boardStatuses\.map\(\(column\) => client\.rpc/);
  assert.match(workspace, /boardPages\[column\]/);
  assert.match(workspace, /setBoardTotals\(totals\)/);
  assert.match(workspace, /p_offset: calendarPage \* PAGE_SIZE/);
  assert.match(workspace, /p_from: fromDate\.toISOString\(\)/);
  assert.match(workspace, /p_until: untilDate\.toISOString\(\)/);
  assert.match(workspace, /setCalendarTotal/);
  assert.match(migration, /p_from timestamptz default null/);
  assert.match(migration, /p_until timestamptz default null/);
  assert.match(migration, /interval '31 days'/);
  assert.match(migration, /drop function if exists public\.get_telemetry_maintenance_directory/);
});
test('completion ratio is not falsely described as first-time fix', () => {
  assert.doesNotMatch(workspace, /firstTimeFix|completion ratio/);
  assert.match(workspace, /Completed during the last 30 days/);
});
