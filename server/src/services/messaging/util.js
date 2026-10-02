// Small pure helpers shared by the messaging services (no DB access here, so
// they are unit-testable).
const { normalizePhone } = require('../../lib/phone');

// Every stored form a phone handle might take (seed/imports are normalized to
// 10 digits, but providers hand us E.164). Emails pass through lower-cased.
function handleVariants(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.includes('@')) return [s.toLowerCase(), s];
  const n = normalizePhone(s);
  if (!n) return [];
  const out = new Set([n]);
  if (n.length === 10) { out.add(`+1${n}`); out.add(`1${n}`); }
  else out.add(`+${n}`);
  return [...out];
}

function normalizeHandle(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.includes('@')) return s.toLowerCase();
  return normalizePhone(s);
}

// Short codes (3–6 digit senders: banks, 2FA) are never ingested.
function isShortCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return !String(raw || '').includes('@') && d.length >= 3 && d.length <= 6;
}

function kindOfMime(mime = '', fileName = '') {
  const m = String(mime || '').toLowerCase();
  const fn = String(fileName || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/.test(fn)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(fn)) return 'video';
  if (m.startsWith('audio/') || /\.(caf|m4a|amr|aac|mp3|wav|ogg|webm)$/.test(fn)) return 'audio';
  return 'file';
}

// Conversation-row preview (≤100 chars, attachment-only → noun).
function previewFor({ body, attachments = [], kind, meta } = {}) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (kind === 'listing' && meta && meta.listing) {
    const l = meta.listing;
    const label = l.title || l.address || 'a listing';
    const note = stripUrls(text);
    return truncate(note ? `${note}` : `Listing: ${label}`, 100);
  }
  if (text) return truncate(text, 100);
  const atts = attachments || [];
  if (!atts.length) return kind === 'call' ? 'Call' : '';
  const kinds = atts.map((a) => a.kind || kindOfMime(a.mimeType, a.fileName));
  if (kinds.every((k) => k === 'audio')) return 'Audio Message';
  if (kinds.every((k) => k === 'image')) return atts.length > 1 ? `${atts.length} Photos` : 'Photo';
  if (kinds.every((k) => k === 'video')) return atts.length > 1 ? `${atts.length} Videos` : 'Video';
  return atts.length > 1 ? `${atts.length} Attachments` : 'Attachment';
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
function stripUrls(s) {
  return String(s || '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
}
function firstUrl(s) {
  const m = String(s || '').match(/\bhttps?:\/\/[^\s<>"')]+/i);
  return m ? m[0].replace(/[.,;:!?)\]}>'"]+$/, '') : null;
}

// Service normalization: providers and the composer speak 'iMessage' / 'SMS'
// / 'imessage' / 'sms' / 'RCS' / 'MMS'; the DB stores 'imessage' | 'sms' | 'email'.
function normService(s, fallback = 'imessage') {
  const v = String(s || '').toLowerCase();
  if (!v) return fallback;
  if (v.includes('mail')) return 'email';
  if (v === 'imessage' || v === 'ios' || v === 'blue') return 'imessage';
  if (v === 'sms' || v === 'mms' || v === 'rcs' || v === 'text' || v === 'green') return 'sms';
  return fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve with fallback when a promise takes too long (AI never blocks UI).
function withTimeout(promise, ms, fallback = null) {
  let t;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { t = setTimeout(() => resolve(fallback), ms); if (t.unref) t.unref(); }),
  ]).finally(() => clearTimeout(t));
}

// "Elena" from a client row (displayName fallback).
function firstNameOf(client) {
  if (!client) return '';
  if (client.firstName) return client.firstName;
  const n = String(client.displayName || '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

module.exports = {
  handleVariants, normalizeHandle, isShortCode, kindOfMime, previewFor, truncate,
  stripUrls, firstUrl, normService, sleep, withTimeout, firstNameOf,
};
