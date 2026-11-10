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
  let width = 0, height = 0, ratio = 1, particles = [], sprites = [];
  let heroBottom = 0, heroFrame = null, topbarHeight = 0, frameRadius = 0;
  let quality = 1, samples = 0, slow = 0, expensive = 0, elapsed = 0;

  function makeSprite(kind, index) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const drawing = sprite.getContext('2d');
    drawing.translate(32, 32);
    if (kind === 'spring') {
      drawing.fillStyle = index % 2 ? '#f2c4cf' : '#e9a4b6';
      drawing.beginPath();
      drawing.moveTo(0, 23);
      drawing.bezierCurveTo(-27, 4, -18, -25, 0, -13);
      drawing.bezierCurveTo(18, -25, 27, 4, 0, 23);
      drawing.fill();
      drawing.strokeStyle = '#bd7a8d'; drawing.globalAlpha = .4;
      drawing.beginPath(); drawing.moveTo(0, 20); drawing.quadraticCurveTo(6, 0, 0, -10); drawing.stroke();
    } else if (kind === 'autumn') {
      drawing.fillStyle = ['#b86243', '#d5a14c', '#a44d42'][index % 3];
      drawing.beginPath();
      const points = [[0,-28],[7,-12],[17,-19],[14,-6],[27,-7],[18,4],[24,11],[7,13],[1,27],[-2,14],[-21,12],[-16,3],[-28,-6],[-12,-5],[-17,-19],[-6,-12]];
      points.forEach(([left, top], point) => point ? drawing.lineTo(left, top) : drawing.moveTo(left, top));
      drawing.closePath(); drawing.fill();
      drawing.strokeStyle = '#693e31'; drawing.globalAlpha = .4;
      drawing.beginPath(); drawing.moveTo(0, -22); drawing.lineTo(0, 24); drawing.stroke();
    } else {
      drawing.strokeStyle = '#e5f2ff'; drawing.lineWidth = 2;
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
    across.addColorStop(0, 'rgba(255,245,203,0)'); across.addColorStop(.5, 'rgba(255,245,203,.14)'); across.addColorStop(1, 'rgba(255,245,203,0)');
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
    canvas = context = null; sprites = []; particles = [];
  }

  function measure() {
    width = innerWidth; height = innerHeight;
    const ceiling = Math.sqrt(2000000 / (width * height));
    ratio = Math.min(devicePixelRatio || 1, 1.5, ceiling);
    canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
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
    const count = width < 760 ? 16 : 32;
    particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width, y: Math.random() * height, phase: Math.random() * Math.PI * 2,
      size: kind === 'winter' ? 2 + Math.random() * 5 : 8 + Math.random() * 12,
      speed: 12 + Math.random() * 25, spin: Math.random() * 2 - 1, sprite: index % 3,
    }));
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
      context.save();
      context.beginPath();
      if (heroBottom > 0 && heroFrame) {
        if (context.roundRect) context.roundRect(heroFrame.left, heroFrame.top - scrollY, heroFrame.width, heroFrame.height, frameRadius);
        else context.rect(heroFrame.left, heroFrame.top - scrollY, heroFrame.width, heroFrame.height);
      }
      const edge = Math.min(34, width * .035), from = Math.max(74, heroBottom);
      context.rect(0, from, edge, height); context.rect(width - edge, from, edge, height);
      context.clip();
      context.clearRect(0, 0, width, topbarHeight);
      if (kind === 'summer') {
        for (let beam = 0; beam < (quality === 1 ? 3 : 1); beam++) {
          context.save();
          context.translate(width * .85, -100); context.rotate(.3 + beam * .22 + Math.sin(elapsed * .12) * .035);
          context.drawImage(sprites[0], -width * .12, 0, width * .24, height * 1.4);
          context.restore();
        }
      } else {
        const density = heroBottom > topbarHeight ? 1 : .4;
        for (let index = 0; index < Math.floor(particles.length * quality * density); index++) {
          const particle = particles[index];
          particle.y += particle.speed * delta; particle.x += Math.sin(elapsed * .5 + particle.phase) * delta * 11;
          if (particle.y > height + 25) { particle.y = -25; particle.x = Math.random() * width; }
          context.save(); context.translate(particle.x, particle.y);
          context.rotate(elapsed * particle.spin * .4 + particle.phase);
          context.globalAlpha = kind === 'winter' ? .65 : .48;
          if (kind === 'winter' && index % 4) {
            context.fillStyle = '#f0f7ff'; context.beginPath(); context.arc(0, 0, particle.size * .4, 0, Math.PI * 2); context.fill();
          } else {
            context.scale(Math.max(.25, Math.abs(Math.sin(elapsed * .7 + particle.phase))), 1);
            context.drawImage(sprites[particle.sprite], -particle.size / 2, -particle.size / 2, particle.size, particle.size);
          }
          context.restore();
        }
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
      new MutationObserver(() => { sync(); updateThemeColor(); }).observe(root, { attributes: true, attributeFilter: ['data-dialog-open', 'data-theme'] });
      new MutationObserver(() => { if (canvas) measure(); }).observe(document.getElementById('archive'), { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('resize', () => { if (canvas) measure(); }, { passive: true });
      window.addEventListener('scroll', () => { if (canvas) heroBottom = document.getElementById('archive').hidden ? 0 : Math.max(0, hero.getBoundingClientRect().bottom); }, { passive: true });
      apply();
    },
  };
}
