const { test, expect } = require('@playwright/test');
const bucket = 'https://zhao-1465501838.cos.ap-nanjing.myqcloud.com';
const sampleImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const groups = [
  { d: '2026-03-01', title: '春日武汉', loc: '武汉', gs: Array.from({ length: 15 }, (_, index) => ({ t: `花园 ${index + 1}`, k: `photos/garden-${index}.jpg`, tn: { s: `photos/garden-${index}-s.jpg`, v: `photos/garden-${index}-v.jpg` }, ...(index === 0 ? { tone: { version: 1, group: 'green', palette: ['#448855'] } } : {}) })) },
  { d: '2025-06-02', title: '海边杭州', loc: '杭州', gs: Array.from({ length: 16 }, (_, index) => ({ t: `海边 ${index + 1}`, k: `photos/sea-${index}.jpg`, tn: { s: `photos/sea-${index}-s.jpg`, v: `photos/sea-${index}-v.jpg` } })) },
];
const photos = Object.fromEntries(groups.flatMap(group => group.gs.map((photo, index) => [photo.k, { version: 1, group: group.d.startsWith('2026') ? 'red' : 'blue', palette: ['#5588aa'] }])));
delete photos['photos/sea-15.jpg'];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
  });
  await page.route(bucket + '/**', route => {
    if (route.request().url().endsWith('data.json')) return route.fulfill({ json: { groups } });
    if (route.request().url().endsWith('music.json')) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: 'image/png', body: sampleImage });
  });
  await page.route('**/assets/tone-index.json', route => route.fulfill({ json: { version: 1, photos } }));
});

test('calendar defaults, manual seasons, dark mode and storage remember independent preferences', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-04-12T12:00:00+08:00'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-season', 'spring');
  await page.locator('#seasonSelect').selectOption('winter');
  await page.locator('#themeBtn').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-season', 'winter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#seasonSelect').selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('data-season', 'spring');
  await page.clock.setFixedTime(new Date('2026-07-12T12:00:00+08:00')); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-season', 'summer');
});

test('single effects canvas pauses for dialogs, respects budget and releases buffers on opt-out', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'running');
  expect(await page.locator('.season-canvas').evaluate(canvas => canvas.width * canvas.height)).toBeLessThanOrEqual(2000000);
  await page.locator('.album-cover').first().click();
  await page.locator('.gp-preview-item').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'paused');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.season-canvas')).toHaveCount(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'paused');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.season-canvas')).toHaveCount(1);
  await page.locator('#seasonEffects').click();
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'off');
  await page.locator('#seasonEffects').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
});

test('tone view combines individual photos, applies metadata precedence, paginates and preserves album sheets', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-toggle-sheet="2026-03-01"]').click();
  await page.locator('[data-gallery-mode=tone]').click();
  await expect(page.locator('.tone-card')).toHaveCount(24);
  await page.locator('#toneMore').click();
  await expect(page.locator('.tone-card')).toHaveCount(31);
  await page.locator('[data-tone=red]').click();
  await expect(page.locator('.tone-card')).toHaveCount(14);
  await page.locator('.tone-photo').first().click();
  await expect(page.locator('#lbTitle')).toHaveText('花园 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tone-photo').first()).toBeFocused();
  await page.locator('[data-tone=green]').click();
  await expect(page.locator('.tone-card')).toHaveCount(1);
  await page.locator('.tone-source').click();
  await expect(page.locator('#gpTitle')).toHaveText('春日武汉');
  await page.locator('#gpBack').click();
  await page.locator('[data-tone=blue]').click();
  await page.locator('#archiveSearch').fill('杭州');
  await expect(page.locator('.tone-card')).toHaveCount(15);
  await page.locator('#yearFilter').selectOption('2026');
  await expect(page.locator('.tone-card')).toHaveCount(0);
  await page.locator('#archiveSearch').fill('');
  await page.locator('#yearFilter').selectOption('');
  await page.locator('[data-gallery-mode=archive]').click();
  await expect(page.locator('[data-toggle-sheet="2026-03-01"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.contact-sheet')).toHaveCount(1);
});

