import { createSeasonScene, resizeSeasonScene, stepSeasonScene, depositOpacity, particlePose, depositPose, seasonSafeEdge } from './season-scene.mjs';

export const SEASONS = {
  spring: { label: '春', accent: '#e7a7b6', groups: ['pink', 'green'] },
  summer: { label: '夏', accent: '#80bca4', groups: ['green', 'cyan'] },
  autumn: { label: '秋', accent: '#dba15e', groups: ['orange', 'yellow', 'red'] },
  winter: { label: '冬', accent: '#bbd3e9', groups: ['blue', 'neutral'] },
};

export function seasonForMonth(month) {
  return month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter';
}

export function createSeasons({ Motion, storageGet, storageSet }) {
  const root = document.documentElement;
  const select = document.getElementById('seasonSelect');
  const toggle = document.getElementById('seasonEffects');
  let choice = storageGet('pt_season', 'auto');
  if (choice !== 'auto' && !SEASONS[choice]) choice = 'auto';
  let enabled = storageGet('pt_season_effects', 'on') !== 'off';
  let canvas = null, context = null, frame = 0, previous = 0, lastPaint = 0;
  let width = 0, height = 0, ratio = 1, scene = null, sprites = [];
  let topbarHeight = 0, generation = 0, starting = false;
  let quality = 1, samples = 0, slow = 0, expensive = 0, elapsed = 0;
  const isDark = () => root.dataset.theme === 'dark';
  let activeTheme = isDark() ? 'dark' : 'bright';

  function createCanvas(size, heightSize = size) {
    const offscreen = document.createElement('canvas');
    offscreen.width = size; offscreen.height = heightSize;
    return [offscreen, offscreen.getContext('2d')];
  }

  function boostTexturePixels(drawing, size, kind, dark) {
    const img = drawing.getImageData(0, 0, size, size);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (!a) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (kind === 'spring') {
        const sat = dark ? 1.12 : 1.64;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        if (!dark) {
          const palePull = l > 165 ? 0.30 : 0.16;
          r = r * (1 - palePull) + 226 * palePull;
          g = g * (1 - palePull) + 124 * palePull;
          b = b * (1 - palePull) + 158 * palePull;
          data[i + 3] = Math.min(255, Math.round(a * 1.12));
        }
      } else if (kind === 'autumn') {
        const sat = dark ? 1.10 : 1.32;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        if (!dark) {
          const contrast = 1.18;
          r = (128 + (r - 128) * contrast) * 1.04;
          g = (128 + (g - 128) * contrast) * 0.96;
          b = (128 + (b - 128) * contrast) * 0.86;
          data[i + 3] = Math.min(255, Math.round(a * 1.08));
        } else {
          r *= 1.08; g *= 1.05; b *= 1.03;
        }
      }
      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
    drawing.putImageData(img, 0, 0);
  }

  function makeBotanicalSprite(image, kind, dark) {
    const size = 96;
    const [work, workCtx] = createCanvas(size);
    workCtx.drawImage(image, 6, 6, size - 12, size - 12);
    boostTexturePixels(workCtx, size, kind, dark);
    const [sprite, drawing] = createCanvas(size);
    if (!dark) {
      drawing.shadowColor = kind === 'spring' ? 'rgba(108,66,60,.30)' : 'rgba(72,38,16,.36)';
      drawing.shadowBlur = kind === 'spring' ? 4.4 : 4.2;
      drawing.shadowOffsetX = 1.5; drawing.shadowOffsetY = 2.5;
      drawing.drawImage(work, 0, 0);
      if (kind === 'spring') {
        drawing.shadowColor = 'rgba(216,118,150,.40)';
        drawing.shadowBlur = 2.0; drawing.shadowOffsetX = 0; drawing.shadowOffsetY = 0;
        drawing.drawImage(work, 0, 0);
      }
    } else {
      drawing.drawImage(work, 0, 0);
    }
    work.width = work.height = 0;
    return sprite;
  }

  async function makeSprite(kind, index, dark) {
    if (kind !== 'winter') {
      const image = new Image();
      image.src = `/assets/season/${kind}-${index}.webp`;
      await image.decode();
      return makeBotanicalSprite(image, kind, dark);
    }
    // A small proportion of larger six-armed crystals complements the softer snow grains.
    if (index >= 3) {
      const [sprite, drawing] = createCanvas(96);
      drawing.translate(48, 48);
      const crystal = () => {
        drawing.beginPath();
        for (let arm = 0; arm < 6; arm++) {
          drawing.save(); drawing.rotate(arm * Math.PI / 3);
          drawing.moveTo(0, 0); drawing.lineTo(0, -37);
          for (const branch of index === 3 ? [18, 28] : [15, 25, 32]) {
            const reach = branch > 28 ? 5 : 9;
            drawing.moveTo(0, -branch); drawing.lineTo(-reach, -branch - reach);
            drawing.moveTo(0, -branch); drawing.lineTo(reach, -branch - reach);
          }
          drawing.restore();
        }
        for (let corner = 0; corner < 6; corner++) {
          const angle = corner * Math.PI / 3;
          const x = Math.sin(angle) * 12, y = -Math.cos(angle) * 12;
          if (corner) drawing.lineTo(x, y); else drawing.moveTo(x, y);
        }
        drawing.closePath();
        drawing.stroke();
      };
      drawing.lineCap = drawing.lineJoin = 'round';
      if (!dark) {
        drawing.shadowColor = 'rgba(34,66,108,.34)'; drawing.shadowBlur = 4.0;
        drawing.shadowOffsetX = 1.0; drawing.shadowOffsetY = 1.8;
        drawing.strokeStyle = 'rgba(42,84,136,.86)'; drawing.lineWidth = 3.2; crystal();
        drawing.shadowBlur = 0; drawing.shadowOffsetX = 0; drawing.shadowOffsetY = 0;
        drawing.strokeStyle = 'rgba(108,156,208,.72)'; drawing.lineWidth = 2.0; crystal();
        drawing.strokeStyle = 'rgba(255,255,255,.98)'; drawing.lineWidth = 1.2; crystal();
      } else {
        drawing.strokeStyle = 'rgba(116,154,192,.36)'; drawing.lineWidth = 2.0; crystal();
        drawing.strokeStyle = 'rgba(248,252,255,.94)'; drawing.lineWidth = 1.2; crystal();
      }
      return sprite;
    }
    // Small irregular snow clusters, shaded across their surface rather than outlined in dark mode.
    const [sprite, drawing] = createCanvas(64);
    const radius = 19 + index * 2.5;
    drawing.translate(32, 32); drawing.scale(1, .83 + index * .07);
    const gradient = drawing.createLinearGradient(-radius, -radius, radius, radius);
    if (!dark) {
      gradient.addColorStop(0, 'rgba(255,255,255,.99)');
      gradient.addColorStop(.38, 'rgba(218,238,255,.97)');
      gradient.addColorStop(.76, 'rgba(136,184,232,.94)');
      gradient.addColorStop(1, 'rgba(78,132,188,.90)');
      drawing.shadowColor = 'rgba(34,70,116,.38)'; drawing.shadowBlur = 4.2;
      drawing.shadowOffsetX = 1.0; drawing.shadowOffsetY = 1.8;
    } else {
      gradient.addColorStop(0, 'rgba(255,255,255,.98)');
      gradient.addColorStop(.6, 'rgba(235,245,254,.92)');
      gradient.addColorStop(1, 'rgba(176,207,235,.70)');
      drawing.shadowColor = 'rgba(98,136,174,.20)'; drawing.shadowBlur = 2 + index * .5;
    }
    drawing.fillStyle = gradient;
    drawing.beginPath();
    for (let point = 0; point < 16; point++) {
      const angle = point / 16 * Math.PI * 2;
      const edge = radius * (.76 + Math.sin(point * 2.7 + index) * .13 + Math.cos(point * 1.3) * .1);
      const x = Math.cos(angle) * edge, y = Math.sin(angle) * edge;
      if (point) drawing.lineTo(x, y); else drawing.moveTo(x, y);
    }
    drawing.closePath(); drawing.fill();
    drawing.shadowBlur = 0; drawing.shadowOffsetX = 0; drawing.shadowOffsetY = 0;
    drawing.strokeStyle = dark ? 'rgba(130,164,198,.12)' : 'rgba(42,84,136,.56)';
    drawing.lineWidth = dark ? .7 : 1.15;
    drawing.stroke();
    return sprite;
  }

  function makeLight(dark) {
    const [sprite, drawing] = createCanvas(128, 512);
    const across = drawing.createLinearGradient(0, 0, 128, 0);
    if (!dark) {
      across.addColorStop(0, 'rgba(56,120,98,0)');
      across.addColorStop(.14, 'rgba(62,128,106,.085)');
      across.addColorStop(.30, 'rgba(182,148,58,.14)');
      across.addColorStop(.50, 'rgba(210,158,42,.34)');
      across.addColorStop(.70, 'rgba(182,148,58,.14)');
      across.addColorStop(.86, 'rgba(62,128,106,.085)');
      across.addColorStop(1, 'rgba(56,120,98,0)');
    } else {
      across.addColorStop(0, 'rgba(255,245,203,0)');
      across.addColorStop(.5, 'rgba(255,245,203,.18)');
      across.addColorStop(1, 'rgba(255,245,203,0)');
    }
    drawing.fillStyle = across; drawing.fillRect(0, 0, 128, 512);
    drawing.globalCompositeOperation = 'destination-in';
    const length = drawing.createLinearGradient(0, 0, 0, 512);
    length.addColorStop(0, dark ? '#fff' : 'rgba(255,255,255,.94)');
    if (!dark) length.addColorStop(.55, 'rgba(255,255,255,.68)');
    length.addColorStop(1, 'transparent');
    drawing.fillStyle = length; drawing.fillRect(0, 0, 128, 512);
    return sprite;
  }

  function release() {
    generation++; starting = false;
    if (frame) cancelAnimationFrame(frame);
    frame = previous = lastPaint = 0;
    if (canvas) { canvas.width = canvas.height = 0; canvas.remove(); }
    sprites.forEach(sprite => { if (sprite instanceof HTMLCanvasElement) sprite.width = sprite.height = 0; });
    canvas = context = scene = null; sprites = [];
  }

  function measure() {
    width = innerWidth; height = innerHeight;
    const ceiling = Math.sqrt(2000000 / (width * height));
    ratio = Math.min(devicePixelRatio || 1, 1.5, ceiling);
    canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (scene && (scene.width !== width || scene.height !== height)) scene = resizeSeasonScene(scene, width, height);
    topbarHeight = document.querySelector('.topbar').offsetHeight;
  }

  async function start() {
    starting = true;
    const token = ++generation, kind = root.dataset.season, dark = isDark();
    activeTheme = dark ? 'dark' : 'bright';
    let materials;
    try {
      materials = kind === 'summer' ? [makeLight(dark)] : await Promise.all((kind === 'winter' ? [0,1,2,3,4] : [0,1,2]).map(index => makeSprite(kind, index, dark)));
    } catch (error) {
      if (token === generation) { starting = false; root.dataset.seasonEffects = 'unavailable'; console.error('Season material failed to load', error); }
      return;
    }
    if (token !== generation || !canRun() || root.dataset.season !== kind || (isDark() ? 'dark' : 'bright') !== activeTheme) {
      materials.forEach(sprite => { if (sprite instanceof HTMLCanvasElement) sprite.width = sprite.height = 0; });
      return;
    }
    starting = false; sprites = materials;
    canvas = document.createElement('canvas');
    canvas.className = 'season-canvas'; canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    context = canvas.getContext('2d');
    if (!context) { release(); enabled = false; return; }
    measure(); scene = createSeasonScene(kind, width, height);
    root.dataset.seasonEffects = 'running';
    frame = requestAnimationFrame(draw);
  }

  function canRun() {
    return enabled && Motion.tier === 'full' && !document.hidden && root.dataset.dialogOpen !== 'true';
  }

  function sync() {
    if (!canRun()) {
      release();
      root.dataset.seasonEffects = !enabled ? 'off' : document.hidden || root.dataset.dialogOpen === 'true' ? 'paused' : 'static';
    } else if (!canvas && !starting) start();
  }

  function resolveAlpha(kind, baseAlpha, dark) {
    if (dark) return baseAlpha;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    if (kind === 'spring') return clamp(.78 + ((baseAlpha - .54) / .16) * .18, .78, .96);
    if (kind === 'autumn') return clamp(.78 + ((baseAlpha - .34) / .18) * .18, .78, .96);
    if (kind === 'winter') return clamp(.74 + ((baseAlpha - .54) / .16) * .20, .74, .94);
    if (kind === 'summer') return clamp(.76 + ((baseAlpha - .45) / .20) * .19, .76, .95);
    return baseAlpha;
  }

  function paintParticle(particle, x, y, rotation, alpha, flatten = 1, dark = isDark()) {
    context.save(); context.translate(x, y); context.rotate(rotation); context.scale(1, flatten);
    context.globalAlpha = alpha;
    if (scene.kind === 'summer') {
      const r = particle.size * .36;
      if (!dark) {
        context.fillStyle = 'rgba(222,168,42,.20)';
        context.beginPath(); context.arc(0, 0, particle.size * .92, 0, Math.PI * 2); context.fill();
        context.fillStyle = 'rgba(212,154,32,.34)';
        context.beginPath(); context.arc(0, 0, particle.size * .62, 0, Math.PI * 2); context.fill();
        context.fillStyle = particle.sprite === 1 ? '#208c64' : particle.sprite === 2 ? '#df9a1e' : '#c97b12';
        context.beginPath(); context.arc(0, 0, r, 0, Math.PI * 2); context.fill();
        context.fillStyle = 'rgba(255,248,218,.86)';
        context.beginPath(); context.arc(-r * .22, -r * .22, r * .36, 0, Math.PI * 2); context.fill();
      } else {
        context.fillStyle = 'rgba(255,232,150,.18)';
        context.beginPath(); context.arc(0, 0, particle.size * .72, 0, Math.PI * 2); context.fill();
        context.fillStyle = particle.sprite === 1 ? '#88dfc0' : '#ffe99d';
        context.beginPath(); context.arc(0, 0, particle.size * .34, 0, Math.PI * 2); context.fill();
        context.fillStyle = 'rgba(255,252,232,.72)';
        context.beginPath(); context.arc(-r * .2, -r * .2, r * .32, 0, Math.PI * 2); context.fill();
      }
    } else {
      context.drawImage(sprites[particle.sprite], -particle.size / 2, -particle.size / 2, particle.size, particle.size);
    }
    context.restore();
  }

  function draw(time) {
    frame = 0;
    if (!canRun()) { sync(); return; }
    if (previous) { samples++; if (time - previous > 50) slow++; }
    previous = time;
    if (samples >= 60) {
      if (slow / samples > .3 || expensive > 12) {
        if (quality === 1) { quality = .5; root.dataset.seasonQuality = 'reduced'; }
        else { Motion.downgrade('season-frame-pressure'); return; }
      }
      samples = slow = expensive = 0;
    }
    const interval = 1000 / (width < 760 ? 24 : 30);
    if (!lastPaint || time - lastPaint >= interval) {
      const begin = performance.now();
      const delta = Math.min((time - (lastPaint || time)) / 1000, .08);
      lastPaint = time; elapsed += delta;
      context.clearRect(0, 0, width, height);
      const kind = root.dataset.season, dark = isDark();
      const heroEl = document.querySelector('.exhibition-hero');
      const groupEl = document.getElementById('groupPage');
      const edgeOnly = (groupEl && !groupEl.hidden) || window.scrollY > Math.max(220, (heroEl?.offsetHeight || 560) * .48);
      stepSeasonScene(scene, delta, elapsed, quality, edgeOnly);
      context.save();
      context.beginPath();
      context.rect(0, topbarHeight, width, height - topbarHeight);
      context.clip();
      if (kind === 'summer') {
        context.save();
        if (edgeOnly) context.globalAlpha = .45;
        for (let beam = 0; beam < (quality === 1 ? 3 : 1); beam++) {
          context.save();
          context.translate(width * .85, -100); context.rotate(.3 + beam * .22 + Math.sin(elapsed * .08) * .035);
          context.drawImage(sprites[0], -width * .12, 0, width * .24, height * 1.4);
          context.restore();
        }
        context.restore();
      }
      const safeEdge = seasonSafeEdge(width, edgeOnly);
      const mobileFactor = width < 760 ? .5 : 1;
      const edgeOpacity = (x, baseAlpha) => {
        if (!edgeOnly || x <= safeEdge || x >= width - safeEdge) return baseAlpha;
        const dist = Math.min(x - safeEdge, width - safeEdge - x);
        return dist > 14 ? 0 : baseAlpha * Math.max(0, 1 - dist / 14);
      };
      for (let index = 0; index < Math.floor(scene.particles.length * quality); index++) {
        const particle = scene.particles[index];
        const baseAlpha = resolveAlpha(scene.kind, particle.alpha, dark);
        let alpha = edgeOpacity(particle.x, baseAlpha * (edgeOnly ? mobileFactor : 1));
        if (!edgeOnly) {
          if (width >= 900 && particle.x < width * .34 && particle.y < height * .82) {
            const xFactor = Math.max(0, Math.min(1, (particle.x - width * .25) / (width * .09)));
            const yFactor = particle.y > height * .70 ? Math.max(0, Math.min(1, (height * .82 - particle.y) / (height * .12))) : 1;
            alpha *= 1 - (1 - xFactor) * yFactor;
          } else if (width < 900 && particle.y < height * .36) {
            const yFactor = Math.max(0, Math.min(1, (particle.y - height * .26) / (height * .10)));
            alpha *= yFactor;
          }
        }
        if (alpha <= .005) continue;
        const pose = particlePose(particle, elapsed);
        paintParticle(particle, particle.x, particle.y, pose.rotation, alpha, pose.flatten, dark);
      }
      for (const deposit of scene.deposits) {
        const depX = deposit.x * width;
        const depositScale = deposit.alpha > 0 ? resolveAlpha(scene.kind, deposit.alpha, dark) / deposit.alpha : 1;
        const alpha = edgeOpacity(depX, depositOpacity(deposit) * depositScale * (edgeOnly ? mobileFactor : 1));
        if (alpha <= .005) continue;
        const pose = depositPose(deposit);
        paintParticle(deposit, depX, height - deposit.floor, pose.rotation, alpha, pose.flatten, dark);
      }
      context.restore();
      if (performance.now() - begin > 6) expensive++;
    }
    frame = requestAnimationFrame(draw);
  }

  function apply() {
    release(); quality = 1; samples = slow = expensive = 0;
    root.dataset.seasonQuality = 'full';
    root.dataset.season = choice === 'auto' ? seasonForMonth(new Date().getMonth()) : choice;
    select.value = choice;
    document.dispatchEvent(new CustomEvent('season:change', { detail: { season: root.dataset.season } }));
    updateThemeColor(); sync();
  }

  function updateThemeColor() {
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }

  return {
    start() {
      document.querySelector('.nav-end').prepend(document.querySelector('.season-controls'));
      select.addEventListener('change', () => { choice = select.value; storageSet('pt_season', choice); apply(); });
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.addEventListener('click', () => {
        enabled = !enabled; storageSet('pt_season_effects', enabled ? 'on' : 'off');
        toggle.setAttribute('aria-pressed', String(enabled)); sync();
      });
      document.addEventListener('motion:change', sync);
      document.addEventListener('visibilitychange', () => { if (choice === 'auto' && root.dataset.season !== seasonForMonth(new Date().getMonth())) apply(); else sync(); });
      new MutationObserver(records => {
        const current = isDark() ? 'dark' : 'bright';
        if (records.some(record => record.attributeName === 'data-theme') && current !== activeTheme) {
          release();
        }
        sync(); updateThemeColor();
      }).observe(root, { attributes: true, attributeFilter: ['data-dialog-open', 'data-theme'] });
      new MutationObserver(() => { if (canvas) measure(); }).observe(document.getElementById('archive'), { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('resize', () => { if (canvas) measure(); }, { passive: true });
      apply();
    },
  };
}
