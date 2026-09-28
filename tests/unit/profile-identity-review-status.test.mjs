import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workspaceUrl = new URL('../../components/telemetry-platform/ProfileIdentityEvidenceWorkspace.tsx', import.meta.url);
const workspace = fs.readFileSync(workspaceUrl, 'utf8');

test('profile identity review distinguishes persisted verified assignment from advisory resolver recommendation', () => {
  assert.match(workspace, /profile_id/);
  assert.match(workspace, /profile_assignment_method/);
  assert.match(workspace, /Verified automatic/);
  assert.match(workspace, /Manual override/);
  assert.match(workspace, /Ambiguous/);
  assert.match(workspace, /Unverified/);
  assert.match(workspace, /advisory/i);
});

test('verification refreshes persisted device state before reporting the result', () => {
  assert.match(workspace, /await\s+loadDevices\(/);
  assert.match(workspace, /await\s+loadCandidate\(selected\.id\)/);
  assert.match(workspace, /await\s+loadDevices\([\s\S]*filter:\s*'all'[\s\S]*search:\s*selected\.device_code[\s\S]*page:\s*1/);
});