test('pending selection returns to all when the delayed complete index arrives', async ({ page }) => {
  let deliver;
  const ready = new Promise(resolve => { deliver = resolve; });
  await page.route('**/assets/tone-index.json', async route => {
    await ready;
    await route.fulfill({ json: { version: 1, photos: { ...photos, 'photos/sea-15.jpg': { version: 1, group: 'blue', palette: ['#5588aa'] } } } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.locator('[data-gallery-mode=tone]').click();
  await page.locator('[data-tone=pending]').click();
  await expect(page.locator('[data-tone=pending]')).toHaveAttribute('aria-pressed', 'true');
  deliver();
  await expect(page.locator('[data-tone=pending]')).toHaveCount(0);
  await expect(page.locator('[data-tone=all]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#resultCount')).toHaveText('31 张作品');
  await expect(page.locator('.tone-card')).toHaveCount(24);
});

test('missing index and unavailable storage keep photos accessible in pending classification', async ({ page }) => {
  await page.route('**/assets/tone-index.json', route => route.fulfill({ status: 503 }));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('unavailable'); };
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#seasonSelect').selectOption('summer');
  await page.locator('[data-gallery-mode=tone]').click();
  await page.locator('[data-tone=pending]').click();
  await expect(page.locator('#resultCount')).toHaveText('待归类 · 30 张作品');
  await page.locator('.tone-photo').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mixed-color photographs appear in both relevant tones without duplicates in all', async ({ page }) => {
  await page.route('**/assets/tone-index.json', route => route.fulfill({ json: { version: 1, photos: {
    ...photos, 'photos/sea-0.jpg': { version: 1, group: 'blue', groups: ['blue', 'pink'], source: 'vision', palette: ['#3366bb', '#dd99bb'] },
  } } }));
  await page.goto('/');
  await page.locator('[data-gallery-mode=tone]').click();
  await page.locator('[data-tone=pink]').click();
  await expect(page.locator('.tone-card')).toHaveCount(1);
  await expect(page.locator('.tone-caption h3')).toHaveText('海边 1');
  await page.locator('[data-tone=blue]').click();
  await expect(page.locator('.tone-card')).toHaveCount(15);
  await page.locator('[data-tone=all]').click();
  await page.locator('#toneMore').click();
  await expect(page.locator('.tone-card')).toHaveCount(31);
  await expect(page.locator('.tone-caption h3').filter({ hasText: /^海边 1$/ })).toHaveCount(1);
});

test('low hardware budgets skip canvas and disable expensive visual filters', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'static');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  expect(await page.locator('.topbar').evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none');
  await page.locator('#seasonSelect').selectOption('spring');
  await expect(page.locator('html')).toHaveAttribute('data-season', 'spring');
});

test('scrolling color swatches keeps the viewport bounded and header controls clickable', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-gallery-mode=tone]').click();
  const viewport = page.viewportSize().width;
  await page.locator('#toneFilters').evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport);
  expect(await page.evaluate(() => innerWidth)).toBe(viewport);
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#seasonEffects').click();
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  await page.locator('[data-tone=green]').click();
  await page.locator('.tone-source').click();
  await expect(page.locator('#gpTitle')).toHaveText('春日武汉');
});

test('sustained slow season frames reduce density then downgrade and release the engine', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFrame = window.requestAnimationFrame.bind(window);
    let syntheticTime = 0;
    window.requestAnimationFrame = callback => originalFrame(() => callback(syntheticTime += 80));
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-season-quality', 'reduced', { timeout: 12000 });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite', { timeout: 12000 });
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'season-frame-pressure');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
});

test('large autumn leaves accumulate at the screen floor, follow a resize and release on opt-out', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto('/');
  await page.locator('#seasonSelect').selectOption('autumn');
  await page.clock.runFor(6000);
  const hasFloorPile = () => page.locator('.season-canvas').evaluate(canvas => {
    const drawing = canvas.getContext('2d');
    const pixels = drawing.getImageData(Math.floor(canvas.width * .2), Math.max(0, canvas.height - 50), Math.floor(canvas.width * .6), 50).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 20);
  });
  expect(await hasFloorPile()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(500);
  expect(await hasFloorPile()).toBe(true);
  await page.locator('#seasonEffects').click();
  await expect(page.locator('.season-canvas')).toHaveCount(0);
});

