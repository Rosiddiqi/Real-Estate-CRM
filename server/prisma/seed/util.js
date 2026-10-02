// Shared helpers for the KeyMatch demo seed: deterministic PRNG + ids, a
// time context anchored to the moment the seed runs (America/New_York),
// photo + geo helpers and a tiny text templater for relative dates.
const crypto = require('node:crypto');
const { dayKey, zonedTime, addDays, weekdayIndex, monthBounds, yearBounds, partsIn } = require('../../src/lib/dates');
const { normalizePhone } = require('../../src/lib/phone');

const TZ = 'America/New_York';
const DAY = 864e5;

// ── Deterministic randomness ──────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed = 20261002) {
  const r = mulberry32(seed);
  const rng = () => r();
  rng.int = (min, max) => Math.floor(r() * (max - min + 1)) + min;
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  rng.chance = (p) => r() < p;
  rng.slug = (n = 10) => {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < n; i += 1) s += abc[Math.floor(r() * abc.length)];
    return s;
  };
  return rng;
}

// Stable UUID (v4 layout) derived from a key, so reseeding keeps ids stable.
function uid(key) {
  const h = crypto.createHash('sha256').update(`keymatch-demo:${key}`).digest('hex');
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ── Time context ──────────────────────────────────────────────────────────
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isWeekend = (dayStr) => [0, 6].includes(weekdayIndex(dayStr));

function shiftYears(dayStr, years) {
  let [y, m, d] = dayStr.split('-').map(Number);
  y -= years;
  if (m === 2 && d === 29) d = 28;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function createCtx(now = new Date()) {
  const today = dayKey(now, TZ);
  const wd = weekdayIndex(today);
  const p = partsIn(now, TZ);
  const ctx = { now, today, wd, TZ, year: p.year, month: p.month, dom: p.day };

  ctx.day = (off) => addDays(today, off);
  ctx.at = (off, h, m = 0) => zonedTime(addDays(today, off), h, m, TZ);
  ctx.atDay = (dayStr, h, m = 0) => zonedTime(dayStr, h, m, TZ);
  ctx.minsAgo = (mins) => new Date(now.getTime() - mins * 60000);
  ctx.daysAgo = (days) => new Date(now.getTime() - days * DAY);
  ctx.startOfToday = zonedTime(today, 0, 0, TZ);
  // A past instant at a local wall-clock time; today's times that haven't
  // happened yet are pulled back to just before "now".
  ctx.past = (off, h, m = 0, guardMin = 4) => {
    const t = ctx.at(off, h, m);
    const lim = new Date(now.getTime() - guardMin * 60000);
    if (t <= lim) return t;
    const floor = off === 0 ? new Date(ctx.startOfToday.getTime() + 60000) : t;
    return lim < floor ? floor : lim;
  };
  // Move an offset forward to the next weekday.
  ctx.bizOff = (off) => { let o = off; while (isWeekend(addDays(today, o))) o += 1; return o; };
  ctx.bizOffBack = (off) => { let o = off; while (isWeekend(addDays(today, o))) o -= 1; return o; };
  ctx.sundayOff = ((7 - wd) % 7) || 7;
  ctx.nextMondayOff = ((8 - wd) % 7) || 7;

  // Date N years before (today+off), nudged forward so it was a weekday.
  ctx.yearsBack = (off, years, h = 11, m = 0) => {
    let o = off;
    for (let i = 0; i < 4; i += 1) {
      const ds = shiftYears(addDays(today, o), years);
      if (!isWeekend(ds)) return { off: o, date: zonedTime(ds, h, m, TZ), day: ds };
      o += 1;
    }
    const ds = shiftYears(addDays(today, o), years);
    return { off: o, date: zonedTime(ds, h, m, TZ), day: ds };
  };

  const mb = monthBounds(now, TZ);
  const yb = yearBounds(now, TZ);
  ctx.monthStart = mb.start;
  ctx.yearStart = yb.start;
  ctx.lastYearStart = zonedTime(`${p.year - 1}-01-01`, 0, 0, TZ);

  // n closing instants earlier this month (prior days first, business hours).
  ctx.mtdSlots = (n) => {
    const days = [];
    for (let o = -1; o >= -(p.day - 1); o -= 1) days.push(o);
    const weekdays = days.filter((o) => !isWeekend(addDays(today, o)));
    const pool = weekdays.length ? weekdays : days;
    const times = [[10, 0], [14, 0], [11, 30], [15, 30], [9, 30], [16, 0]];
    const out = [];
    for (let i = 0; i < n; i += 1) {
      if (pool.length) {
        const o = pool[Math.floor((i * pool.length) / n)];
        const [h, m] = times[i % times.length];
        out.push(ctx.at(o, h, m));
      } else {
        const t = new Date(Math.max(ctx.monthStart.getTime() + (i + 1) * 60000, now.getTime() - (i + 1) * 47 * 60000));
        out.push(t);
      }
    }
    return out.sort((a, b) => a - b);
  };
  // n closing instants spread over the months before this one (this year).
  ctx.ytdSlots = (n) => {
    const span = ctx.monthStart - ctx.yearStart;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const f = (i + 0.5) / n;
      let t = span > 5 * DAY ? new Date(ctx.yearStart.getTime() + f * span) : new Date(ctx.yearStart.getTime() - (1 - f) * 110 * DAY);
      let ds = dayKey(t, TZ);
      while (isWeekend(ds)) ds = addDays(ds, 1);
      out.push(zonedTime(ds, [11, 14, 10, 15][i % 4], [0, 30, 30, 0][i % 4], TZ));
    }
    return out;
  };
  // A day in last year at a fraction of the way through it.
  ctx.lastYearAt = (frac, h = 11) => {
    let ds = dayKey(new Date(ctx.lastYearStart.getTime() + frac * 365 * DAY), TZ);
    while (isWeekend(ds)) ds = addDays(ds, 1);
    return zonedTime(ds, h, 0, TZ);
  };

  ctx.dow = (off) => DOW[weekdayIndex(addDays(today, off))];
  ctx.md = (off) => { const [, m, d] = addDays(today, off).split('-').map(Number); return `${MON[m - 1]} ${d}`; };
  ctx.mmdd = (off) => addDays(today, off).slice(5);
  ctx.off = {}; // named offsets registered by modules ({dxClose: 12, …})
  ctx.resolveOff = (k) => (/^[+-]?\d+$/.test(k) ? Number(k) : ctx.off[k]);
  // "{dow:okClose}" → "Thursday", "{date:+12}" → "Oct 14", "{mon}" → "October"
  ctx.t = (s) => String(s).replace(/\{(dow|date|day):([A-Za-z0-9+-]+)\}/g, (all, kind, key) => {
    const o = ctx.resolveOff(key);
    if (o == null || Number.isNaN(o)) return all;
    if (kind === 'dow') return ctx.dow(o);
    if (kind === 'date') return ctx.md(o);
    return String(Number(addDays(today, o).slice(8)));
  }).replace(/\{mon\}/g, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.month - 1]);
  return ctx;
}

