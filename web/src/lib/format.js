// Formatting helpers — the single source of truth for how numbers, money,
// phones and times read across the app (ported from RevMatch formatters.js,
// plus real-estate money formats).

// ── People ────────────────────────────────────────────────────────────────
// Returns null when the label has no letters (an unsaved phone number):
// callers render a silhouette avatar instead of "+9".
export function getInitials(name) {
  const s = String(name || '').trim();
  if (!s || !/[a-zA-Z]/.test(s)) return null;
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase()).slice(0, 2).join('');
}

export function fullName(p) {
  if (!p) return '';
  if (p.displayName) return p.displayName;
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.name || formatPhone(p.phone) || p.email || 'Unknown';
}

export function firstName(p) {
  if (!p) return '';
  return p.firstName || String(fullName(p)).split(' ')[0];
}

// ── Phones ────────────────────────────────────────────────────────────────
export function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits.slice(-10);
}

// Bare-number display everywhere: 305-555-0142 (no +1).
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (ten.length === 10) return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  return phone || '';
}

// Format as the user types (hyphens at 3 and 6; leading + preserved).
export function formatPhoneInput(raw) {
  if (raw == null) return '';
  const s = String(raw);
  if (s === '') return '';
  const hasPlus = s.trim().startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (digits.length === 0) return hasPlus ? '+' : '';
  if (digits.length === 11 && digits[0] === '1') {
    const a = digits.slice(1, 4); const b = digits.slice(4, 7); const c = digits.slice(7);
    return `${hasPlus ? '+1' : '1'}-${a}${b ? `-${b}` : ''}${c ? `-${c}` : ''}`;
  }
  if (digits.length <= 3) return hasPlus ? `+${digits}` : digits;
  if (digits.length <= 6) return `${hasPlus ? '+' : ''}${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${hasPlus ? '+' : ''}${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${hasPlus ? '+' : ''}${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
}

// ── Money ─────────────────────────────────────────────────────────────────
// $4,250,000
export function money(n, { cents = false } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0,
  });
}

// $4.25M · $850K · $12.5K · $950
export function moneyCompact(n, { digits } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const trim = (x, d) => {
    const s = x.toFixed(d);
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  };
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9, digits ?? 2)}B`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6, digits ?? 2)}M`;
  if (abs >= 1e4) return `${sign}$${trim(abs / 1e3, digits ?? 0)}K`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3, digits ?? 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// "$3.5M–$6M" budget ranges
export function moneyRange(min, max) {
  if (min && max) return `${moneyCompact(min)}–${moneyCompact(max)}`;
  if (max) return `Up to ${moneyCompact(max)}`;
  if (min) return `${moneyCompact(min)}+`;
  return 'Any price';
}

export function pct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const s = v.toFixed(digits);
  return `${s.includes('.') ? s.replace(/\.?0+$/, '') : s}%`;
}

export function num(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US');
}

// ── Property specs ────────────────────────────────────────────────────────
export function sqft(n) {
  if (!n) return '—';
  return `${Number(n).toLocaleString('en-US')} sq ft`;
}

export function pricePerSqft(price, area) {
  if (!price || !area) return null;
  return `$${Math.round(price / area).toLocaleString('en-US')}/sq ft`;
}

// "5 bd · 6.5 ba · 7,850 sq ft"
export function specLine(p) {
  if (!p) return '';
  const parts = [];
  if (p.beds != null) parts.push(`${p.beds} bd`);
  if (p.baths != null) parts.push(`${p.baths} ba`);
  if (p.sqft) parts.push(`${Number(p.sqft).toLocaleString('en-US')} sq ft`);
  return parts.join(' · ');
}

export function lotSize(acres, sqftLot) {
  if (acres) return `${Number(acres).toFixed(acres < 1 ? 2 : 1).replace(/\.?0+$/, '')} ac lot`;
  if (sqftLot) return `${Number(sqftLot).toLocaleString('en-US')} sq ft lot`;
  return null;
}

// ── Time (iMessage conventions) ──────────────────────────────────────────
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d) {
  return d ? sameDay(new Date(d), new Date()) : false;
}

// Inbox row time: "9:41 AM" today, "Yesterday", weekday within a week, else 10/2/26.
export function listTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const future = diff < 0;
  const a = Math.abs(diff);
  const mins = Math.floor(a / 60000);
  const hours = Math.floor(a / 3600000);
  const days = Math.floor(a / 86400000);
  let s;
  if (mins < 1) return 'now';
  if (mins < 60) s = `${mins}m`;
  else if (hours < 24) s = `${hours}h`;
  else if (days < 7) s = `${days}d`;
  else if (days < 60) s = `${Math.floor(days / 7)}w`;
  else return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return future ? `in ${s}` : `${s} ago`;
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 864e5);
}

// Day separator label: "Today", "Yesterday", "Thursday, Apr 3"
export function formatDaySep(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  if (sameDay(date, now)) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(date, y)) return 'Yesterday';
  const opts = { weekday: 'long', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

export function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(dateStr, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', opts);
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${formatDaySep(d)} · ${formatTime(d)}`;
}

// Separator type before a message: 'day' | 'time' (gap > 3h) | null
export function separatorType(msg, prev, key = 'sentAt') {
  if (!prev) return 'day';
  const a = new Date(msg[key] || msg.createdAt);
  const b = new Date(prev[key] || prev.createdAt);
  if (!sameDay(a, b)) return 'day';
  if (Math.abs(a - b) > 3 * 3600000) return 'time';
  return null;
}

// Group with previous bubble: same sender, < 60s, same day.
export function shouldGroup(msg, prev, key = 'sentAt') {
  if (!prev) return false;
  if (msg.isFromMe !== prev.isFromMe) return false;
  const a = new Date(msg[key] || msg.createdAt);
  const b = new Date(prev[key] || prev.createdAt);
  if (!sameDay(a, b)) return false;
  return Math.abs(a - b) < 60000;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function dateKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