test('fifty season and view switches keep one engine, bounded DOM and no retained canvas buffers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.evaluate(() => {
    const season = document.getElementById('seasonSelect');
    for (let iteration = 0; iteration < 50; iteration++) {
      season.value = ['spring', 'summer', 'autumn', 'winter'][iteration % 4];
      season.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector(`[data-gallery-mode="${iteration % 2 ? 'tone' : 'archive'}"]`).click();
    }
  });
  expect(await page.locator('.season-canvas').count()).toBeLessThanOrEqual(1);
  await expect(page.locator('.tone-card')).toHaveCount(24);
  await expect(page.locator('.album-card')).toHaveCount(0);
  await page.locator('#seasonEffects').click();
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  expect(await page.locator('#years *').count()).toBeLessThan(600);
});

test('river recycles a bounded preview pool through the collection and pauses for explicit controls and visibility', async ({ page }) => {
  // Drive elapsed animation time without asking WebKit to composite thousands of intermediate frames.
  await page.addInitScript(() => {
    localStorage.setItem('pt_season_effects', 'off');
    let handle = 0, time = performance.now();
    const callbacks = new Map();
    window.requestAnimationFrame = callback => { callbacks.set(++handle, callback); return handle; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.__riverAdvance = async duration => {
      for (let elapsed = 0; elapsed < duration; elapsed += 80) {
        time += 80;
        const pending = [...callbacks.values()]; callbacks.clear();
        pending.forEach(callback => callback(time));
        await Promise.resolve();
      }
    };
  });
  const originals = [];
  page.on('request', request => { if (/\/(garden|sea)-\d+\.jpg$/.test(request.url())) originals.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.river-tile')).toHaveCount(page.viewportSize().width < 1000 ? 15 : 20);
  await page.evaluate(() => {
    window.__riverSeen = new Set();
    const record = () => document.querySelectorAll('.river-tile').forEach(tile => window.__riverSeen.add(tile.dataset.key));
    record(); new MutationObserver(record).observe(document.getElementById('photoRiver'), { subtree: true, attributes: true, attributeFilter: ['data-key'] });
  });
  await page.evaluate(() => window.__riverAdvance(90000));
  expect(await page.evaluate(() => window.__riverSeen.size)).toBe(31);
  expect(await page.locator('.river-tile').evaluateAll(tiles => new Set(tiles.map(tile => tile.dataset.key)).size)).toBe(await page.locator('.river-tile').count());
  expect(originals).toEqual([]);
  await page.locator('#riverMotion').click();
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  const keys = await page.locator('.river-tile').evaluateAll(tiles => tiles.map(tile => tile.dataset.key));
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 20 });
  expect(await page.locator('.river-tile').evaluateAll(tiles => tiles.map(tile => tile.dataset.key))).toEqual(keys);
  const position = await page.locator('.river-column').first().getAttribute('style');
  await page.evaluate(() => window.__riverAdvance(1000));
  expect(await page.locator('.river-column').first().getAttribute('style')).toBe(position);
  await page.locator('#riverMotion').click();
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('#riverMotion')).toBeDisabled();
});

test('river photo selection retains source identity and focus, and particles cross the middle of the screen', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto('/');
  await page.locator('#seasonSelect').selectOption('autumn');
  await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'running');
  await page.clock.runFor(500);
  const middleHasParticles = await page.locator('.season-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(Math.floor(canvas.width * .35), Math.floor(canvas.height * .4), Math.floor(canvas.width * .3), Math.floor(canvas.height * .3)).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 20);
  });
  expect(middleHasParticles).toBe(true);
  for (const season of ['spring', 'winter']) {
    await page.locator('#seasonSelect').selectOption(season);
    await expect(page.locator('html')).toHaveAttribute('data-season-effects', 'running');
    await page.clock.runFor(300);
    expect(await page.locator('.season-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(Math.floor(canvas.width * .35), Math.floor(canvas.height * .4), Math.floor(canvas.width * .3), Math.floor(canvas.height * .3)).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 100);
    })).toBe(true);
  }
  await page.locator('#riverMotion').click();
  const tile = page.locator('.river-tile').filter({ visible: true }).first();
  const title = await tile.locator('img').getAttribute('alt');
  await tile.click();
  await expect(page.locator('#lbTitle')).toHaveText(title);
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('.season-canvas')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tile).toBeFocused();
});
