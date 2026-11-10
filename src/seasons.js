import { createSeasonScene, resizeSeasonScene, stepSeasonScene, depositOpacity } from './season-scene.mjs';

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
  const hero = document.querySelector('.exhibition-hero');
  let choice = storageGet('pt_season', 'auto');
  if (choice !== 'auto' && !SEASONS[choice]) choice = 'auto';
  let enabled = storageGet('pt_season_effects', 'on') !== 'off';
  let canvas = null, context = null, frame = 0, previous = 0, lastPaint = 0;
  let width = 0, height = 0, ratio = 1, scene = null, sprites = [];
  let heroBottom = 0, heroFrame = null, topbarHeight = 0, frameRadius = 0;
  let quality = 1, samples = 0, slow = 0, expensive = 0, elapsed = 0;

  function makeSprite(kind, index) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 96;
    const drawing = sprite.getContext('2d');
    drawing.scale(1.5, 1.5);
    drawing.translate(32, 32);
    if (kind === 'spring') {
      const color = drawing.createLinearGradient(-18, -20, 18, 24);
      color.addColorStop(0, ['#ffd7e7', '#ffb9d5', '#f9c6df'][index]);
      color.addColorStop(1, ['#e779a4', '#e987b7', '#d96e9e'][index]);
      drawing.fillStyle = color;
      drawing.beginPath();
      drawing.moveTo(0, 23);
      drawing.bezierCurveTo(-27, 4, -18, -25, 0, -13);
      drawing.bezierCurveTo(18, -25, 27, 4, 0, 23);
      drawing.fill();
      drawing.strokeStyle = '#b95e86'; drawing.globalAlpha = .6;
      drawing.beginPath(); drawing.moveTo(0, 20); drawing.quadraticCurveTo(6, 0, 0, -10); drawing.stroke();
    } else if (kind === 'autumn') {
      const color = drawing.createLinearGradient(-16, -25, 15, 24);
      color.addColorStop(0, ['#f5b74b', '#e7803d', '#dd6850'][index]);
      color.addColorStop(1, ['#d86d30', '#be4936', '#aa3c33'][index]);
      drawing.fillStyle = color;
      drawing.beginPath();
      const points = [[0,-28],[7,-12],[17,-19],[14,-6],[27,-7],[18,4],[24,11],[7,13],[1,27],[-2,14],[-21,12],[-16,3],[-28,-6],[-12,-5],[-17,-19],[-6,-12]];
      points.forEach(([left, top], point) => point ? drawing.lineTo(left, top) : drawing.moveTo(left, top));
      drawing.closePath(); drawing.fill();
      drawing.strokeStyle = '#87452e'; drawing.globalAlpha = .6;
      drawing.beginPath(); drawing.moveTo(0, -22); drawing.lineTo(0, 24);
      drawing.moveTo(0, 6); drawing.lineTo(-15, -8); drawing.moveTo(0, 6); drawing.lineTo(15, -8); drawing.stroke();
    } else {
      drawing.strokeStyle = index % 2 ? '#94c4e4' : '#eef8ff'; drawing.lineWidth = 2.8;
      for (let arm = 0; arm < 6; arm++) {
        drawing.rotate(Math.PI / 3);
        drawing.beginPath(); drawing.moveTo(0, 0); drawing.lineTo(0, -22);
        drawing.moveTo(0, -13); drawing.lineTo(7, -18);
        drawing.moveTo(0, -13); drawing.lineTo(-7, -18); drawing.stroke();
      }
    }
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
    if (frame) cancelAnimationFrame(frame);
    frame = previous = lastPaint = 0;
    if (canvas) { canvas.width = canvas.height = 0; canvas.remove(); }
    sprites.forEach(sprite => { sprite.width = sprite.height = 0; });
    canvas = context = scene = null; sprites = [];
  }

  function measure() {
    width = innerWidth; height = innerHeight;
    const ceiling = Math.sqrt(2000000 / (width * height));
    ratio = Math.min(devicePixelRatio || 1, 1.5, ceiling);
    canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (scene && (scene.width !== width || scene.height !== height)) scene = resizeSeasonScene(scene, width, height);
    heroBottom = !document.getElementById('archive').hidden ? Math.max(0, hero.getBoundingClientRect().bottom) : 0;
    const media = document.querySelector('.hero-media');
    const bounds = media.getBoundingClientRect();
    heroFrame = { left: bounds.left, top: bounds.top + scrollY, width: bounds.width, height: bounds.height };
    topbarHeight = document.querySelector('.topbar').offsetHeight;
    frameRadius = parseFloat(getComputedStyle(media).borderRadius) || 0;
  }

  function start() {
    canvas = document.createElement('canvas');
    canvas.className = 'season-canvas'; canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    context = canvas.getContext('2d');
    if (!context) { release(); enabled = false; return; }
    measure();
    const kind = root.dataset.season;
    sprites = kind === 'summer' ? [makeLight()] : [0, 1, 2].map(index => makeSprite(kind, index));
    scene = createSeasonScene(kind, width, height);
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
    } else if (!canvas) start();
  }

  function paintParticle(particle, x, y, rotation, alpha, flatten = 1) {
    context.save(); context.translate(x, y); context.rotate(rotation); context.scale(1, flatten);
    context.globalAlpha = alpha;
    if (scene.kind === 'summer' || scene.kind === 'winter' && particle.sprite) {
      context.fillStyle = scene.kind === 'summer' ? '#fff1b4' : '#eaf7ff';
      context.beginPath(); context.arc(0, 0, particle.size * .32, 0, Math.PI * 2); context.fill();
      if (scene.kind === 'winter') { context.strokeStyle = '#8eb9d5'; context.lineWidth = .8; context.stroke(); }
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
      stepSeasonScene(scene, delta, elapsed, quality, heroBottom <= topbarHeight);
      context.save();
      context.beginPath();
      if (heroBottom > 0 && heroFrame) {
        if (context.roundRect) context.roundRect(heroFrame.left, heroFrame.top - scrollY, heroFrame.width, heroFrame.height, frameRadius);
        else context.rect(heroFrame.left, heroFrame.top - scrollY, heroFrame.width, heroFrame.height);
      }
      const edge = Math.min(84, width * .12), from = Math.max(topbarHeight, heroBottom);
      context.rect(0, from, edge, height); context.rect(width - edge, from, edge, height);
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
        const flutter = kind === 'spring' || kind === 'autumn' ? .5 + Math.abs(Math.sin(elapsed * .8 + particle.phase)) * .5 : 1;
        paintParticle(particle, particle.x, particle.y, elapsed * particle.spin * .45 + particle.phase, particle.alpha, flutter);
      }
      context.restore();
      for (const deposit of scene.deposits) {
        const settling = Math.sin(deposit.age * 9) * Math.exp(-deposit.age * 5) * 3;
        paintParticle(deposit, deposit.x * width, height - deposit.floor + settling, deposit.rotation, depositOpacity(deposit), kind === 'winter' ? .75 : .55);
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
      window.addEventListener('scroll', () => { if (canvas) heroBottom = document.getElementById('archive').hidden ? 0 : Math.max(0, hero.getBoundingClientRect().bottom); }, { passive: true });
      apply();
    },
  };
}
