import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910070239_telemetry_alarm_operator_workflow.sql', import.meta.url), 'utf8');
const center = fs.readFileSync(new URL('../../components/telemetry-platform/AlarmCenter.tsx', import.meta.url), 'utf8');

test('operator workflow remains separate from machine generated fault state', () => {
  assert.match(migration, /create table if not exists public\.telemetry_alarm_workflow/);
  assert.match(migration, /references public\.telemetry_fault_events\(id\) on delete cascade/);
  assert.match(migration, /workflow_status in \('open','acknowledged','resolved'\)/);
  assert.match(migration, /telemetry_alarm_workflow_history/);
  assert.match(migration, /set_telemetry_alarm_workflow/);
  assert.match(migration, /A resolution note of at least 3 characters is required/);
  assert.doesNotMatch(migration, /update public\.telemetry_fault_events[\s\S]*set cleared_at/i);
});

test('alarm center exposes acknowledgement ownership resolution and machine authority', () => {
  assert.match(center, /Unacknowledged/);
  assert.match(center, /Owned by me/);
  assert.match(center, /Acknowledge/);
  assert.match(center, /Take/);
  assert.match(center, /Resolve workflow/);
  assert.match(center, /Reopen/);
  assert.match(center, /Machine fault still active/);
  assert.match(center, /set_telemetry_alarm_workflow/);
  assert.match(center, /Operator workflow never overwrites the machine-generated fault state/);
});

test('alarm center provides operational filters and direct machine diagnostics', () => {
  assert.match(center, /Machine signal/);
  assert.match(center, /Workflow/);
  assert.match(center, /Severity/);
  assert.match(center, /Branch/);
  assert.match(center, /Source/);
  assert.match(center, /Last 24 hours/);
  assert.match(center, /Last 7 days/);
  assert.match(center, /Last 30 days/);
  assert.match(center, /occurrences \/ 30d/);
  assert.match(center, /telemetry\/test-center\?device=/);
});
