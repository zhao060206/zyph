import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPixels, resolveTone, validTone } from '../src/tones.mjs';
import { seasonForMonth } from '../src/seasons.js';

function pixels(red, green, blue, count = 100) {
  return new Uint8ClampedArray(Array.from({ length: count }, () => [red, green, blue, 255]).flat());
}

test('hue classification separates the nine tone families without making white and black colorful', () => {
  const samples = { pink: [255, 90, 190], red: [220, 30, 40], orange: [240, 140, 30], yellow: [230, 210, 30],
    green: [30, 150, 60], cyan: [30, 210, 210], blue: [30, 90, 230], purple: [150, 30, 220], neutral: [200, 200, 200] };
  for (const [group, color] of Object.entries(samples)) {
    const result = classifyPixels(pixels(...color));
    assert.equal(result.group, group);
    assert.equal(validTone(result), true);
  }
  assert.equal(classifyPixels(pixels(0, 0, 0)).group, 'neutral');
  assert.equal(classifyPixels(pixels(255, 255, 255)).group, 'neutral');
});

test('colored content survives dark borders, grayscale stays neutral, and transparent files fail explicitly', () => {
  const sample = new Uint8ClampedArray([...pixels(0, 0, 0, 80), ...pixels(30, 150, 60, 20)]);
  assert.equal(classifyPixels(sample).group, 'green');
  assert.equal(classifyPixels(new Uint8ClampedArray([...pixels(100, 100, 100, 95), ...pixels(200, 20, 30, 5)])).group, 'neutral');
  assert.throws(() => classifyPixels(new Uint8ClampedArray(400)), /没有可分析/);
});

test('valid per-photo metadata overrides the index and malformed color strings never reach CSS', () => {
  const indexed = { version: 1, group: 'blue', palette: ['#3355bb'] };
  const manual = { version: 1, group: 'red', palette: ['#dd4422'], manual: true };
  assert.equal(resolveTone({ k: 'photo', tone: manual }, { photo: indexed }), manual);
  assert.equal(resolveTone({ k: 'photo', tone: { ...manual, palette: ['url(bad)'] } }, { photo: indexed }), indexed);
  assert.equal(resolveTone({ k: 'missing' }, { photo: indexed }), null);
  assert.equal(resolveTone({ k: '__proto__' }), null);
  assert.equal(validTone({ ...manual, version: 2 }), false);
});

test('automatic seasons follow all twelve northern-hemisphere calendar months', () => {
  assert.deepEqual(Array.from({ length: 12 }, (_, month) => seasonForMonth(month)),
    ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']);
});
