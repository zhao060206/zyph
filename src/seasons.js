import { createSeasonScene, resizeSeasonScene, stepSeasonScene, depositOpacity, particlePose, depositPose } from './season-scene.mjs';

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

  async function makeSprite(kind, index) {
    if (kind !== 'winter') {
      const image = new Image();
      image.src = `/assets/season/${kind}-${index}.webp`;
      await image.decode();
      return image;
    }
    // A small proportion of larger six-armed crystals complements the softer snow grains.
    if (index >= 3) {
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = 96;
      const drawing = sprite.getContext('2d');
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
        drawing.stroke();
      };
      drawing.lineCap = drawing.lineJoin = 'round';
      drawing.strokeStyle = 'rgba(91,129,164,.75)'; drawing.lineWidth = 4.5; crystal();
      drawing.strokeStyle = '#f8fcff'; drawing.lineWidth = 2.6; crystal();
      return sprite;
    }
    // Small irregular snow clusters, shaded across their surface rather than outlined.
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const drawing = sprite.getContext('2d');
    const radius = 20 + index * 3;
    drawing.translate(32,32); drawing.scale(1,.83 + index*.07);
    const gradient = drawing.createLinearGradient(-radius, -radius, radius, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,.98)');
    gradient.addColorStop(.6, 'rgba(245,250,255,.94)');
    gradient.addColorStop(1, 'rgba(198,221,239,.65)');
    drawing.fillStyle = gradient;
    drawing.shadowColor = 'rgba(219,235,248,.5)'; drawing.shadowBlur = 2 + index;
    drawing.beginPath();
    for (let point = 0; point < 16; point++) {
      const angle = point / 16 * Math.PI * 2;
      const edge = radius * (.76 + Math.sin(point * 2.7 + index) * .13 + Math.cos(point * 1.3) * .1);
      const x = Math.cos(angle) * edge, y = Math.sin(angle) * edge;
      if (point) drawing.lineTo(x,y); else drawing.moveTo(x,y);
    }
    drawing.closePath(); drawing.fill();
    return sprite;
  }

  function makeLight() {
    const sprite = document.createElement('canvas');
    sprite.width = 128; sprite.height = 512;
    const drawing = sprite.getContext('2d');
    const across = drawing.createLinearGradient(0, 0, 128, 0);
    across.addColorStop(0, 'rgba(255,245,203,0)'); across.addColorStop(.5, 'rgba(255,245,203,.25)'); across.addColorStop(1, 'rgba(255,245,203,0)');
    drawing.fillStyle = across; drawing.fillRect(0, 0, 128, 512);
    drawing.globalCompositeOperation = 'destination-in';
    const length = drawing.createLinearGradient(0, 0, 0, 512);
    length.addColorStop(0, '#fff'); length.addColorStop(1, 'transparent');
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
    const token = ++generation, kind = root.dataset.season;
    let materials;
    try {
      materials = kind === 'summer' ? [makeLight()] : await Promise.all((kind === 'winter' ? [0,1,2,3,4] : [0,1,2]).map(index => makeSprite(kind,index)));
    } catch (error) {
      if (token === generation) { starting = false; root.dataset.seasonEffects = 'unavailable'; console.error('Season material failed to load', error); }
      return;
    }
    if (token !== generation || !canRun() || root.dataset.season !== kind) {
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

  function paintParticle(particle, x, y, rotation, alpha, flatten = 1) {
    context.save(); context.translate(x, y); context.rotate(rotation); context.scale(1, flatten);
    context.globalAlpha = alpha;
    if (scene.kind === 'summer') {
      context.fillStyle = scene.kind === 'summer' ? '#fff1b4' : '#eaf7ff';
      context.beginPath(); context.arc(0, 0, particle.size * .32, 0, Math.PI * 2); context.fill();
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
      const kind = root.dataset.season;
      stepSeasonScene(scene, delta, elapsed, quality);
      context.save();
      context.beginPath();
      context.rect(0, topbarHeight, width, height - topbarHeight);
      context.clip();
      if (kind === 'summer') {
        for (let beam = 0; beam < (quality === 1 ? 3 : 1); beam++) {
          context.save();
          context.translate(width * .85, -100); context.rotate(.3 + beam * .22 + Math.sin(elapsed * .12) * .035);
          context.drawImage(sprites[0], -width * .12, 0, width * .24, height * 1.4);
          context.restore();
        }
      }
      for (let index = 0; index < Math.floor(scene.particles.length * quality); index++) {
        const particle = scene.particles[index];
        const pose = particlePose(particle, elapsed);
        paintParticle(particle, particle.x, particle.y, pose.rotation, particle.alpha, pose.flatten);
      }
      context.restore();
      for (const deposit of scene.deposits) {
        const pose = depositPose(deposit);
        paintParticle(deposit, deposit.x * width, height - deposit.floor, pose.rotation, depositOpacity(deposit), pose.flatten);
      }
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
      new MutationObserver(() => { sync(); updateThemeColor(); }).observe(root, { attributes: true, attributeFilter: ['data-dialog-open', 'data-theme'] });
      new MutationObserver(() => { if (canvas) measure(); }).observe(document.getElementById('archive'), { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('resize', () => { if (canvas) measure(); }, { passive: true });
      apply();
    },
  };
}
