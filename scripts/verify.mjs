// scripts/verify.mjs — headless verification harness (Playwright).
// Usage: node scripts/verify.mjs [url] [--launch] [--tag name]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5175/';
const DO_LAUNCH = process.argv.includes('--launch');
const tagIdx = process.argv.indexOf('--tag');
const TAG = tagIdx >= 0 ? process.argv[tagIdx + 1] : 'verify';
const SHOT_DIR = path.resolve('.cache-spacetrack/shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(8000); // catalog load + worker warmup

async function snap(name) {
  const f = path.join(SHOT_DIR, `${TAG}-${name}.png`);
  await page.screenshot({ path: f });
  return f;
}

const stats = await page.evaluate(() => {
  const s = window.__state || {};
  return {
    totalObjects: s.totalObjects,
    categoryCounts: s.categoryCounts,
    hasScene: !!s.scene,
    catalogLen: s.catalog ? s.catalog.length : 0,
  };
});
console.log('STATS', JSON.stringify(stats));
await snap('earth');

// capture two positions ~4s apart to confirm motion
const sample = () => page.evaluate(() => {
  const s = window.__state;
  if (!s || !s.scene) return null;
  for (const [cat, pts] of s.scene._orbitalMeshes) {
    const a = pts.geometry.getAttribute('position');
    if (a && a.count > 0) return [a.array[0], a.array[1], a.array[2]];
  }
  return null;
});
const p0 = await sample();
await page.waitForTimeout(4000);
const p1 = await sample();
let moved = 0;
if (p0 && p1) moved = Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]);
console.log('MOTION', JSON.stringify({ p0, p1, moved }));

if (DO_LAUNCH) {
  // Apply Apollo 11 preset then launch.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.preset-btn')];
    const a11 = btns.find((b) => b.textContent.includes('Apollo 11'));
    if (a11) a11.click();
  });
  await page.waitForTimeout(300);
  await page.click('#launch-btn');
  await page.waitForFunction(() => {
    const p = document.getElementById('right-sidebar');
    return p && p.classList.contains('visible') && p.querySelector('.window-card');
  }, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const launchStats = await page.evaluate(() => {
    const s = window.__state;
    const cards = [...document.querySelectorAll('.window-card')].length;
    const w = s.launchWindows;
    return {
      windows: cards,
      first: w && w[0] ? {
        pSuccess: w[0].pSuccess,
        score: w[0].score,
        dv: w[0].deltaV ? w[0].deltaV.total : null,
        flightDays: w[0].flightDuration ? (w[0].flightDuration/86400).toFixed(2) : null,
        landing: w[0].landingSite ? w[0].landingSite.craterName : null,
        closeApproaches: w[0].closeApproaches ? w[0].closeApproaches.length : null,
        waypoints: w[0].trajectory ? w[0].trajectory.waypoints.length : null,
      } : null,
      resultsText: (document.getElementById('right-sidebar')||{}).innerText || '',
    };
  });
  console.log('LAUNCH', JSON.stringify(launchStats, null, 2));
  await snap('after-launch-earth');
  // trajectory + moon views
  await page.click('#view-trajectory-btn'); await page.waitForTimeout(2500); await snap('trajectory');
  await page.click('#view-moon-btn'); await page.waitForTimeout(2500); await snap('moon');
}

console.log('CONSOLE_ERRORS', errors.length);
for (const e of errors.slice(0, 40)) console.log('  ERR:', e);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
