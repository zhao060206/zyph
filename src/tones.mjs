export const TONES = [
  { id: 'pink', label: '粉', color: '#d98ca7' },
  { id: 'red', label: '红', color: '#be5c59' },
  { id: 'orange', label: '橙', color: '#ca9059' },
  { id: 'yellow', label: '黄', color: '#c9ac59' },
  { id: 'green', label: '绿', color: '#759776' },
  { id: 'cyan', label: '青', color: '#66a9a4' },
  { id: 'blue', label: '蓝', color: '#759bbe' },
  { id: 'purple', label: '紫', color: '#9a83ac' },
  { id: 'neutral', label: '黑白灰', color: '#92918e' },
];

export function validTone(tone) {
  return !!tone && tone.version === 1 && TONES.some(item => item.id === tone.group) &&
    Array.isArray(tone.palette) && tone.palette.length > 0 && tone.palette.length <= 3 &&
    tone.palette.every(color => /^#[\da-f]{6}$/i.test(color));
}

export function classifyPixels(pixels) {
  const scores = Object.fromEntries(TONES.map(tone => [tone.id, 0]));
  const colors = new Map();
  let visible = 0, chromatic = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 128) continue;
    const red = pixels[offset] / 255, green = pixels[offset + 1] / 255, blue = pixels[offset + 2] / 255;
    const high = Math.max(red, green, blue), low = Math.min(red, green, blue);
    const light = (high + low) / 2, delta = high - low;
    const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
    visible++;
    let hue = 0;
    if (delta) {
      if (high === red) hue = ((green - blue) / delta) % 6;
      else if (high === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const colorful = saturation >= .18 && light >= .07 && light <= .95;
    const group = !colorful ? 'neutral' : hue < 15 || hue >= 345 ? 'red' : hue < 45 ? 'orange' :
      hue < 70 ? 'yellow' : hue < 165 ? 'green' : hue < 195 ? 'cyan' : hue < 255 ? 'blue' : hue < 300 ? 'purple' : 'pink';
    const weight = colorful ? (.3 + saturation * .7) * (.35 + Math.sin(light * Math.PI) * .65) : .12;
    scores[group] += weight;
    if (colorful) chromatic++;
    const bucket = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => Math.min(255, Math.floor(value / 24) * 24 + 12));
    const hex = '#' + bucket.map(value => value.toString(16).padStart(2, '0')).join('');
    colors.set(hex, (colors.get(hex) || 0) + weight);
  }
  if (!visible) throw new Error('图片没有可分析的像素');
  const group = chromatic / visible < .16 ? 'neutral' : Object.keys(scores).filter(key => key !== 'neutral').sort((left, right) => scores[right] - scores[left])[0];
  return { version: 1, group, palette: [...colors].sort((left, right) => right[1] - left[1]).slice(0, 3).map(entry => entry[0]) };
}

export function resolveTone(photo, index = {}) {
  if (validTone(photo.tone)) return photo.tone;
  const saved = Object.prototype.hasOwnProperty.call(index, photo.k || photo.u) ? index[photo.k || photo.u] : null;
  return validTone(saved) ? saved : null;
}
