import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: existsSync(edge) ? edge : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    const pending = new Set();
    const originalFrame = requestAnimationFrame.bind(window), originalCancel = cancelAnimationFrame.bind(window);
    const originalListener = EventTarget.prototype.addEventListener;
    window.__seasonQA = { pending, listeners: 0 };
    window.requestAnimationFrame = callback => {
      const handle = originalFrame(time => { pending.delete(handle); callback(time); });
      pending.add(handle); return handle;
    };
    window.cancelAnimationFrame = handle => { pending.delete(handle); originalCancel(handle); };
    EventTarget.prototype.addEventListener = function(...args) { window.__seasonQA.listeners++; return originalListener.apply(this, args); };
    sessionStorage.setItem('pt_motion_grade_v1', JSON.stringify({ tier: 'full', timestamp: Date.now() }));
  });
  const ready = page.waitForResponse(response => response.url().endsWith('/assets/tone-index.json'));
  await page.goto(process.env.PREVIEW_URL || 'http://localhost:3011/');
  await ready; await page.locator('.album-card').first().waitFor();
  const session = await page.context().newCDPSession(page);
  async function switches(count) {
    await page.evaluate(async count => {
      const select = document.getElementById('seasonSelect');
      for (let index = 0; index < count; index++) {
        select.value = ['spring', 'summer', 'autumn', 'winter'][index % 4];
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector(`[data-gallery-mode=${index % 2 ? 'tone' : 'archive'}]`).click();
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }, count);
    await page.locator('.river-tile img').evaluateAll(images => Promise.allSettled(images.map(img => img.decode())));
    await page.waitForTimeout(600);
  }
  async function measurement() {
    await session.send('HeapProfiler.collectGarbage');
    const heap = await session.send('Runtime.getHeapUsage');
    return page.evaluate(heap => ({ usedHeapBytes: heap.usedSize, listenersRegistered: window.__seasonQA.listeners,
      pendingFrames: window.__seasonQA.pending.size, canvasCount: document.querySelectorAll('.season-canvas').length,
      canvasPixels: [...document.querySelectorAll('.season-canvas')].reduce((sum, item) => sum + item.width * item.height, 0),
      riverTiles: document.querySelectorAll('.river-tile').length, renderedPhotos: document.querySelectorAll('.tone-card').length, motion: document.documentElement.dataset.motion }), heap);
  }
  await switches(20);
  const warm = await measurement();
  await switches(50);
  const after50 = await measurement();
  await switches(50);
  const after100 = await measurement();
  await page.locator('#seasonEffects').click();
  await page.locator('#riverMotion').click();
  await page.waitForTimeout(600);
  const stopped = await measurement();
  const results = { warm, after50, after100, stopped };
  await writeFile('qa-season-profile.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (after100.canvasCount > 1 || after100.canvasPixels > 2000000 || stopped.canvasCount || stopped.pendingFrames || after100.listenersRegistered !== warm.listenersRegistered || after100.usedHeapBytes > warm.usedHeapBytes + 3 * 1024 * 1024) {
    throw new Error('季节切换资源预算未通过');
  }
} finally { await browser.close(); }
