import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeasonScene, stepSeasonScene, depositOpacity, resizeSeasonScene, seasonBudget } from '../src/season-scene.mjs';

test('large leaves land at the viewport floor, form a pile and fade away when no more arrive', () => {
  const scene = createSeasonScene('autumn', 1440, 1000, () => .5);
  assert.ok(scene.particles.every(particle => particle.size >= 30));
  for (let step = 0; step < 120; step++) stepSeasonScene(scene, 1 / 30, step / 30);
  assert.ok(scene.deposits.length > 0);
  const deposit = scene.deposits[0];
  assert.ok(deposit.x >= 0 && deposit.x <= 1);
  assert.ok(deposit.floor < 70);
  const opacity = depositOpacity(deposit);
  deposit.age = deposit.hold + deposit.fade / 2;
  assert.ok(depositOpacity(deposit) < opacity);
  assert.ok(depositOpacity(deposit) > 0);
  scene.particles.length = 0;
  stepSeasonScene(scene, 45, 50);
  assert.equal(scene.deposits.length, 0);
});

test('long-running accumulation stays bounded and reduced quality lowers the pile budget', () => {
  const scene = createSeasonScene('spring', 390, 844, () => .5);
  for (let step = 0; step < 18000; step++) {
    stepSeasonScene(scene, 1 / 30, step / 30);
    assert.ok(scene.deposits.length <= 48);
  }
  assert.equal(scene.particles.length, 24);
  stepSeasonScene(scene, 1 / 30, 601, .5);
  assert.ok(scene.deposits.length <= 24);
});

test('resizing keeps deposited leaves at the bottom and respects the mobile particle budget', () => {
  const scene = createSeasonScene('autumn', 1440, 1000, () => .5);
  for (let step = 0; step < 180; step++) stepSeasonScene(scene, 1 / 30, step / 30);
  const first = scene.deposits[0];
  const resized = resizeSeasonScene(scene, 375, 812);
  assert.equal(resized.particles.length, seasonBudget('autumn', 375).count);
  assert.equal(resized.deposits[0].x, first.x);
  assert.equal(resized.deposits[0].floor, first.floor);
  assert.ok(resized.deposits.every(deposit => deposit.x * resized.width >= 0 && deposit.x * resized.width <= 375));
});

test('snow accumulates and expires, while sunlight dust never creates a solid pile', () => {
  for (const kind of ['winter', 'summer']) {
    const scene = createSeasonScene(kind, 390, 844, () => .5);
    for (let step = 0; step < 300; step++) stepSeasonScene(scene, 1 / 30, step / 30);
    assert.equal(scene.deposits.length > 0, kind === 'winter');
  }
});
