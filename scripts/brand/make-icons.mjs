#!/usr/bin/env node
// Brand asset generator — renders the KeyMatch mark (a thin ring with a
// keyhole and one highlight dot on the ring, see web/src/components/ui/
// BrandMark.jsx and docs/BRAND.md) into every app icon, splash and web icon.
//
//   node scripts/brand/make-icons.mjs
//
// Uses the headless Chromium that Playwright already ships with the web app.
// The 1024 App Store icon must have no alpha channel: when ImageMagick is on
// the PATH the script flattens every PNG; otherwise it tells you to.
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = path.join(ROOT, 'web');
const FLOOR = '#0D0D0D';
const LIFT = '#1F1F1F';
const VOLT = '#D4FF3F';

// The mark in a 1024 box. `k` scales the whole glyph (1 = icon size).
function mark(k = 1, cx = 512, cy = 512, { gap = FLOOR } = {}) {
  const s = (v) => +(v * k).toFixed(2);
  const r = s(250);
  const dx = cx + r * Math.cos(Math.PI / 4);
  const dy = cy - r * Math.sin(Math.PI / 4);
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-width="${s(20)}"/>
    <circle cx="${cx}" cy="${cy - s(42)}" r="${s(60)}" fill="#FFFFFF"/>
    <path d="M${cx - s(27)} ${cy - s(8)} H${cx + s(27)} L${cx + s(45)} ${cy + s(118)} H${cx - s(45)} Z" fill="#FFFFFF"/>
    <circle cx="${dx}" cy="${dy}" r="${s(46)}" fill="${VOLT}" stroke="${gap}" stroke-width="${s(18)}"/>`;
}

function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs><radialGradient id="lift" cx="50%" cy="22%" r="85%">
      <stop offset="0" stop-color="${LIFT}"/><stop offset="1" stop-color="${FLOOR}"/></radialGradient></defs>
    <rect width="1024" height="1024" fill="url(#lift)"/>
    ${mark(1, 512, 512, { gap: '#151515' })}
  </svg>`;
}

function splashSvg(size) {
  // Dark mist with the mark small in the middle — no baked wordmark.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs><radialGradient id="mist" cx="50%" cy="46%" r="60%">
      <stop offset="0" stop-color="#1A1A1A"/><stop offset="1" stop-color="${FLOOR}"/></radialGradient></defs>
    <rect width="1024" height="1024" fill="url(#mist)"/>
    ${mark(0.21, 512, 512, { gap: '#191919' })}
  </svg>`;
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${FLOOR}"/><g transform="translate(32 32) scale(0.0575) translate(-512 -512)">${mark(1, 512, 512, { gap: FLOOR })}</g></svg>
`;

async function render(page, svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${FLOOR}">${svg}</body></html>`);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', path.relative(ROOT, out));
}

const outputs = [
  [iconSvg(1024), 1024, path.join(WEB, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')],
  [iconSvg(512), 512, path.join(WEB, 'public/icon-512.png')],
  [iconSvg(192), 192, path.join(WEB, 'public/icon-192.png')],
  [iconSvg(180), 180, path.join(WEB, 'public/apple-touch-icon.png')],
  ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((f) => [splashSvg(2732), 2732, path.join(WEB, 'ios/App/App/Assets.xcassets/Splash.imageset', f)]),
];

const exe = process.env.CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? undefined : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [svg, size, out] of outputs) await render(page, svg, size, out);
await browser.close();

writeFileSync(path.join(WEB, 'public/favicon.svg'), FAVICON);
console.log('wrote web/public/favicon.svg');

// Flatten (no alpha) — required for the App Store icon, harmless elsewhere.
try {
  for (const [, , out] of outputs) execFileSync('convert', [out, '-background', FLOOR, '-alpha', 'remove', '-alpha', 'off', out]);
  console.log('flattened PNGs (no alpha)');
} catch {
  console.log('ImageMagick not found — flatten the 1024 AppIcon (no alpha) before uploading to App Store Connect.');
}
