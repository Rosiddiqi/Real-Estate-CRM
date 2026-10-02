// Campaign time helpers in the agent's zone. The server writes event times
// into texts and keeps quiet hours in the workspace timezone, so the builder's
// date/time inputs and every label here use that same zone, not whatever zone
// the device happens to be in (a laptop on travel, a UTC test browser).
import { useAuth } from '../../hooks/useAuth';

let TZ = null;

const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const campaignTz = () => TZ || deviceTz();

// Call at the top of each campaign surface; children format with the result.
export function useCampaignTz() {
  const { workspace, user } = useAuth() || {};
  const tz = (workspace && workspace.timezone) || (user && user.timezone) || null;
  if (tz && tz !== TZ) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); TZ = tz; } catch { /* unknown zone: keep device */ }
  }
  return campaignTz();
}

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  return fmtCache.get(tz);
}

// Wall-clock parts of an instant in tz.
export function partsIn(date, tz = campaignTz()) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second };
}

function offsetMs(ms, tz) {
  const p = partsIn(new Date(ms), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' + 'HH:mm' wall clock in tz → ISO instant (DST-safe).
export function zonedIso(date, time, tz = campaignTz()) {
  if (!date || !time) return null;
  const [y, m, d] = String(date).split('-').map(Number);
  const [h, mi] = String(time).split(':').map(Number);
  if ([y, m, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return new Date(t).toISOString();
}

// ISO instant → { date: 'YYYY-MM-DD', time: 'HH:mm' } wall clock in tz.
export function zonedParts(iso, tz = campaignTz()) {
  if (!iso) return { date: '', time: '' };
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return { date: '', time: '' };
  const p = partsIn(x, tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

// datetime-local value ('YYYY-MM-DDTHH:mm') for an instant, in tz.
export function zonedInput(d, tz = campaignTz()) {
  if (!d) return '';
  const { date, time } = zonedParts(d, tz);
  return date ? `${date}T${time}` : '';
}

// datetime-local value → ISO instant, reading it as tz wall clock.
export function inputIso(v, tz = campaignTz()) {
  if (!v) return null;
  return zonedIso(String(v).slice(0, 10), String(v).slice(11, 16), tz);
}

export const dayKeyIn = (d, tz = campaignTz()) => zonedParts(d, tz).date;

// Intl formatting in the agent's zone.
export function fmtTz(d, opts, tz = campaignTz()) {
  try { return new Date(d).toLocaleString('en-US', { ...opts, timeZone: tz }); } catch { return ''; }
}
