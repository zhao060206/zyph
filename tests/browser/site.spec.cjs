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

test.beforeEach(async ({ page },info) => {
  if(!info.title.startsWith('milk frog'))await page.addInitScript(()=>sessionStorage.setItem('pt_frog_invite_v3','1'));
  await page.route(bucket + '/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/data.json')) return route.fulfill({ json: { groups } });
    if (url.endsWith('/music.json')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'image/png', body: png });
  });
});

test('milk frog announcement and three separately earned packs survive reload',async({page},info)=>{
  await page.goto('/');await expect(page.locator('#frogModal')).toBeVisible();
  await page.locator('#frogQQ').fill(String(80000000+info.workerIndex*10000+Math.floor(Math.random()*9999)));
  await page.getByRole('button',{name:'马上领第一包'}).click();await expect(page.locator('.frog-tear')).toBeVisible();
  if(info.project.name==='desktop-chromium'){
    const box=await page.locator('.frog-tear').boundingBox();await page.mouse.move(box.x+15,box.y+15);await page.mouse.down();await page.mouse.move(box.x+box.width*.82,box.y+15,{steps:8});await page.mouse.up();
  }else await page.locator('.frog-tear').click();
  const card=page.locator('.frog-card');await expect(card).toBeVisible();await expect(card.locator('img')).toHaveJSProperty('naturalWidth',512);
  await page.locator('#frogClose').click();await page.locator('.album-cover').first().click();await page.locator('.gp-preview-item').first().click();
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/like')&&r.ok()),page.locator('#likeBtn').click()]);await page.locator('#lbClose').click();await page.locator('#frogReturn').click();
  for(const slot of ['photo','social']){await page.locator(`[data-frog="open:${slot}"]`).first().click();await page.locator('.frog-tear').press('Enter');await expect(page.locator('.frog-theater > .frog-card')).toBeVisible();await page.locator('[data-frog="wall"]').click();}
  await expect(page.locator('[data-frog^="show:"]')).toHaveCount(3);await page.goto('/');await expect(page.locator('#frogModal')).toBeHidden();await page.locator('#frogOpen').click();await expect(page.locator('[data-frog^="show:"]')).toHaveCount(3);
});

test('milk frog foil follows the finger and exposed cards switch without a draw',async({page},info)=>{
  const mobile=info.project.name.includes('mobile'),touch=info.project.name==='mobile-chromium';
  const packs=[{slot:'welcome',earned:true,card:{tier:'silver',number:8}},{slot:'photo',earned:true,card:null},{slot:'social',earned:true,card:{tier:'gold',number:12}}];let draws=0;
  const snapshot=()=>({joined:true,status:'published',remaining:25,packs});
  await page.route('**/api/raffle',r=>r.fulfill({json:snapshot()}));
  await page.route('**/api/raffle/draw',r=>{draws++;expect(r.request().postDataJSON()).toEqual({slot:'photo'});packs[1].card={tier:'white',number:16};return r.fulfill({json:snapshot()});});
  await page.goto('/');await page.locator('[data-frog="open:photo"]').first().click();const tear=page.locator('.frog-tear'),pouch=tear.locator('.foil-interactive');const box=await tear.boundingBox(),y=box.y+box.height*.1,start=box.x+box.width*.86;
  const cdp=touch?await page.context().newCDPSession(page):null;
  const down=async()=>{if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});else{await page.mouse.move(start,y);await page.mouse.down();}};
  const move=async fraction=>{const x=start-box.width*fraction;if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});else await page.mouse.move(x,y,{steps:5});};
  const up=async()=>{if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();};
  await down();await move(.32);await expect(pouch).toHaveClass(/pull-left/);
  const seam=await pouch.evaluate(p=>({clip:getComputedStyle(p.querySelector('.foil-intact')).clipPath,turn:getComputedStyle(p.querySelector('.foil-flap')).transform,progress:parseFloat(getComputedStyle(p).getPropertyValue('--tear'))}));
  expect(seam.progress).toBeGreaterThan(.4);expect(seam.progress).toBeLessThan(.7);expect(seam.clip).not.toBe('none');expect(seam.turn).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
  await up();await expect(tear).toBeVisible();expect(draws).toBe(0);
  await down();await move(.76);await up();const front=page.locator('.frog-theater > .frog-card'),caption=page.locator('.frog-caption h3');await expect(front).toContainText('016');await expect(caption).toHaveText('奶蛙小卡片（虚拟）');
  const stage=page.locator('.frog-theater');
  async function pressExposed(side){const point=await stage.evaluate((root,side)=>{const target=root.querySelector('.foil-sibling.'+side),b=root.getBoundingClientRect(),y=b.y+b.height*.5;const hits=[];for(let x=b.left+2;x<b.right-2;x+=2){if(target.contains(document.elementFromPoint(x,y)))hits.push(x);}return hits.length>8?{x:hits[Math.floor(hits.length/2)],y}:null;},side);expect(point).not.toBeNull();if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);}
  await expect(page.locator('.frog-deck-nav span')).toHaveText('2 / 3');await expect.poll(async()=>page.locator('.foil-sibling.left').evaluate(e=>{const b=e.getBoundingClientRect(),f=e.parentNode.querySelector(':scope > .frog-card').getBoundingClientRect();return f.left-b.left;})).toBeGreaterThan(12);
  await pressExposed('left');await expect(front).toContainText('008');await expect(caption).toHaveText('随机照片冰箱贴');
  const bounds=await stage.boundingBox(),faceBox=await front.boundingBox();expect(faceBox.y).toBeGreaterThanOrEqual(bounds.y);expect(faceBox.y+faceBox.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
  await pressExposed('right');await expect(front).toContainText('016');if(mobile)await front.tap();else await front.click();await expect(front).toContainText('012');await expect(caption).toHaveText('奈雪杨枝甘露套餐');
  await page.keyboard.press('ArrowRight');await expect(front).toContainText('008');await page.getByRole('button',{name:'上一张卡'}).click();await expect(front).toContainText('012');expect(draws).toBe(1);if(cdp)await cdp.detach();
});

