const { test, expect } = require('@playwright/test');
const bucket = 'https://zhao-1465501838.cos.ap-nanjing.myqcloud.com';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const groups = ['2026-10-01', '2025-06-02'].map((day, index) => ({ d: day, title: `Album ${index + 1}`, loc: 'Wuhan', gs: [0, 1].map(photo => ({ t: `Photo ${index}-${photo}`, k: `photos/${index}-${photo}.jpg`, tn: { s: `photos/${index}-${photo}-s.jpg`, v: `photos/${index}-${photo}-v.jpg` } })) }));

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
    localStorage.setItem('pt_river_motion', 'off');
    localStorage.setItem('pt_season_effects', 'off');
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    window.__transitionFrames = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      window.__transitionFrames.push({ target: this.id, frames, duration: options?.duration });
      return animate.call(this, frames, options);
    };
  });
  await page.route(bucket + '/**', route => route.request().url().endsWith('data.json') ? route.fulfill({ json: { groups } }) : route.fulfill({ contentType: 'image/png', body: png }));
});

test('album navigation animates content, keeps navigation fixed and restores scroll and focus on return', async ({ page }) => {
  await page.goto('/');
  const cover = page.locator('.album-cover').first();
  await cover.scrollIntoViewIfNeeded();
  await cover.evaluate(el => el.addEventListener('click', () => { window.__returnScroll = scrollY; }, { once: true, capture: true }));
  const header = await page.locator('.topbar').boundingBox();
  await cover.click();
  await expect(page.locator('#groupPage')).toBeVisible();
  await expect(page.locator('#gpTitle')).toHaveText('Album 1');
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).viewTransitionName)).toBe('page-content');
  expect(await page.locator('.topbar').evaluate(el => getComputedStyle(el).viewTransitionName)).toBe('site-navigation');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.pseudoElement?.includes('page-content')).every(animation => animation.effect.getKeyframes().every(frame => !('transform' in frame))))).toBe(true);
  expect(await page.locator('.topbar').boundingBox()).toEqual(header);
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation');
  await page.locator('#gpBack').click();
  await expect(page.locator('#archive')).toBeVisible();
  await expect(cover).toBeFocused();
  expect(await page.evaluate(() => Math.abs(scrollY - window.__returnScroll))).toBeLessThan(3);
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation');
});

test('viewer opening and dismissal animate and interruption by reduced motion settles state and focus', async ({ page }) => {
  await page.goto('/');
  const tile = page.locator('.river-tile').first();
  await tile.click();
  await expect(page.locator('#lbClose')).toBeFocused();
  // Inspect the animation that actually started, even if a slow test round-trip outlasts its 260ms fade.
  expect(await page.evaluate(() => window.__transitionFrames.some(item => item.target === 'lightbox' && item.duration === 260))).toBe(true);
  expect(await page.evaluate(() => window.__transitionFrames.filter(item => item.target === 'lightbox').every(item => item.frames.every(frame => !('transform' in frame) && 'opacity' in frame)))).toBe(true);
  await page.locator('#lbClose').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#lightbox')).toBeHidden();
  await expect(tile).toBeFocused();
  await tile.click();
  expect(await page.locator('#lightbox').evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).toBeHidden();
  expect(await page.locator('.lb-inner').getAttribute('style') || '').not.toContain('transform-origin');
});

test('rapid navigation keeps the last requested page and fallback works without View Transitions', async ({ page }) => {
  await page.addInitScript(() => { document.startViewTransition = undefined; });
  await page.goto('/');
  await page.locator('.album-cover').first().waitFor();
  await page.evaluate(() => {
    document.querySelector('.album-cover').click();
    document.querySelector('#gpBack').click();
    document.querySelectorAll('.album-cover')[1].click();
  });
  await expect(page.locator('#gpTitle')).toHaveText('Album 2');
  await expect(page.locator('#groupPage')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation');
  expect(await page.locator('#groupPage').evaluate(el => el.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => window.__transitionFrames.filter(item => ['archive','groupPage'].includes(item.target)).every(item => item.frames.every(frame => !('transform' in frame) && 'opacity' in frame)))).toBe(true);
  await page.locator('#gpBack').click();
  await expect(page.locator('#archive')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation');
});

test('interrupted native navigation cannot apply an older pending destination', async ({ page }) => {
  await page.goto('/');
  await page.locator('.album-cover').first().waitFor();
  await page.evaluate(() => {
    document.querySelector('.album-cover').click();
    document.querySelector('#brandHome').click();
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation');
  await expect(page.locator('#archive')).toBeVisible();
  await expect(page.locator('#groupPage')).toBeHidden();
});

test('hidden scrollbars keep viewport width stable across viewer dismissal while page and panel scrolling work', async ({ page, browserName, isMobile }) => {
  await page.goto('/');
  await page.locator('.river-tile').first().waitFor();
  const geometry = () => page.evaluate(() => ({
    viewport: innerWidth, content: document.documentElement.clientWidth,
    header: document.querySelector('.topbar').getBoundingClientRect().width,
    river: document.querySelector('#photoRiver').getBoundingClientRect().width,
  }));
  const before = await geometry();
  expect(before.content).toBe(before.viewport);
  expect(await page.evaluate(() => CSS.supports('scrollbar-width', 'none')
    ? getComputedStyle(document.documentElement).scrollbarWidth === 'none'
    : getComputedStyle(document.documentElement, '::-webkit-scrollbar').display === 'none')).toBe(true);
  await page.locator('.river-tile').first().evaluate(tile => { tile.focus({ preventScroll: true }); tile.click(); });
  await expect(page.locator('#lbClose')).toBeFocused();
  expect(await geometry()).toEqual(before);
  await page.locator('#lbCaption').evaluate(el => { el.textContent = 'Scrollable photo description. '.repeat(300); });
  const sidebar = page.locator('.lb-sidebar');
  await sidebar.hover();
  // Playwright cannot dispatch mouse wheels in mobile WebKit; verify its native scroll container via scrollBy.
  if (browserName === 'webkit' && isMobile) await sidebar.evaluate(el => el.scrollBy(0, 350));
  else await page.mouse.wheel(0, 350);
  await expect.poll(() => sidebar.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await sidebar.evaluate(el => el.offsetWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.locator('#lbClose').click();
  await expect(page.locator('#lightbox')).toBeHidden();
  expect(await geometry()).toEqual(before);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(4, Math.floor(page.viewportSize().height / 2));
  if (browserName === 'webkit' && isMobile) await page.evaluate(() => scrollBy(0, 250));
  else await page.mouse.wheel(0, 250);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});
