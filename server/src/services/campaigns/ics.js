// Calendar invite (.ics) for a campaign event (open houses, broker caravans,
// client events). Written to uploads/invites/<content-hash>.ics and served by
// the static /uploads route, so the link can be texted (one tap adds it to
// their calendar). Same event → same file; any edit → a new file.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');

const DEFAULT_HOURS = 3;

function inviteEnabled(campaign) {
  const ev = campaign && campaign.event;
  if (!ev || !ev.startAt || Number.isNaN(new Date(ev.startAt).getTime())) return false;
  return ev.calendarInvite !== false;
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function utc(d) { return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function fold(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, 'utf8') > 75) {
    let cut = 75;
    while (cut > 1 && Buffer.byteLength(s.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(s.slice(0, cut));
    s = ` ${s.slice(cut)}`;
  }
  out.push(s);
  return out.join('\r\n');
}

function buildIcs(campaign, { agentName } = {}) {
  const ev = campaign.event || {};
  const start = new Date(ev.startAt);
  let end = ev.endAt ? new Date(ev.endAt) : null;
  if (!end || Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + DEFAULT_HOURS * 3600000);
  const title = String(ev.title || campaign.name || 'Open House').trim();
  const uid = `${campaign.id}-${utc(start)}@keymatch`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KeyMatch//Campaign Invite//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(title)}`,
    ev.address ? `LOCATION:${esc(ev.address)}` : null,
    `DESCRIPTION:${esc(`${title}${agentName ? ` with ${agentName}` : ''}${ev.address ? `\n${ev.address}` : ''}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).map(fold);
  return `${lines.join('\r\n')}\r\n`;
}

// -> { url: '/uploads/invites/<hash>.ics', absoluteUrl, fileName, mimeType } | null
function inviteFile(campaign, opts = {}) {
  if (!inviteEnabled(campaign)) return null;
  const body = buildIcs(campaign, opts);
  const hash = crypto.createHash('sha1').update(body.replace(/DTSTAMP:[^\r\n]+/, '')).digest('hex').slice(0, 20);
  const dir = path.join(config.uploadsDir, 'invites');
  const file = path.join(dir, `${hash}.ics`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, body);
  } catch (err) {
    console.error('[campaigns/ics] write failed:', err.message);
    return null;
  }
  const url = `/uploads/invites/${hash}.ics`;
  return { url, absoluteUrl: `${String(config.appUrl || '').replace(/\/$/, '')}${url}`, fileName: 'invite.ics', mimeType: 'text/calendar' };
}

module.exports = { buildIcs, inviteFile, inviteEnabled };