test('milk frog hides home entries and activity section when paused or ended without live activities', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pt_frog_joined_v2', '1'));
  let raffleStatus = 'paused';
  let activitiesPayload = {
    current: [],
    history: [{ type: 'voting', config: { title: '往期摄影评选', status: 'ended', endedAt: 1700000000000 }, participants: 3, count: 5 }],
  };
  await page.route('**/api/activities', route => route.fulfill({ json: activitiesPayload }));
  await page.route('**/api/raffle', route => route.fulfill({
    json: {
      status: raffleStatus,
      remaining: 20,
      joined: true,
      packs: [
        { slot: 'welcome', earned: true, card: { tier: 'white', number: 1 } },
        { slot: 'photo', earned: false, card: null },
        { slot: 'social', earned: false, card: null },
      ],
    },
  }));

  const assertAllHidden = async () => {
    for (const sel of ['#frogModal', '#frogOpen', '#frogReturn', '#pastActivities', '#activities', '#navActivities']) {
      await expect(page.locator(sel)).toBeHidden();
    }
  };

  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/activities')),
    page.waitForResponse(r => r.url().endsWith('/api/raffle')),
    page.goto('/'),
  ]);
  await assertAllHidden();

  raffleStatus = 'ended';
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/activities')),
    page.waitForResponse(r => r.url().endsWith('/api/raffle')),
    page.reload(),
  ]);
  await assertAllHidden();

  activitiesPayload = {
    current: [{ type: 'voting', config: { title: '进行中摄影评选', status: 'published', maxVotes: 1 }, participants: 0, count: 0 }],
    history: activitiesPayload.history,
  };
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/activities')),
    page.waitForResponse(r => r.url().endsWith('/api/raffle')),
    page.reload(),
  ]);
  await expect(page.locator('#activities')).toBeVisible();
  await expect(page.locator('#navActivities')).toBeVisible();
  await expect(page.locator('[data-open-event="voting"]')).toBeVisible();
  for (const sel of ['#frogOpen', '#frogReturn', '#pastActivities']) {
    await expect(page.locator(sel)).toBeHidden();
  }
});

test('gallery, search, year filter, empty album and themes work without script errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.album-card')).toHaveCount(2);
  await expect(page.locator('.blank-entry')).toHaveCount(1);
  await expect(page.locator('.contact-sheet')).toHaveCount(0);
  await page.locator('[data-toggle-sheet="2026-10-25"]').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(1);
  await expect(page.locator('[data-toggle-sheet="2026-10-25"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-toggle-sheet="2025-06-08"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#toggleAllSheets').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(0);
  await page.locator('#toggleAllSheets').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(2);
  await page.locator('#toggleAllSheets').click();
  await expect(page.locator('.contact-sheet')).toHaveCount(0);
  await expect(page.locator('#heroTitle')).toHaveText('Phototropic');
  await expect(page.locator('#voteNoticeModal')).toBeHidden();
  await page.locator('#archiveSearch').fill('杭州');
  await expect(page.locator('.album-card')).toHaveCount(1);
  await page.locator('#archiveSearch').fill('');
  await page.locator('#yearFilter').selectOption('2024');
  await expect(page.locator('.album-card')).toHaveCount(0);
  await expect(page.locator('.blank-entry')).toHaveCount(1);
  await expect(page.locator('.blank-entry')).toHaveAttribute('data-day', '2024-02-03');
  await page.locator('.blank-entry').click();
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
  await page.locator('.album-cover').first().click();
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
  await expect(page.locator('.album-card')).toHaveCount(2);
  for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('#photoRiver').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
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
  await expect(page.locator('.album-card')).toHaveCount(2);
  await page.locator('.album-cover').first().click();
  await page.locator('.gp-preview-item').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await expect(page.locator('#lbQuality')).toContainText(/缩略图|高清预览/);
  expect(originals).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('failed comment deletion preserves the comment and displays a failure', async ({ page }) => {
  await page.goto('/');
  await page.locator('.album-cover').first().click();
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

test('motion grading respects reduced motion and low memory, while photo selection preserves focus', async ({ page, context }) => {
  await page.addInitScript(() => sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() })));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await expect(page.locator('#heroTitle')).toHaveText('Phototropic');
  await expect(page.locator('.river-tile')).toHaveCount(2);
  await page.locator('.river-tile').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.river-tile').first()).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 }));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'lite');
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', 'device-budget');
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
});

test('interaction grading ignores sparse input gaps and downgrades sustained slow frames', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('pt_season_effects', 'off');
    localStorage.setItem('pt_river_motion', 'off');
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    // Use controlled frame timestamps: mobile WebKit may throttle the headless display itself.
    let frameTime = performance.now();
    window.requestAnimationFrame = callback => setTimeout(() => callback(frameTime += 16), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  });
  await page.goto('/');
  await expect(page.locator('#heroTitle')).toHaveText('Phototropic');
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
  await expect(page.locator('#photoRiver')).toHaveAttribute('data-running', 'false');
  await page.locator('.album-cover').first().click();
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
  await page.locator('.album-cover').first().click();
  await expect(page.locator('#groupPage')).toBeVisible();
});
