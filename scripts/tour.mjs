#!/usr/bin/env node
// Integration QA tour — visits every surface in one session and screenshots it.
//   node scripts/tour.mjs --url http://localhost:5173 --out /tmp/tour [--width 390 --height 844] [--theme light]
//   node scripts/tour.mjs --url http://127.0.0.1:4180 --api http://localhost:3200 --out /tmp/tour-native   (VITE_API_URL build, native-like)
// Writes <out>/NN-name.png and <out>/report.txt (console errors + failed API calls per stop).
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const url = args.url || 'http://localhost:5173';
const out = args.out || '/tmp/tour';
const width = Number(args.width || 390);
const height = Number(args.height || 844);
const apiBase = (args.api && args.api !== true ? args.api : '').replace(/\/$/, ''); // cross-origin builds (native-like)
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 800, isMobile: width < 800, ignoreHTTPSErrors: true });
let problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g|images\.unsplash/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(url, '')}`); });
if (args.theme) await page.addInitScript((t) => { try { localStorage.setItem('km-theme', t); } catch { /* */ } }, args.theme);

await page.goto(`${url}/#/home`, { waitUntil: 'domcontentloaded' });
try { const d = page.getByText('Explore the demo book'); await d.waitFor({ timeout: 5000 }); await d.click(); } catch { /* signed in */ }
await page.waitForSelector('.km-tabbar', { timeout: 20000 });

// Look up ids for deep links.
const ids = await page.evaluate(async (base) => {
  const tok = localStorage.getItem('km_at');
  const h = { Authorization: `Bearer ${tok}` };
  const j = async (p) => { try { const r = await fetch(`${base}/api${p}`, { headers: h }); return r.ok ? r.json() : {}; } catch { return {}; } };
  const [c, cv, d, l, ca] = await Promise.all([j('/clients?limit=5&sort=recent'), j('/conversations?limit=5'), j('/deals?limit=5&open=1'), j('/listings?limit=5'), j('/campaigns')]);
  return {
    client: (c.clients || [])[0]?.id, conversation: (cv.conversations || [])[0]?.id,
    deal: (d.deals || [])[0]?.id, listing: (l.listings || [])[0]?.id, campaign: (ca.campaigns || [])[0]?.id,
  };
}, apiBase);

const stops = [
  ['home', '#/home'],
  ['stats', '#/home', async () => { try { await page.getByText('STATS', { exact: true }).first().click({ timeout: 3000 }); } catch { await page.evaluate(() => { const el = document.querySelector('[data-page="stats"], [data-dashboard-page="1"]'); if (el) el.scrollIntoView({ inline: 'start' }); }); } }],
  ['inbox', '#/inbox'],
  ['thread', ids.conversation ? `#/inbox?o=thread:${ids.conversation}` : null],
  ['phone', '#/phone'],
  ['clients', '#/clients'],
  ['client-card', ids.client ? `#/clients?o=client:${ids.client}` : null],
  ['matchmaker', '#/matchmaker'],
  ['pipeline', '#/home?o=pipeline'],
  ['deal', ids.deal ? `#/home?o=deal:${ids.deal}` : null],
  ['listings', '#/home?o=listings'],
  ['listing', ids.listing ? `#/home?o=listing:${ids.listing}` : null],
  ['calendar', '#/home?o=calendar'],
  ['commissions', '#/home?o=commissions'],
  ['book', '#/home?o=book'],
  ['campaigns', '#/home?o=campaigns'],
  ['campaign', ids.campaign ? `#/home?o=campaign:${ids.campaign}` : null],
  ['waitlists', '#/clients?o=waitlists'],
  ['serena', '#/home?o=serena'],
  ['search', '#/home?o=search'],
  ['notifications', '#/home?o=notifications'],
  ['settings', '#/home?o=settings'],
].filter(([, h]) => h);

const report = [`ids: ${JSON.stringify(ids)}`];
let n = 0;
for (const [name, hash, after] of stops) {
  problems = [];
  await page.evaluate((h) => { location.hash = '#/home'; window.dispatchEvent(new PopStateEvent('popstate')); }, hash);
  await page.waitForTimeout(150);
  await page.evaluate((h) => { location.hash = h; window.dispatchEvent(new PopStateEvent('popstate')); }, hash);
  // Hash → state only applies on cold load; reload for overlay deep links.
  if (hash.includes('?o=')) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.km-tabbar', { timeout: 15000 }).catch(() => {}); }
  else { await page.evaluate((h) => { const tab = h.slice(2).split('?')[0]; const btn = document.querySelector(`[data-tab="${tab}"]`); if (btn) btn.click(); }, hash); }
  await page.waitForTimeout(Number(args.wait || 1800));
  if (after) { try { await after(); await page.waitForTimeout(700); } catch { /* */ } }
  const file = `${out}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  report.push(`\n## ${name} (${hash})\n${problems.length ? [...new Set(problems)].join('\n') : 'ok'}`);
  console.log(`${name}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}`);
}
writeFileSync(`${out}/report.txt`, report.join('\n'));
console.log(`report → ${out}/report.txt`);
await browser.close();
