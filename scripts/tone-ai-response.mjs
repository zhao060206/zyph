import { validTone } from '../src/tones.mjs';

export function parseToneResponse(content, ids) {
  if (typeof content !== 'string') throw new Error('Model did not return textual JSON');
  const text = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const result = JSON.parse(text);
  if (!Array.isArray(result.photos) || result.photos.length !== ids.length) throw new Error('Incomplete model result');
  const expected = new Set(ids);
  for (const item of result.photos) {
    if (!item || !expected.delete(item.id) || !validTone({ ...item, version: 1 }) ||
        !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || typeof item.reason !== 'string') {
      throw new Error('Invalid model classification');
    }
  }
  return result.photos;
}

export function parseSecondaryToneResponse(content, primaries) {
  const text = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const result = JSON.parse(text);
  const expected = new Map(primaries);
  if (!Array.isArray(result.photos) || result.photos.length !== expected.size) throw new Error('Incomplete secondary result');
  for (const item of result.photos) {
    const primary = item && expected.get(item.id);
    if (!primary || typeof item.reason !== 'string' || !Array.isArray(item.groups) ||
        !validTone({ version: 1, group: primary, groups: item.groups, palette: ['#000000'] })) throw new Error('Invalid secondary classification');
    expected.delete(item.id);
  }
  return result.photos;
}
