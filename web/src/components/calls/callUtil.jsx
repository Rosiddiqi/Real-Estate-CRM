// Shared call helpers: classification, durations, names, the direction glyph.
import Icon from '../ui/Icon';
import { formatPhone } from '../../lib/format';

export function classify(c) {
  if (!c) return 'outgoing';
  if (c.status === 'voicemail') return 'voicemail';
  const inbound = c.direction === 'inbound';
  if (inbound && ['missed', 'no_answer', 'busy'].includes(c.status)) return 'missed';
  if (inbound) return 'incoming';
  return 'outgoing';
}

export function callName(c) {
  if (!c) return 'Unknown';
  if (c.client && c.client.name) return c.client.name;
  return c.otherNumber ? formatPhone(c.otherNumber) : 'Unknown';
}

// 45s · 3m 12s · 1h 4m
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (!s) return null;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// 03:12 / 1:04:09
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

// 0:38 (voicemail lengths)
export function fmtShort(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function shortTime(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - date < 6 * 864e5) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function dayGroup(d) {
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function DirectionGlyph({ kind, size = 13 }) {
  if (kind === 'missed') return <Icon name="phoneMissed" size={size} color="var(--red)" stroke={2.2} />;
  if (kind === 'voicemail') return <Icon name="voicemail" size={size} color="var(--violet)" stroke={2.2} />;
  if (kind === 'incoming') return <Icon name="phoneIncoming" size={size} color="var(--green)" stroke={2.2} />;
  return <Icon name="phoneOutgoing" size={size} color="var(--faint)" stroke={2.2} />;
}

export const KIND_LABEL = { missed: 'Missed', incoming: 'Incoming', outgoing: 'Outgoing', voicemail: 'Voicemail' };
