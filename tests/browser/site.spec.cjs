const { test, expect } = require('@playwright/test');
const { Buffer } = require('node:buffer');
const bucket = 'https://zhao-1465501838.cos.ap-nanjing.myqcloud.com';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const groups = [
  { d: '2026-10-25', title: '秋日园博园', loc: '湖北 · 武汉', c: '一段秋日的记忆', exif: 'Camera<br>50mm · f/2 · ISO 100', gs: [
    { t: '园林与光', k: 'photos/one.jpg', tn: { s: 'photos/one-small.jpg', v: 'photos/one-view.jpg' } },
    { t: '窗边的树', k: 'photos/two.jpg', tn: { s: 'photos/two-small.jpg', v: 'photos/two-view.jpg' } },
  ] },
  { d: '2025-06-08', title: '街头拾光', loc: '浙江 · 杭州', gs: [{ t: '一扇窗', k: 'photos/three.jpg' }] },
  { d: '2024-02-03', title: '留白的旅途', loc: '山野', gs: [] },
];

async function publish(request, type) {
  const auth = { token: 'test-browser-only' };
  const endpoint = '/api/activities/admin';
  const state = await (await request.post(endpoint, { data: { ...auth, action: 'list' } })).json();
  let current = state.current.find(item => item.type === type);
  if (current.config.status === 'published') await request.post(endpoint, { data: { ...auth, type, action: 'end' } });
  if (current.config.status !== 'draft') await request.post(endpoint, { data: { ...auth, type, action: 'new' } });
  const result = await request.post(endpoint, { data: { ...auth, type, action: 'publish', config: { title: '交互回归活动', maxPhotos: 3, maxVotes: 2 } } });
  expect(result.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route(bucket + '/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/data.json')) return route.fulfill({ json: { groups } });
    if (url.endsWith('/music.json')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'image/png', body: png });
  });
});

test('gallery, search, year filter, empty album and themes work without script errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.album-card')).toHaveCount(3);
  await expect(page.locator('.contact-sheet')).toHaveCount(0);
  await page.locator('[data-toggle-sheet="2026-10-25"]').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(1);
  await expect(page.locator('[data-toggle-sheet="2026-10-25"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-toggle-sheet="2025-06-08"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-toggle-sheet="2026-10-25"]').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(0);
  await expect(page.locator('#heroTitle')).toHaveText('秋日园博园');
  await expect(page.locator('#voteNoticeModal')).toBeHidden();
  await page.locator('#archiveSearch').fill('杭州');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.locator('#archiveSearch').fill('');
  await page.locator('#yearFilter').selectOption('2024');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.locator('.album-cover').click();
  await expect(page.locator('#gpBlank')).toBeVisible();
  await page.locator('#gpBack').click();
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('photo viewer, likes, comments, deletion and keyboard focus work', async ({ page }) => {
  await page.goto('/');
  await page.locator('#heroFeature').click();
  await page.locator('.gp-preview-item').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await expect(page.locator('#lbClose')).toBeFocused();
  await expect(page.locator('#likeBtn')).toBeEnabled();
  await page.locator('#likeBtn').click();
  await expect(page.locator('#likeBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#cmInput').fill('浏览器回归留言');
  await page.locator('#cmSend').click();
  await expect(page.locator('#cmList')).toContainText('浏览器回归留言');
  await page.locator('#cmList .cm-del').first().click();
  await expect(page.locator('#cmList')).not.toContainText('浏览器回归留言');
  await page.locator('#cmInput').fill('写字时不应该翻图');
  await page.locator('#cmInput').press('ArrowRight');
  await expect(page.locator('#lbIdx')).toHaveText('1 / 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).toBeHidden();
  await expect(page.locator('.gp-preview-item').first()).toBeFocused();
});

test('mobile layout has no overflow at small, portrait and landscape sizes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card')).toHaveCount(3);
  for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.hero-media').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('admin publishes and ends an activity, history persists, and the next draft is independent', async ({ page }) => {
  await page.goto('/#admin');
  await expect(page.locator('#adminPanel')).toBeVisible();
  await page.locator('#adminToken').fill('test-browser-only');
  await page.locator('[data-tab=vote]').click();
  await expect(page.locator('#avLifecycleStatus')).not.toHaveText('请先登录后台读取活动');
  // A previous project run may have left the current event ended.
  const newButton = page.locator('[data-event-controls=voting] [data-event-action=new]');
  if (await newButton.isVisible()) await newButton.click();
  const endButton = page.locator('[data-event-controls=voting] [data-event-action=end]');
  if (await endButton.isVisible()) {
    page.once('dialog', dialog => dialog.accept()); await endButton.click();
    await newButton.click();
  }
  await page.locator('#avfTitle').fill('浏览器摄影评选');
  await page.locator('#avfDeadline').fill('');
  await page.locator('#avfSaveBtn').click();
  await expect(page.locator('#avLifecycleStatus')).toContainText('草稿');
  await page.locator('[data-event-controls=voting] [data-event-action=publish]').click();
  await expect(page.locator('#avLifecycleStatus')).toContainText('进行中');
  page.once('dialog', dialog => dialog.accept());
  await endButton.click();
  await expect(page.locator('#avLifecycleStatus')).toContainText('已结束');
  await expect(page.locator('#avfTitle')).toBeDisabled();
  await page.locator('[data-tab=history]').click();
  await expect(page.locator('#historyList')).toContainText('浏览器摄影评选');
  await page.locator('[data-history-id]').first().click();
  await expect(page.locator('#historyDownload')).toBeVisible();
});

