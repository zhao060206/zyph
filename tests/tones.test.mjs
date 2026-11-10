import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPixels, resolveTone, validTone, toneGroups } from '../src/tones.mjs';
import { seasonForMonth } from '../src/seasons.js';
import { parseToneResponse, parseSecondaryToneResponse } from '../scripts/tone-ai-response.mjs';

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

test('vision classifications replace pixel estimates while explicit manual corrections still win', () => {
  const pixel = { version: 1, group: 'green', palette: ['#335533'] };
  const vision = { version: 1, group: 'neutral', palette: ['#888888'], source: 'vision' };
  assert.equal(resolveTone({ k: 'photo', tone: pixel }, { photo: vision }), vision);
  assert.equal(resolveTone({ k: 'photo', tone: { ...pixel, manual: true } }, { photo: vision }).group, 'green');
});

test('vision response mapping accepts reordered short IDs and fenced JSON', () => {
  const tone = id => ({ id, group: 'neutral', palette: ['#808080'], confidence: .8, reason: 'Gray stone' });
  const response = '```json\n' + JSON.stringify({ photos: [tone('image-2'), tone('image-1')] }) + '\n```';
  assert.deepEqual(parseToneResponse(response, ['image-1', 'image-2']).map(photo => photo.id), ['image-2', 'image-1']);
});

test('vision response mapping rejects missing, duplicate and unknown IDs', () => {
  const tone = { id: 'image-1', group: 'blue', palette: ['#224488'], confidence: .8, reason: 'Blue water' };
  assert.throws(() => parseToneResponse(JSON.stringify({ photos: [] }), ['image-1']), /Incomplete/);
  assert.throws(() => parseToneResponse(JSON.stringify({ photos: [tone, tone] }), ['image-1', 'image-2']), /Invalid/);
  assert.throws(() => parseToneResponse(JSON.stringify({ photos: [{ ...tone, id: 'unknown' }] }), ['image-1']), /Invalid/);
});

test('vision responses cannot publish unsafe colors or invalid confidence', () => {
  const tone = { id: 'image-1', group: 'blue', palette: ['#224488'], confidence: .8, reason: 'Blue water' };
  for (const invalid of [{ palette: ['url(bad)'] }, { confidence: 2 }, { confidence: 'high' }, { group: 'brown' }, { reason: null }]) {
    assert.throws(() => parseToneResponse(JSON.stringify({ photos: [{ ...tone, ...invalid }] }), ['image-1']), /Invalid/);
  }
});

test('a photograph supports one salient secondary tone without invalid or duplicate families', () => {
  const flower = { version: 1, group: 'green', groups: ['green', 'purple'], palette: ['#448844', '#aa66bb'] };
  assert.equal(validTone(flower), true);
  assert.deepEqual(toneGroups(flower), ['green', 'purple']);
  assert.deepEqual(toneGroups({ ...flower, groups: undefined }), ['green']);
  assert.deepEqual(toneGroups(null), ['pending']);
  for (const groups of [[], ['purple', 'green'], ['green', 'green'], ['green', 'purple', 'pink'], ['green', 'invalid']]) {
    assert.equal(validTone({ ...flower, groups }), false);
  }
});

test('secondary review preserves the fixed primary and validates only the secondary fields it consumes', () => {
  const response = groups => JSON.stringify({ photos: [{ id: 'image-1', groups, reason: 'Purple petals against green foliage' }] });
  assert.deepEqual(parseSecondaryToneResponse(response(['green', 'purple']), [['image-1', 'green']])[0].groups, ['green', 'purple']);
  assert.throws(() => parseSecondaryToneResponse(response(['purple', 'green']), [['image-1', 'green']]), /Invalid/);
  assert.throws(() => parseSecondaryToneResponse(response(['green', 'purple', 'pink']), [['image-1', 'green']]), /Invalid/);
  assert.throws(() => parseSecondaryToneResponse(response(['green']), [['image-2', 'green']]), /Invalid/);
});