// ── Photos (Unsplash hotlinks) ────────────────────────────────────────────
const EXT = [
  '1613490493576-7fde63acd811', '1600596542815-ffad4c1539a9', '1600585154340-be6161a56a0c', '1512917774080-9991f1c4c750',
  '1580587771525-78b9dba3b914', '1564013799919-ab600027ffc6', '1605276374104-dee2a0ed3cd6', '1600047509807-ba8f99d2cdde',
  '1583608205776-bfd35f0d9f83', '1576941089067-2de3c901e126', '1582268611958-ebfd161ef9cf', '1572120360610-d971b9d7767c',
  '1494526585095-c41746248156', '1568605114967-8130f3a36994', '1570129477492-45c003edd2be', '1600563438938-a9a27216b4f5',
  '1602343168117-bb8ffe3e2e9f', '1599809275671-b5942cabc7a2',
];
const TOWER = ['1545324418-cc1a3fa10c00', '1515263487990-61b07816b324', '1567496898669-ee935f5f647a'];
const INT = [
  '1600607687939-ce8a6c25118c', '1600566753190-17f0baa2a6c3', '1600210492486-724fe5c67fb0', '1600121848594-d8644e57abab',
  '1600573472592-401b489a3cdc', '1600585154526-990dced4db0d', '1600566753086-00f18fb6b3ea', '1502005229762-cf1b2da7c5d6',
  '1493809842364-78817add7ffb', '1484154218962-a197022b5858', '1560448204-e02f11c3d0e2',
];
const img = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1600&q=80`;
const VERTICAL = new Set(['condo', 'penthouse', 'co_op']);

// Hero exterior (tower for condos) + interiors; deterministic by index.
function photoSet(i, propertyType, count = 5) {
  const hero = VERTICAL.has(propertyType) ? img(TOWER[i % TOWER.length]) : img(EXT[i % EXT.length]);
  const list = [hero];
  if (VERTICAL.has(propertyType)) list.push(img(EXT[(i * 5 + 3) % EXT.length]));
  for (let k = 0; list.length < count; k += 1) list.push(img(INT[(i * 3 + k) % INT.length]));
  return { heroPhoto: hero, photos: list };
}

// ── Geography (real place names, fictional streets) ───────────────────────
const GEO = {
  'Star Island': { city: 'Miami Beach', zip: '33139', lat: 25.7776, lng: -80.1517 },
  'Fisher Island': { city: 'Fisher Island', zip: '33109', lat: 25.7606, lng: -80.1418 },
  'Bal Harbour': { city: 'Bal Harbour', zip: '33154', lat: 25.8917, lng: -80.1268 },
  Surfside: { city: 'Surfside', zip: '33154', lat: 25.8785, lng: -80.1254 },
  'Golden Beach': { city: 'Golden Beach', zip: '33160', lat: 25.9652, lng: -80.1203 },
  'Indian Creek': { city: 'Indian Creek', zip: '33154', lat: 25.8762, lng: -80.1372 },
  'Sunset Islands': { city: 'Miami Beach', zip: '33140', lat: 25.7972, lng: -80.1431 },
  'Venetian Islands': { city: 'Miami Beach', zip: '33139', lat: 25.7905, lng: -80.1649 },
  'La Gorce': { city: 'Miami Beach', zip: '33140', lat: 25.8238, lng: -80.1352 },
  'Miami Beach': { city: 'Miami Beach', zip: '33139', lat: 25.7826, lng: -80.1341 },
  'Coral Gables': { city: 'Coral Gables', zip: '33134', lat: 25.7215, lng: -80.2684 },
  'Gables Estates': { city: 'Coral Gables', zip: '33156', lat: 25.6626, lng: -80.2689 },
  'Coconut Grove': { city: 'Miami', zip: '33133', lat: 25.7281, lng: -80.2421 },
  'Key Biscayne': { city: 'Key Biscayne', zip: '33149', lat: 25.6931, lng: -80.1628 },
  Pinecrest: { city: 'Pinecrest', zip: '33156', lat: 25.6671, lng: -80.3079 },
  Brickell: { city: 'Miami', zip: '33131', lat: 25.7617, lng: -80.1918 },
  Edgewater: { city: 'Miami', zip: '33137', lat: 25.8001, lng: -80.1879 },
  'Palm Beach': { city: 'Palm Beach', zip: '33480', lat: 26.7056, lng: -80.0364 },
  'Jupiter Island': { city: 'Jupiter Island', zip: '33455', lat: 27.0401, lng: -80.1102 },
  'Sunny Isles': { city: 'Sunny Isles Beach', zip: '33160', lat: 25.9421, lng: -80.1229 },
  'Las Olas': { city: 'Fort Lauderdale', zip: '33301', lat: 26.1191, lng: -80.1271 },
  'Boca Raton': { city: 'Boca Raton', zip: '33432', lat: 26.3684, lng: -80.1288 },
  'Bay Harbor Islands': { city: 'Bay Harbor Islands', zip: '33154', lat: 25.8871, lng: -80.1331 },
};

function geo(neighborhood, rng) {
  const g = GEO[neighborhood];
  if (!g) return {};
  const j = () => (rng ? (rng() - 0.5) * 0.008 : 0);
  return { city: g.city, state: 'FL', zip: g.zip, lat: +(g.lat + j()).toFixed(5), lng: +(g.lng + j()).toFixed(5) };
}

const phone = (s) => (s ? normalizePhone(s) : null);
const round = (n, to = 1) => Math.round(n / to) * to;

module.exports = {
  TZ, DAY, makeRng, uid, createCtx, photoSet, img, EXT, TOWER, INT, GEO, geo, phone, round, isWeekend,
};
