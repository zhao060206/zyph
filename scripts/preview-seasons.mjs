import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: existsSync(edge) ? edge : undefined });
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const indexReady = page.waitForResponse(response => response.url().endsWith('/assets/tone-index.json'));
    await page.goto(process.env.PREVIEW_URL || 'http://localhost:3011/', { waitUntil: 'domcontentloaded' });
    await page.locator('.album-card').first().waitFor();
    await indexReady;
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      await page.locator('#seasonSelect').selectOption(season);
      await page.locator('#heroImage').evaluate(async img => {
        await img.decode();
        await Promise.allSettled(img.getAnimations().map(animation => animation.finished));
      });
      await page.screenshot({ path: `qa-${season}-${mobile ? 'mobile' : 'desktop'}.png` });
      results.push(await page.evaluate(() => ({ season: document.documentElement.dataset.season, width: innerWidth, documentWidth: document.documentElement.scrollWidth, tier: document.documentElement.dataset.motion, effects: document.documentElement.dataset.seasonEffects, pixels: [...document.querySelectorAll('.season-canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) })));
    }
    await page.locator('[data-gallery-mode=tone]').click();
    await page.locator('.tone-card').first().waitFor();
    await page.evaluate(() => window.scrollTo(0, document.getElementById('gallery').offsetTop - document.querySelector('.topbar').offsetHeight));
    await page.locator('.tone-photo img').evaluateAll(async images => {
      const visible = images.filter(img => { const bounds = img.getBoundingClientRect(); return bounds.top < innerHeight && bounds.bottom > 0; });
      await Promise.all(visible.map(img => img.decode()));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.tone-card')].filter(card => card.getBoundingClientRect().top < innerHeight).every(card => Number(getComputedStyle(card).opacity) > .99));
    await page.screenshot({ path: `qa-tones-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.locator('#themeBtn').click();
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `qa-tones-dark-${mobile ? 'mobile' : 'desktop'}.png` });
    if (errors.length) throw new Error(errors.join('\n'));
    await context.close();
  }
  await writeFile('qa-season-metrics.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