test('visitors vote from keyboard and one click produces one frozen ballot', async ({ page, request }) => {
  await publish(request, 'voting');
  let posts = 0;
  await page.route('**/api/vote/submit', async route => {
    posts++; await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto('/');
  await page.locator('[data-open-event=voting]').click();
  const first = page.locator('.vb-card').first();
  await first.focus(); await first.press('Enter');
  await expect(first).toHaveClass(/selected/);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#vbQQ').fill('123456789');
  await page.locator('#vbSubmit').click();
  await expect(page.locator('#vbSubmit')).toHaveText('已投票');
  expect(posts).toBe(1);
});

test('photo submission processes files, submits once and reopens a server thumbnail after reload', async ({ page, request }) => {
  await publish(request, 'submissions');
  await page.goto('/');
  await page.locator('[data-open-event=submissions]').click();
  await page.locator('#sbFileInput').setInputFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#sbPickGrid .has-img')).toHaveCount(1);
  await page.locator('#sbQQ').fill('987654321');
  await page.locator('#sbWorkTitle').fill('测试投稿作品');
  await page.locator('#sbSubmit').click();
  await expect(page.locator('#sbSubmit')).toHaveText('已投稿');
  await page.reload();
  await page.locator('[data-open-event=submissions]').click();
  const image = page.locator('#sbPickGrid img');
  await expect(image).toHaveAttribute('src', /^\/submissions\/.*_t480\.jpg$/);
  await expect.poll(() => image.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#sbQQ')).toBeDisabled();
});

test('blocked browser storage keeps the gallery usable and missing previews do not download originals', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
    window.AbortController = undefined;
  });
  const errors = [], originals = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url() === bucket + '/photos/one.jpg') originals.push(request.url()); });
  await page.route(bucket + '/photos/one-view.jpg', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.locator('.album-card')).toHaveCount(3);
  await page.locator('.album-cover').first().click();
  await page.locator('.gp-preview-item').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await expect(page.locator('#lbQuality')).toContainText(/缩略图|高清预览/);
  expect(originals).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('failed comment deletion preserves the comment and displays a failure', async ({ page }) => {
  await page.goto('/');
  await page.locator('#heroFeature').click();
  await page.locator('.gp-preview-item').first().click();
  await expect(page.locator('#cmSend')).toBeEnabled();
  await page.locator('#cmInput').fill('删除失败时应该保留');
  await page.locator('#cmSend').click();
  await expect(page.locator('#cmList')).toContainText('删除失败时应该保留');
  await page.route('**/api/comment/delete', route => route.fulfill({ status: 503, json: { error: '模拟存储不可用' } }));
  await page.locator('#cmList .cm-del').first().click();
  await expect(page.locator('#cmHint')).toContainText('删除失败');
  await expect(page.locator('#cmList')).toContainText('删除失败时应该保留');
});

test('motion grading respects reduced motion and low memory, while rich mode keeps carousel navigation working', async ({ page, context }) => {
  await page.addInitScript(() => sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() })));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await expect(page.locator('#heroTitle')).toHaveText('秋日园博园');
  await page.locator('#heroNext').click();
  await expect(page.locator('#heroTitle')).toHaveText('街头拾光');
  await page.locator('#heroExplore').click();
  await expect(page.locator('#groupPage')).toBeVisible();
  await expect(page.locator('#gpTitle')).toHaveText('街头拾光');
  await page.locator('#gpBack').click();
  await expect(page.locator('#archive')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
  expect(await page.locator('#heroImage').evaluate(el => el.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 }));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'device-budget');
  await expect(page.locator('#heroImage')).toHaveCSS('transition-duration', '0s');
});

test('interaction grading ignores sparse input gaps and downgrades sustained slow frames', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('pt_season_effects', 'off');
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    // Use controlled frame timestamps: mobile WebKit may throttle the headless display itself.
    let frameTime = performance.now();
    window.requestAnimationFrame = callback => setTimeout(() => callback(frameTime += 16), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  });
  await page.goto('/');
  await expect(page.locator('#heroTitle')).toHaveText('秋日园博园');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  // Events 50ms apart are ordinary sparse input, not evidence of missed display frames.
  await page.evaluate(() => new Promise(resolve => {
    let count = 0;
    const timer = setInterval(() => {
      window.dispatchEvent(new Event('scroll'));
      if (++count === 24) { clearInterval(timer); resolve(); }
    }, 50);
  }));
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 48);
    window.cancelAnimationFrame = id => clearTimeout(id);
    window.__slowInput = setInterval(() => window.dispatchEvent(new Event('scroll')), 20);
  });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'interaction-frame-pressure');
  await page.evaluate(() => clearInterval(window.__slowInput));
  await expect(page.locator('#heroImage')).toHaveCSS('transition-duration', '0s');
  await page.locator('#heroFeature').click();
  await expect(page.locator('#groupPage')).toBeVisible();
});

test('slow foreground grading honors changing preferences and data saver overrides a rich cached grade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    sessionStorage.removeItem('pt_motion_grade_v1');
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    window.__probeFrames = 0;
    window.requestAnimationFrame = callback => setTimeout(() => { window.__probeFrames++; callback(performance.now()); }, 48);
    window.cancelAnimationFrame = id => clearTimeout(id);
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'frame-sample');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await page.reload();
  await page.waitForFunction(() => window.__probeFrames >= 5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__probeFrames >= 32);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'data-saver');
  await page.locator('#heroFeature').click();
  await expect(page.locator('#groupPage')).toBeVisible();
});
