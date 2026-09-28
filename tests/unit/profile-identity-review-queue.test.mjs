import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workspace = fs.readFileSync(new URL('../../components/telemetry-platform/ProfileIdentityEvidenceWorkspace.tsx', import.meta.url), 'utf8');

test('profile identity workspace exposes operational queue categories', () => {
  assert.match(workspace, /type ReviewQueueFilter = 'needs_review' \| 'ambiguous' \| 'recommended' \| 'unresolved' \| 'all'/);
  assert.match(workspace, /Ambiguous/);
  assert.match(workspace, /Recommended/);
  assert.match(workspace, /Unresolved/);
  assert.match(workspace, /All candidates/);
});

test('unresolved review queue excludes trusted assignments by default', () => {
  assert.match(workspace, /profile_assignment_method === 'manual'/);
  assert.match(workspace, /device\.profile_id/);
  assert.match(workspace, /needs_review/);
});

test('review queue sorts ambiguous before recommended before unresolved', () => {
  assert.match(workspace, /ambiguous[^\n]*0/);
  assert.match(workspace, /recommended[^\n]*1/);
  assert.match(workspace, /unresolved[^\n]*2/);
});
