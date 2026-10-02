#!/usr/bin/env node
// Visual QA helper — screenshot any surface of the running web app.
//
//   node scripts/shot.mjs --hash "#/inbox" --out /tmp/inbox.png
//   node scripts/shot.mjs --url http://localhost:5201 --hash "#/clients?o=client:<id>" --out x.png --wait 2000
//   node scripts/shot.mjs --hash "#/home" --click "[data-tab=phone]" --out phone.png
//   node scripts/shot.mjs --hash "#/home" --theme light --width 1280 --height 860 --out desk.png
//   node scripts/shot.mjs --hash "#/inbox" --eval "document.querySelector('input').focus()" --out x.png
//
// Logs in through the "Explore the demo book" button when the login screen
// shows, waits for the tab bar, applies the hash, then captures. Console
// errors and failed requests are printed so you can fix them.
import { chromium } from '../web/node_modules/playwright-core/index.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

const url = args.url || 'http://localhost:5173';
const hash = args.hash || '#/home';
const out = args.out || '/tmp/shot.png';
const width = Number(args.width || 390);
const height = Number(args.height || 844);
const wait = Number(args.wait || 1500);
const clicks = [].concat(args.click || []).filter((c) => c !== true);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(args.scale || 2), hasTouch: width < 800, isMobile: width < 800, ignoreHTTPSErrors: true });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) problems.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => { const u = r.url(); if (u.includes('/api/')) problems.push(`requestfailed: ${u} ${r.failure()?.errorText}`); });
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${u}`); });

if (args.theme) {
  await page.addInitScript((t) => { try { localStorage.setItem('km-theme', t); } catch { /* ignore */ } }, args.theme);
}

await page.goto(`${url}/${width >= 760 ? '?frame=0' : ''}${hash}`, { waitUntil: 'domcontentloaded' });
try {
  const demo = page.getByText('Explore the demo book');
  await demo.waitFor({ timeout: 4000 });
  await demo.click();
} catch { /* already signed in */ }
await page.waitForSelector('.km-tabbar', { timeout: 15000 }).catch(() => problems.push('tab bar never appeared'));
await page.evaluate((h) => { if (location.hash !== h) { location.hash = h; window.dispatchEvent(new PopStateEvent('popstate')); } }, hash);
await page.waitForTimeout(wait);
for (const sel of clicks) {
  try { await page.click(sel, { timeout: 4000 }); await page.waitForTimeout(700); } catch (e) { problems.push(`click failed: ${sel}`); }
}
if (args.eval && args.eval !== true) {
  try { await page.evaluate(args.eval); await page.waitForTimeout(600); } catch (e) { problems.push(`eval failed: ${e.message}`); }
}
await page.screenshot({ path: out, fullPage: !!args.full });
console.log(`saved ${out}`);
if (problems.length) console.log(`problems:\n  ${[...new Set(problems)].slice(0, 30).join('\n  ')}`);
await browser.close();
