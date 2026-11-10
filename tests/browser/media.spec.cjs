const { test, expect } = require('@playwright/test');
const bucket = 'https://zhao-1465501838.cos.ap-nanjing.myqcloud.com';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const original = { groups: [{ d: '2026-01-01', title: '原有相册', loc: '测试地点', gs: [{ t: '原照片', k: 'photos/original.jpg', tn: { s: 'photos/original_t480.jpg', v: 'photos/original_t1600.jpg' } }] }] };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pt_cos_sid', 'test-browser-fake-id');
    localStorage.setItem('pt_cos_skey', 'test-browser-fake-key');
    window.__testUploads = { calls: [], failIndex: false, catalog: null };
    window.COS = class {
      putObject(params, callback) {
        Promise.resolve().then(async () => {
          const state = window.__testUploads;
          const text = /json/.test(params.ContentType || '') ? await params.Body.text() : '';
          state.calls.push({ key: params.Key, type: params.ContentType });
          if (params.Key === 'data.json') {
            if (state.failIndex) { callback(new Error('模拟目录保存失败')); return; }
            state.catalog = JSON.parse(text);
          }
          callback(null, {});
        }).catch(error => callback(error));
      }
    };
  });
  await page.route(bucket + '/**', async route => {
    if (route.request().url().endsWith('/data.json')) {
      const saved = await page.evaluate(() => window.__testUploads.catalog);
      return route.fulfill({ json: saved || original });
    }
    if (route.request().url().endsWith('/music.json')) return route.fulfill({ json: { tracks: [] } });
    return route.fulfill({ contentType: 'image/png', body: image });
  });
});

test('admin photo upload preserves existing albums and writes original, two JPEG previews and catalog', async ({ page }) => {
  await page.goto('/#admin');
  await expect(page.locator('#adminPanel')).toBeVisible();
  await page.locator('[data-tab=upload]').click();
  await page.locator('#afDate').fill('2026-11-08');
  await page.locator('#afTitle').fill('新的摄影故事');
  await page.locator('#afFiles').setInputFiles({ name: 'new-photo.png', mimeType: 'image/png', buffer: image });
  await page.locator('#adminSubmit').click();
  await expect(page.locator('#adminStatus')).toContainText('上传成功');
  const result = await page.evaluate(() => window.__testUploads);
  expect(result.catalog.groups).toHaveLength(2);
  expect(result.catalog.groups.find(group => group.d === '2026-01-01').gs[0].k).toBe('photos/original.jpg');
  const uploaded = result.catalog.groups.find(group => group.d === '2026-11-08').gs[0];
  expect(uploaded.tn.s).toMatch(/_t480\.jpg$/);
  expect(uploaded.tn.v).toMatch(/_t1600\.jpg$/);
  expect(uploaded.tone).toMatchObject({ version: 1, group: 'neutral' });
  expect(result.calls.filter(call => call.type === 'image/jpeg')).toHaveLength(2);
  expect(result.calls[result.calls.length - 1].key).toBe('data.json');
});

test('admin tone corrections persist, failed writes roll back, and automatic reanalysis removes overrides', async ({ page }) => {
  await page.goto('/#admin');
  await page.locator('[data-tab=manage]').click();
  await page.locator('.mg-tone').selectOption('green');
  await expect(page.locator('#adminStatus')).toContainText('作品色调已保存');
  expect(await page.evaluate(() => window.__testUploads.catalog.groups[0].gs[0].tone)).toMatchObject({ group: 'green', manual: true });
  await page.evaluate(() => { window.__testUploads.failIndex = true; });
  await page.locator('.mg-tone').selectOption('red');
  await expect(page.locator('#adminStatus')).toContainText('色调保存失败');
  await expect(page.locator('.mg-tone')).toHaveValue('green');
  await page.evaluate(() => { window.__testUploads.failIndex = false; });
  await page.locator('.mg-tone').selectOption('auto');
  await expect(page.locator('#adminStatus')).toContainText('作品色调已保存');
  const tone = await page.evaluate(() => window.__testUploads.catalog.groups[0].gs[0].tone);
  expect(tone.group).toBe('neutral');
  expect(tone.manual).toBeUndefined();
});

test('page backup includes the tone index and refuses to write when a required asset is unavailable', async ({ page }) => {
  await page.goto('/#admin');
  await page.locator('[data-tab=setup]').click();
  await page.locator('#adminPublish').click();
  await expect(page.locator('#pubOut')).toContainText('色调索引');
  const calls = await page.evaluate(() => window.__testUploads.calls);
  expect(calls.map(call => call.key)).toEqual(['assets/app.js', 'assets/site.css', 'assets/tone-index.json', 'index.html']);
  await page.evaluate(() => { window.__testUploads.calls = []; });
  await page.route('**/assets/tone-index.json', route => route.fulfill({ status: 503 }));
  await page.locator('#adminPublish').click();
  await expect(page.locator('#adminStatus')).toContainText('未写入不完整备份');
  expect(await page.evaluate(() => window.__testUploads.calls)).toEqual([]);
});

test('failed catalog saves keep originals intact during delete and replace', async ({ page }) => {
  let deletes = 0;
  page.on('request', request => { if (request.url().endsWith('/api/photo/delete')) deletes++; });
  await page.goto('/#admin');
  await page.locator('[data-tab=manage]').click();
  await expect(page.locator('.mg-ph')).toHaveCount(1);
  await page.evaluate(() => { window.__testUploads.failIndex = true; });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-act=del]').first().click();
  await expect(page.locator('#adminStatus')).toContainText('原照片已保留');
  await expect(page.locator('.mg-thumb')).toHaveAttribute('data-k', 'photos/original.jpg');
  await page.locator('.mg-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#adminStatus')).toContainText('替换失败');
  await expect(page.locator('.mg-thumb')).toHaveAttribute('data-k', 'photos/original.jpg');
  expect(deletes).toBe(0);
});
