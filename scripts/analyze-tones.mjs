import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { validTone } from '../src/tones.mjs';

const bundle = await build({ entryPoints: ['src/color-analysis.js'], bundle: true, format: 'iife', globalName: 'ToneAnalysis', write: false });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: existsSync(edge) ? edge : undefined });
try {
  let existing = {};
  if (!process.argv.includes('--refresh') && existsSync('public/tone-index.json')) {
    const saved = JSON.parse(await readFile('public/tone-index.json', 'utf8'));
    existing = Object.fromEntries(Object.entries(saved.photos || {}).filter(([, tone]) => validTone(tone)));
  }
  const page = await browser.newPage();
  await page.route('http://tone-analysis.local/', route => route.fulfill({ body: '<!doctype html><html></html>', contentType: 'text/html' }));
  await page.goto('http://tone-analysis.local/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async existing => {
    const base = 'https://zhao-1465501838.cos.ap-nanjing.myqcloud.com/';
    const catalogResponse = await fetch(base + 'data.json');
    if (!catalogResponse.ok) throw new Error('无法读取公开照片目录');
    const catalog = await catalogResponse.json();
    const photos = Object.create(null), failures = [], inventory = [];
    for (const group of catalog.groups) for (const photo of group.gs || []) {
      if (!photo.tn?.s) { failures.push(photo.k); continue; }
      try {
        if (Object.prototype.hasOwnProperty.call(existing, photo.k)) photos[photo.k] = existing[photo.k];
        else {
          const response = await fetch(base + photo.tn.s, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(String(response.status));
          photos[photo.k] = await ToneAnalysis.analyzeBlob(await response.blob());
        }
        inventory.push({ key: photo.k, title: photo.t, album: group.title, tone: photos[photo.k].group });
      } catch (error) { failures.push({ key: photo.k, error: error.message }); }
    }
    return { photos, failures, inventory };
  }, existing);
  if (result.failures.length) throw new Error(JSON.stringify(result.failures));
  const candidates = {
    spring: 'photos/2026-03-05/1_1789824696604.jpg',
    summer: 'photos/2026-09-19/1_1789827308484.jpg',
    autumn: 'photos/2026-10-25/13_1792931647538.jpg',
    winter: 'photos/2026-08-26/1_1789827400181.jpg',
  };
  const covers = Object.fromEntries(Object.entries(candidates).filter(([, key]) => result.photos[key]));
  await writeFile('public/tone-index.json', JSON.stringify({ version: 1, covers, photos: result.photos }) + '\n');
  await writeFile('qa-tone-inventory.json', JSON.stringify(result.inventory, null, 2));
  const counts = {};
  for (const tone of Object.values(result.photos)) counts[tone.group] = (counts[tone.group] || 0) + 1;
  console.log(JSON.stringify({ total: Object.keys(result.photos).length, counts }));
} finally { await browser.close(); }
