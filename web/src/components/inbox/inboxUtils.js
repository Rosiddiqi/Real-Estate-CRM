// Inbox helpers — names, times, previews, tabs, buckets (RevMatch inbox-v2
// rules, re-mapped for real estate).
import { formatPhone } from '../../lib/format';

export const PARTNER_KINDS = new Set(['partner', 'vendor']);

// Row time: today "3:41 PM", "Yesterday", within a week "Tue", older "1/18".
export function fmtInboxTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 6 * 864e5 && d < now) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : null) });
}

const hasLetters = (s) => /[a-zA-Z]/.test(String(s || ''));

export function convName(c) {
  if (!c) return '';
  if (c.name) return c.name;
  const raw = c.displayName || c.handle || '';
  return hasLetters(raw) ? raw : (formatPhone(raw) || 'Unknown');
}

export const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';

// 1:1 thread with no client and a bare number → silhouette, not "+3".
export function isUnnamed(c) {
  if (!c || c.isGroup) return false;
  if (c.clientId || c.client) return false;
  return !hasLetters(c.displayName || c.handle || '');
}

export const isWhaleConv = (c) => !!(c && !c.isGroup && c.client && c.client.isWhale);
export const channelOf = (c) => (c && c.channel === 'sms' ? 'sms' : 'imessage');
export const isUnread = (c) => (c && c.unreadCount) > 0;
export const tsOf = (c) => (c && c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0);

// Which inbox tab a live conversation belongs to.
export function tabOf(c) {
  if (c.lane === 'automations') return 'automations';
  if (c.client && PARTNER_KINDS.has(c.client.contactKind)) return 'partners';
  return 'clients';
}

export function matchesFilter(c, filter) {
  switch (filter) {
    case 'unread': return isUnread(c);
    case 'pinned': return !!c.pinned;
    case 'imessage': return channelOf(c) === 'imessage';
    case 'sms': return channelOf(c) === 'sms';
    case 'questions': return c.lastMessageFromMe === false && String(c.lastMessagePreview || '').includes('?');
    default: return true;
  }
}

export const byLastDesc = (a, b) => tsOf(b) - tsOf(a) || String(b.id).localeCompare(String(a.id));

// Needs Response (unread) → Active Today (last message today) → Quiet
// (everything else + muted). Every bucket sorts by last activity, newest first.
export function bucketize(list) {
  const today = new Date().toDateString();
  const needs = [];
  const active = [];
  const quiet = [];
  for (const c of list) {
    if (c.muted) { quiet.push(c); continue; }
    if (isUnread(c)) { needs.push(c); continue; }
    if (c.lastMessageAt && new Date(c.lastMessageAt).toDateString() === today) { active.push(c); continue; }
    quiet.push(c);
  }
  needs.sort(byLastDesc); active.sort(byLastDesc); quiet.sort(byLastDesc);
  return { needs, active, quiet };
}

// Row preview: "You: " prefix for our own last message.
export function previewOf(c) {
  const body = String(c.lastMessagePreview || '').trim();
  if (!body) return c.lastMessageAt ? '' : 'No messages yet';
  return c.lastMessageFromMe ? `You: ${body}` : body;
}

// Real-estate intent chip on an unanswered inbound (mirrors server intent.js).
const DAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|tomorrow|tonight|this (?:weekend|week|afternoon|evening|morning)|next week|weekend';
const DAY_RE = new RegExp(`\\b(${DAY})\\b|\\b\\d{1,2}(:\\d{2})?\\s?(am|pm)\\b|\\bwhen can\\b|\\bcan we\\b|\\bcould we\\b|\\bavailable\\b`, 'i');
const INTENTS = [
  ['SHOWING', (t) => (/\b(see|tour|view|visit|walk ?through|look at|check out|go by|stop by|showing|preview)\b/i.test(t) && DAY_RE.test(t)) || /\b(schedule|book|set up) (a )?(showing|tour|viewing|private showing)\b/i.test(t)],
  ['OFFER', (t) => /\b(make|put in|submit|write|send) (an |our |the )?offer\b|\bcounter(-| )?offer\b|\boffer (in|on)\b|\bwould they (take|accept)\b/i.test(t)],
  ['HOA', (t) => /\b(hoa|association (fee|dues)|maintenance fee|condo fee|special assessment|property tax(es)?)\b/i.test(t)],
  ['CMA', (t) => /\bwhat('?s| is| would) (my|our|the) (home|house|place|condo|property|unit) (be )?worth\b|\b(cma|valuation|apprais(al|e))\b/i.test(t)],
  ['LISTING', (t) => /\b(thinking (about|of) selling|ready to sell|want to sell|list (our|my) (home|house|place|condo)|on the market)\b/i.test(t)],
  ['FINANCING', (t) => /\b(pre-?approv\w*|mortgage|lender|jumbo|interest rate|proof of funds)\b/i.test(t)],
  ['DOCS', (t) => /\b(disclosures?|survey|inspection report|floor ?plans?|elevation certificate)\b/i.test(t)],
  ['CALL BACK', (t) => /\b(call me|give me a call|can you call|hop on a call|quick call)\b/i.test(t)],
];
export function rowIntent(c) {
  if (!c || c.lastMessageFromMe !== false || !isUnread(c)) return null;
  const t = String(c.lastMessagePreview || '');
  for (const [label, test] of INTENTS) if (test(t)) return label;
  return t.includes('?') ? 'REPLY' : null;
}

// Search snippet highlighting → [{ text, hit }]
export function highlightParts(text, q) {
  const s = String(text || '');
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [{ text: s, hit: false }];
  const out = [];
  const lower = s.toLowerCase();
  let i = 0;
  while (i < s.length) {
    const j = lower.indexOf(needle, i);
    if (j < 0) { out.push({ text: s.slice(i), hit: false }); break; }
    if (j > i) out.push({ text: s.slice(i, j), hit: false });
    out.push({ text: s.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  return out;
}
