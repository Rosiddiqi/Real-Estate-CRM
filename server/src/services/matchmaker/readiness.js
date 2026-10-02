// Readiness / priority layer — kept OUT of the fit score (spec 06 §8.4).
// The score answers "how well does this home fit what they asked for"; this
// answers "who do I call first". Ordering uses fit first, priority second.
//
//   priority = round(100 × (0.40·urgency + 0.30·financing + 0.20·relationship + 0.10·recency))

const DAY = 864e5;

function urgencyOf(timeline) {
  const t = String(timeline || '').toLowerCase().trim();
  if (!t) return 0.15;
  if (/asap|now|immediate|urgent|30\s*d|this month|1 month|2 weeks|weeks/.test(t)) return 1;
  if (/90\s*d|3 ?mo|three months|this quarter|60\s*d|2 ?mo/.test(t)) return 0.8;
  if (/6 ?mo|six months|half|spring|summer|fall|autumn|winter|season/.test(t)) return 0.5;
  if (/12 ?mo|1 ?y|year|next year/.test(t)) return 0.3;
  return 0.15; // someday / unknown
}

function financingOf(financing, client, now) {
  const f = String(financing || (client && client.financing) || '').toLowerCase();
  if (/cash|pof|proof/.test(f)) return 1;
  if (/pre-?approved|preapproved/.test(f)) {
    const exp = client && client.preApprovalExpires ? new Date(client.preApprovalExpires).getTime() : null;
    return exp && exp < now ? 0.5 : 0.85;
  }
  if (/pre-?qual/.test(f)) return 0.5;
  if (/contingent|sale/.test(f)) return 0.4;
  return 0.25;
}

function isWhale(client) {
  if (!client) return false;
  return !!client.isWhale || (client.lifetimeVolume || 0) >= 10_000_000;
}

function relationshipOf(client) {
  if (!client) return 0.3;
  if (isWhale(client)) return 1;
  const s = String(client.status || '').toLowerCase();
  if (s === 'past_client') return 0.8;
  if (s === 'active') return 0.6;
  if (s === 'sphere' || /referr/i.test(client.leadSource || '')) return 0.5;
  return 0.3;
}

function recencyOf(client, now) {
  const at = client && (client.lastContactedAt || client.lastInboundAt || client.lastOutboundAt);
  if (!at) return 0.2;
  const days = (now - new Date(at).getTime()) / DAY;
  if (days <= 7) return 1;
  if (days <= 30) return 0.7;
  if (days <= 90) return 0.4;
  return 0.2;
}

function readiness(client, search, now = Date.now()) {
  const urgency = urgencyOf((search && search.timeline) || (client && client.timeline));
  const financing = financingOf(search && search.financing, client, now);
  const relationship = relationshipOf(client);
  const recency = recencyOf(client, now);
  const priority = Math.round(100 * (0.4 * urgency + 0.3 * financing + 0.2 * relationship + 0.1 * recency));
  return { priority, urgency, financing, relationship, recency };
}

module.exports = { readiness, isWhale, urgencyOf, financingOf, relationshipOf, recencyOf };
