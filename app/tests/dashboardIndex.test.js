import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_COVER_COLUMNS, DASHBOARD_COVER_INDEX, createDashboardIndexProbe, isDashboardIndexReady } from '../server/dashboardIndex.js';

const parts = () => DASHBOARD_COVER_COLUMNS.map((column, i) => ({
  Key_name: DASHBOARD_COVER_INDEX, Column_name: column, Seq_in_index: i + 1,
  Sub_part: null, Index_type: 'BTREE', Visible: 'NO', Non_unique: 1,
}));

test('only the complete invisible dashboard index enables covering queries', () => {
  assert.equal(isDashboardIndexReady(parts().reverse()), true);
  assert.equal(isDashboardIndexReady([]), false);
  assert.equal(isDashboardIndexReady(parts().slice(0, -1)), false);
  for (const change of [
    { Visible: 'YES' }, { Column_name: 'wrong_column' }, { Sub_part: 4 },
    { Key_name: 'other_index' }, { Index_type: 'HASH' }, { Non_unique: 0 },
  ]) {
    const rows = parts(); rows[0] = { ...rows[0], ...change };
    assert.equal(isDashboardIndexReady(rows), false);
  }
});

test('index detection caches results, coalesces requests and discovers later installation', async () => {
  let timestamp = 1000;
  let calls = 0;
  let installed = false;
  const probe = createDashboardIndexProbe(async (sql, values) => {
    calls++;
    assert.match(sql, /^SHOW INDEX/);
    assert.deepEqual(values, [DASHBOARD_COVER_INDEX]);
    return installed ? parts() : [];
  }, { now: () => timestamp, ttlMs: 100 });
  assert.deepEqual(await Promise.all([probe(), probe(), probe()]), [false, false, false]);
  assert.equal(calls, 1);
  installed = true;
  assert.equal(await probe(), false);
  timestamp += 101;
  assert.equal(await probe(), true);
  assert.equal(calls, 2);
});

test('a failed index lookup is retried rather than cached as an installed index', async () => {
  let calls = 0;
  const probe = createDashboardIndexProbe(async () => {
    if (++calls === 1) throw new Error('offline');
    return parts();
  });
  await assert.rejects(probe(), /offline/);
  assert.equal(await probe(), true);
  assert.equal(calls, 2);
});