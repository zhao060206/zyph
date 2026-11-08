import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: process.platform === 'win32' && existsSync(edge) ? edge : undefined });
const metrics = [];
for (const mode of [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, isMobile: false },
  { name: 'mobile', viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true },
]) {
  const context = await browser.newContext(mode);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__measurements = { lcp: null, cls: 0 };
    try {
      new PerformanceObserver(list => { const entries = list.getEntries(); window.__measurements.lcp = entries[entries.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__measurements.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    } catch (error) { window.__measurements.unavailable = error.message; }
  });
  await page.goto('http://127.0.0.1:3010/', { waitUntil: 'domcontentloaded' });
  await page.locator('.album-card').first().waitFor();
  const heroReadyMs = await page.locator('#heroImage').evaluate(async img => { await img.decode().catch(() => {}); return performance.now(); });
  await page.waitForFunction(() => document.documentElement.dataset.motionReason !== 'sampling-pending');
  await page.locator('#heroImage').evaluate(async img => {
    if (img.getAnimations) await Promise.allSettled(img.getAnimations().map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `qa-${mode.name}.png` });
  const result = await page.evaluate(() => ({
    ...window.__measurements,
    fcp: performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint')?.startTime,
    resources: performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(location.origin)).map(entry => ({ url: new URL(entry.name).pathname, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
    navigation: { transferBytes: performance.getEntriesByType('navigation')[0].transferSize, decodedBytes: performance.getEntriesByType('navigation')[0].decodedBodySize },
    width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    albums: document.querySelectorAll('.album-card').length,
    motionTier: document.documentElement.dataset.motion,
    motionReason: document.documentElement.dataset.motionReason,
    fontRequests: performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'css' && /font/i.test(entry.name)).length,
  }));
  metrics.push({ mode: mode.name, ...result, heroReadyMs, errors });
  if (mode.name === 'desktop') {
    await page.locator('#themeBtn').click();
    await page.screenshot({ path: 'qa-dark.png' });
  }
  await context.close();
}
await browser.close();
await writeFile('qa-metrics.json', JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
