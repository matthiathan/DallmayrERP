import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const renderBlueprint = fs.readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');

test('production Render deploys are manual so database promotion can complete first', () => {
  assert.match(renderBlueprint, /\bautoDeployTrigger:\s*off\b/);
  assert.doesNotMatch(renderBlueprint, /\bautoDeploy:\s*true\b/);
});
