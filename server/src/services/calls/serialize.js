// Call → API shape (shared by routes, the simulator and realtime events).
const U = require('../serena/util');

const MISSED = ['missed', 'no_answer', 'voicemail'];

function clientLite(c) {
  if (!c) return null;
  return {
    id: c.id, name: U.nameOf(c), firstName: c.firstName || null, lastName: c.lastName || null,
    phone: c.phone || null, avatarUrl: c.avatarUrl || null, isWhale: !!c.isWhale, rating: c.rating || 0,
    type: c.type || null, status: c.status || null,
  };
}

function serializeCall(c, { transcript = false } = {}) {
  if (!c) return null;
  const meta = (c.meta && typeof c.meta === 'object') ? c.meta : {};
  const inbound = c.direction === 'inbound';
  const out = {
    id: c.id,
    clientId: c.clientId || null,
    client: clientLite(c.client),
    direction: c.direction,
    status: c.status,
    missed: inbound && MISSED.includes(c.status),
    fromNumber: c.fromNumber || null,
    toNumber: c.toNumber || null,
    otherNumber: (inbound ? c.fromNumber : c.toNumber) || null,
    startedAt: c.startedAt,
    answeredAt: c.answeredAt || null,
    endedAt: c.endedAt || null,
    durationSec: c.durationSec || 0,
    recordingUrl: c.recordingUrl || null,
    summary: c.summary || null,
    summaryBullets: Array.isArray(c.summaryBullets) ? c.summaryBullets : [],
    suggestions: Array.isArray(c.aiSuggestions) ? c.aiSuggestions.map(({ undoToken, ...s }) => ({ ...s, undoable: !!undoToken })) : [],
    sentiment: c.sentiment || null,
    voicemailUrl: c.voicemailUrl || null,
    voicemailTranscript: c.voicemailTranscript || null,
    voicemailHeard: !!c.voicemailHeard,
    mode: meta.mode || (c.externalId && String(c.externalId).startsWith('SIM') ? 'simulated' : meta.source === 'logged' ? 'logged' : 'phone'),
    recapStatus: meta.recapStatus || (c.summary ? 'ready' : null),
    topic: meta.topic || null,
    outcome: meta.outcome || null,
    briefing: meta.briefing || null,
    notes: Array.isArray(meta.notes) ? meta.notes : [],
    held: !!meta.held,
  };
  if (transcript) out.transcript = Array.isArray(c.transcript) ? c.transcript : [];
  return out;
}

module.exports = { serializeCall, clientLite, MISSED };
