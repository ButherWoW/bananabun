import test from 'node:test';
import assert from 'node:assert/strict';
import { prevPeriod, compareRange, changeOf } from '../src/api/routes/analytics.js';

test('previous period has the same length and ends the day before', () => {
  assert.deepEqual(prevPeriod('2026-10-10', '2026-10-16'), { from: '2026-10-03', to: '2026-10-09' });
  assert.deepEqual(prevPeriod('2026-10-31', '2026-10-31'), { from: '2026-10-30', to: '2026-10-30' });
  assert.deepEqual(prevPeriod('2026-03-01', '2026-03-31'), { from: '2026-01-29', to: '2026-02-28' });
  assert.deepEqual(prevPeriod('2026-01-01', '2026-01-02'), { from: '2025-12-30', to: '2025-12-31' });
  // DST change in Europe (last Sunday of October) does not shift the boundaries.
  assert.deepEqual(prevPeriod('2026-10-26', '2026-11-01'), { from: '2026-10-19', to: '2026-10-25' });
});

test('compare range: previous, explicit, invalid', () => {
  assert.equal(compareRange({}, '2026-10-01', '2026-10-07'), null);
  assert.deepEqual(compareRange({ compare: 'previous' }, '2026-10-08', '2026-10-14'), { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(compareRange({ compare_from: '2025-10-08', compare_to: '2025-10-14' }, '2026-10-08', '2026-10-14'), { from: '2025-10-08', to: '2025-10-14' });
  assert.ok(compareRange({ compare_from: '2025-10-14', compare_to: '2025-10-08' }).error);
  assert.ok(compareRange({ compare_from: '2025-02-30', compare_to: '2025-03-01' }).error);
  assert.ok(compareRange({ compare_from: '2025-10-08' }).error);
  assert.ok(compareRange({ compare: 'year' }).error);
});

test('change: absolute and percent, percent is null on a zero base', () => {
  assert.deepEqual(changeOf(150, 100), { abs: 50, pct: 50 });
  assert.deepEqual(changeOf(50, 100), { abs: -50, pct: -50 });
  assert.deepEqual(changeOf(30, 0), { abs: 30, pct: null });
  assert.deepEqual(changeOf(-20, -10), { abs: -10, pct: -100 });
  assert.deepEqual(changeOf(null, 5), { abs: null, pct: null });
  assert.deepEqual(changeOf(5, undefined), { abs: null, pct: null });
});
