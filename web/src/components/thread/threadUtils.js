// Pure helpers for the thread renderer (ported from RevMatch extractUrls /
// urlDetect / linkify / formatters).
import { formatDaySep, formatTime } from '../../lib/format';

// ── URLs (ONE detector for linkify, cards and the iMessage split) ─────────
const TLDS = 'com|net|org|io|co|app|dev|ai|us|uk|ca|me|tv|info|biz|cc|edu|gov|shop|realty|homes|house|properties|estate|luxury|land|miami|nyc|la';
// (No regex lookbehind — older WKWebViews throw on it.)
function urlRegex() {
  return new RegExp(
    `(https?:\\/\\/[^\\s<>"']+)|(www\\.[^\\s<>"']+)|(?:^|[^@\\w.])((?:[a-z0-9-]+\\.)+(?:${TLDS})(?:\\/[^\\s<>"']*)?)(?![\\w-])`,
    'gi',
  );
}
const TRAIL = /[.,;:!?)\]}>'"]+$/;

export function findUrls(text) {
  const out = [];
  const s = String(text || '');
  const re = urlRegex();
  let m;
  while ((m = re.exec(s))) {
    const hit = m[1] || m[2] || m[3];
    if (!hit) continue;
    const index = m.index + (m[0].length - hit.length);
    const raw = hit.replace(TRAIL, '');
    if (raw.length < 6) continue;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    out.push({ raw, href, index, end: index + raw.length });
  }
  return out;
}

export function firstUrl(text) {
  const u = findUrls(text)[0];
  return u ? u.href : null;
}

// iMessage split: a link at the very start or end of the body lives in the
// preview card, not in the bubble text. A mid-sentence link stays inline.
export function splitBodyLink(text) {
  const s = String(text || '');
  const urls = findUrls(s);
  if (!urls.length) return { text: s, url: null };
  const u = urls[0];
  const before = s.slice(0, u.index).trim();
  const tail = s.slice(u.end).trim();
  const after = /^[.,;:!?)\]]*$/.test(tail) ? '' : tail;
  if (!before) return { text: after, url: u.href };
  if (!after) return { text: before, url: u.href };
  return { text: s, url: u.href, inline: true };
}

// Text → [{ type:'text'|'link', value, href }]
export function linkifyParts(text) {
  const s = String(text || '');
  const parts = [];
  let last = 0;
  for (const u of findUrls(s)) {
    if (u.index > last) parts.push({ type: 'text', value: s.slice(last, u.index) });
    parts.push({ type: 'link', value: u.raw, href: u.href });
    last = u.end;
  }
  if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });
  return parts;
}

// ── emoji-only bodies render big with no bubble (1–3 emoji) ──────────────
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|\s)+$/u;
export function emojiCount(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 32 || !EMOJI_ONLY.test(s)) return 0;
  try {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const n = [...seg.segment(s.replace(/\s+/g, ''))].length;
    return n >= 1 && n <= 3 ? n : 0;
  } catch {
    return 0;
  }
}

// ── tapbacks ──────────────────────────────────────────────────────────────
export const TAPBACKS = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];

// Net state per sender+type, grouped for the badge row.
export function aggregateReactions(reactions = []) {
  const byType = new Map();
  for (const r of reactions || []) {
    const key = r.type === 'emoji' ? `emoji:${r.emoji}` : r.type;
    const cur = byType.get(key) || { key, type: r.type, emoji: r.emoji, count: 0, mine: false };
    cur.count += 1;
    if (r.isFromMe) cur.mine = true;
    byType.set(key, cur);
  }
  return [...byType.values()];
}

// ── services / channels ───────────────────────────────────────────────────
export function serviceOf(m) {
  const s = String((m && m.service) || '').toLowerCase();
  if (s === 'sms' || s === 'rcs' || s === 'mms') return 'sms';
  if (s === 'email') return 'email';
  return 'imsg';
}
export const channelLabel = (c) => (c === 'sms' ? 'Text Message' : 'iMessage');

// ── timeline math ─────────────────────────────────────────────────────────
export const msgTime = (m) => (m && (m.sentAt || m.createdAt)) || null;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function separatorFor(m, prev) {
  if (!prev) return 'day';
  const a = new Date(msgTime(m));
  const b = new Date(msgTime(prev));
  if (!sameDay(a, b)) return 'day';
  if (Math.abs(a - b) > 3 * 3600_000) return 'time';
  return null;
}

export function groupedWith(m, prev) {
  if (!prev || prev.isFromMe !== m.isFromMe) return false;
  if (!isBubble(prev) || !isBubble(m)) return false;
  const a = new Date(msgTime(m));
  const b = new Date(msgTime(prev));
  return sameDay(a, b) && Math.abs(a - b) < 60_000;
}

export function isBubble(m) {
  return !!m && !['activity', 'call', 'system', 'timeline'].includes(m.kind);
}

// "Today 9:41 AM" (iMessage: day bold, time regular)
export function sepLabel(m) {
  const t = msgTime(m);
  if (!t) return { day: '', time: '' };
  return { day: formatDaySep(t), time: formatTime(t) };
}

export function statusLabel(m) {
  if (!m) return null;
  if (m._failed || m.status === 'failed') return null;
  if (m.status === 'read') return { strong: 'Read', rest: m.readAt ? formatTime(m.readAt) : '' };
  if (m.status === 'delivered') return { strong: '', rest: m.service === 'sms' ? 'Delivered' : 'Delivered' };
  if (m.status === 'sent') return { strong: '', rest: m.service === 'sms' ? 'Sent as Text Message' : 'Sent' };
  if (m.status === 'sending' || m._optimistic) return { strong: '', rest: 'Sending…' };
  if (m.status === 'queued') return { strong: '', rest: 'Queued' };
  return { strong: '', rest: 'Sent' };
}

export function scheduledCaption(when) {
  if (!when) return 'Scheduled';
  const d = new Date(when);
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const day = sameDay(d, now) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `Will be sent ${day} at ${formatTime(d)}`;
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fileSizeLabel(bytes) {
  if (!bytes) return null;
  const kb = bytes / 1024;
  if (kb > 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(kb))} KB`;
}

export function attachmentKind(a) {
  if (!a) return 'file';
  if (a.kind && a.kind !== 'file') return a.kind;
  const m = String(a.mimeType || '').toLowerCase();
  const fn = String(a.fileName || a.url || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/.test(fn)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|mov|m4v|webm)(\?|$)/.test(fn)) return 'video';
  if (m.startsWith('audio/') || /\.(caf|m4a|amr|aac|mp3|wav|ogg)(\?|$)/.test(fn)) return 'audio';
  return 'file';
}

export const isTouchDevice = () => {
  try { return window.matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; }
};

export const tempId = () => `tmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
