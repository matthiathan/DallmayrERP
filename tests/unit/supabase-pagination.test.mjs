import assert from 'node:assert/strict';
import test from 'node:test';

import { collectSupabasePages, collectSupabasePagesResult } from '../../lib/supabase/collect-pages.ts';

test('collectSupabasePages reads every full page plus the terminating partial page', async () => {
  const calls = [];
  const rows = Array.from({ length: 2405 }, (_, index) => ({ id: index + 1 }));

  const result = await collectSupabasePages(async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  }, { pageSize: 1000 });

  assert.equal(result.length, 2405);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(result.at(-1)?.id, 2405);
});

test('collectSupabasePages continues when the fleet size is an exact page multiple', async () => {
  const calls = [];
  const rows = Array.from({ length: 2000 }, (_, index) => index);

  const result = await collectSupabasePages(async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  }, { pageSize: 1000 });

  assert.equal(result.length, 2000);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('collectSupabasePagesResult fails closed instead of returning a partial fleet', async () => {
  const result = await collectSupabasePagesResult(async (from) => {
    if (from === 0) return { data: Array.from({ length: 1000 }, (_, index) => index), error: null };
    return { data: null, error: { message: 'page two unavailable' } };
  }, { pageSize: 1000 });

  assert.deepEqual(result.data, []);
  assert.equal(result.error?.message, 'page two unavailable');
});

test('collectSupabasePages enforces a maximum-page guard', async () => {
  await assert.rejects(
    collectSupabasePages(async () => ({ data: [1], error: null }), { pageSize: 1, maxPages: 2 }),
    /exceeded 2 pages/,
  );
});
