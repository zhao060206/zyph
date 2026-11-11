import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riverEntries, riverBudget } from '../src/photo-river.js';

test('photo river interleaves the entire catalog while preserving source identity and skipping originals', () => {
  const photo = key => ({ k: key, tn: { s: `${key}-small` } });
  const groups = [
    { d: '2025-01-01', title: 'Old', gs: [photo('b'), photo('duplicate')] },
    { d: '2026-01-01', title: 'New', gs: [photo('a'), { k: 'original-only' }, photo('duplicate'), photo('c')] },
  ];
  const entries = riverEntries(groups);
  assert.deepEqual(entries.map(entry => entry.key), ['a','b','duplicate','c']);
  assert.equal(entries[2].day, '2025-01-01');
  assert.equal(entries[3].index, 3);
  assert.equal(entries[0].photo, groups[1].gs[0]);
  assert.deepEqual(riverEntries([]), []);
});

test('river pools stay bounded on desktop, mobile and constrained devices', () => {
  assert.deepEqual(riverBudget(1440), { columns: 4, slots: 5 });
  assert.deepEqual(riverBudget(390), { columns: 3, slots: 5 });
  assert.deepEqual(riverBudget(320, true), { columns: 2, slots: 3 });
});
