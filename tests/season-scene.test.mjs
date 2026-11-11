import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeasonScene, stepSeasonScene, depositOpacity, resizeSeasonScene, seasonBudget, particlePose, depositPose } from '../src/season-scene.mjs';

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

test('winter mixes a bounded minority of larger crystals with ordinary snow grains', () => {
  for (const width of [390,1440]) {
    const scene = createSeasonScene('winter',width,1000,()=>.5);
    const crystals = scene.particles.filter(particle => particle.sprite >= 3);
    assert.ok(crystals.length / scene.particles.length >= .18 && crystals.length / scene.particles.length <= .22);
    assert.ok(crystals.some(particle => particle.sprite === 3) && crystals.some(particle => particle.sprite === 4));
    assert.ok(crystals[0].size > scene.particles[1].size);
    assert.equal(scene.particles.length,seasonBudget('winter',width).count);
  }
});

test('landing meets the existing pile and inherits the airborne pose before settling', () => {
  const scene = createSeasonScene('autumn', 1000, 700, () => .5);
  scene.particles = [scene.particles[0]];
  const particle = scene.particles[0];
  particle.x = 500; particle.y = 690;
  scene.deposits = [{ x: .5, floor: 12, size: 40, age: 0, hold: 8, fade: 24, alpha: .8 }];
  const pose = particlePose(particle, 2);
  stepSeasonScene(scene, 0, 2);
  const landed = scene.deposits[1];
  assert.equal(landed.floor, 6 + particle.size * .2 + 3);
  assert.deepEqual(depositPose(landed), pose);
  landed.age = .85;
  assert.equal(depositPose(landed).flatten, .48);
  assert.ok(Math.abs(depositPose(landed).rotation - pose.rotation) <= .175);
});
