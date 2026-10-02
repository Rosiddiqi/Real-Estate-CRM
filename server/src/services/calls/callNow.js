// "Call now" — who the agent should call and why. Prefers the Battle Plan's
// own call moves for today (the planner already weighed the whole book); when
// there are none, falls back to a deterministic heuristic over live signals:
// unanswered client questions, unreturned missed calls/voicemails, deals with
// deadlines, whales gone quiet, and birthdays/home anniversaries.
const prisma = require('../../lib/prisma');
const { dayKey } = require('../../lib/dates');
const U = require('../serena/util');

const LITE = { ...U.CLIENT_LITE, birthday: true };

function add(map, clientId, client, s) {
  if (!clientId || !client) return;
  const prev = map.get(clientId);
  if (!prev || s.score > prev.score) map.set(clientId, { clientId, name: U.nameOf(client), firstName: U.firstOf(client), phone: client.phone, avatarUrl: client.avatarUrl || null, whale: client.isWhale, rating: client.rating, ...s, also: prev ? [...(prev.also || []), prev.reason] : [] });
  else prev.also = [...(prev.also || []), s.reason];
}

async function fromBattlePlan({ workspaceId, userId, tz, limit }) {
  if (!userId) return [];
  const day = dayKey(new Date(), tz);
  const plan = await prisma.planDay.findFirst({ where: { workspaceId, userId, date: day }, include: { moves: { where: { channel: 'call', status: 'open', clientId: { not: null } }, orderBy: [{ score: 'desc' }] } } }).catch(() => null);
  if (!plan || !plan.moves.length) return [];
  const ids = [...new Set(plan.moves.map((m) => m.clientId))];
  const clients = await prisma.client.findMany({ where: { workspaceId, id: { in: ids } }, select: LITE });
  const byId = new Map(clients.map((c) => [c.id, c]));
  const out = new Map();
  for (const m of plan.moves) {
    const c = byId.get(m.clientId);
    if (!c || !c.phone) continue;
    // Planner titles read "Call Omar — lease ends Nov 16"; the name is shown separately.
    let reason = String(m.title || '').replace(/^(call|text|email|ring|phone)\s+(the\s+)?[A-Z][\w'’.-]*(\s+[A-Z][\w'’.-]*)?\s*[—–:-]\s*/i, '');
    reason = reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : 'On today’s plan';
    add(out, c.id, c, { score: Math.round(m.score || m.impact || 50), reason: U.clip(reason, 64), why: U.clip(m.why || m.sub || '', 140), source: 'battle_plan', moveId: m.id, kind: m.kind });
  }
  return [...out.values()].slice(0, limit);
}

async function heuristic({ workspaceId, tz, limit }) {
  const now = Date.now();
  const since48 = new Date(now - 48 * 3600e3);
  const map = new Map();

  // 1) Unanswered inbound texts (esp. questions)
  const convos = await prisma.conversation.findMany({
    where: { workspaceId, archived: false, blocked: false, lastMessageFromMe: false, lastMessageAt: { gte: new Date(now - 72 * 3600e3) }, clientId: { not: null }, isGroup: false },
    include: { client: { select: LITE } },
    orderBy: { lastMessageAt: 'desc' },
    take: 30,
  });
  for (const cv of convos) {
    if (!cv.client || !cv.client.phone) continue;
    const q = /\?/.test(cv.lastMessagePreview || '');
    const hrs = Math.max(0, (now - new Date(cv.lastMessageAt).getTime()) / 3600e3);
    add(map, cv.clientId, cv.client, {
      score: Math.round((q ? 92 : 74) - Math.min(20, hrs / 3) + (cv.client.isWhale ? 6 : 0)),
      reason: q ? `Asked you a question ${U.relAgo(cv.lastMessageAt)}` : `Texted you ${U.relAgo(cv.lastMessageAt)} — no reply yet`,
      why: `“${U.clip(cv.lastMessagePreview, 110)}”`,
      source: 'heuristic', kind: 'unanswered',
    });
  }

  // 2) Missed calls / voicemails not returned
  const missed = await prisma.phoneCall.findMany({
    where: { workspaceId, direction: 'inbound', status: { in: ['missed', 'no_answer', 'voicemail'] }, startedAt: { gte: since48 }, clientId: { not: null } },
    include: { client: { select: LITE } },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  for (const k of missed) {
    if (!k.client || !k.client.phone) continue;
    const returned = await prisma.phoneCall.findFirst({ where: { workspaceId, clientId: k.clientId, direction: 'outbound', startedAt: { gt: k.startedAt } }, select: { id: true } });
    if (returned) continue;
    add(map, k.clientId, k.client, {
      score: (k.status === 'voicemail' ? 90 : 86) + (k.client.isWhale ? 5 : 0),
      reason: k.status === 'voicemail' ? `Left a voicemail ${U.relAgo(k.startedAt)}` : `Missed call ${U.relAgo(k.startedAt)}`,
      why: k.voicemailTranscript ? `“${U.clip(k.voicemailTranscript, 110)}”` : 'You haven’t called back yet.',
      source: 'heuristic', kind: 'missed_call', callId: k.id,
    });
  }

  // 3) Deals with live pressure
  const deals = await prisma.deal.findMany({
    where: { workspaceId, archivedAt: null, stage: { in: ['offer_submitted', 'offer_received', 'under_contract'] } },
    include: { client: { select: LITE } },
    take: 40,
  });
  for (const d of deals) {
    if (!d.client || !d.client.phone) continue;
    const prop = d.propertyLabel || d.propertyAddress || d.title || 'the deal';
    const deadlines = [['inspection', d.inspectionDeadline], ['appraisal', d.appraisalDeadline], ['financing', d.financingDeadline], ['closing', d.closingDate]]
      .filter(([, at]) => at && new Date(at).getTime() > now - 864e5 && new Date(at).getTime() - now < 7 * 864e5)
      .sort((a, b) => new Date(a[1]) - new Date(b[1]));
    if (deadlines.length) {
      const [what, at] = deadlines[0];
      const days = Math.max(0, Math.round((new Date(at).getTime() - now) / 864e5));
      add(map, d.clientId, d.client, {
        score: 84 - days * 2 + (d.client.isWhale ? 4 : 0),
        reason: `${U.titleCase(what)} ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} — ${U.clip(prop, 36)}`,
        why: `Under contract${d.price ? ` at ${U.moneyCompact(d.contractPrice || d.price)}` : ''}. Keep them ahead of the ${what} deadline.`,
        source: 'heuristic', kind: 'deadline', dealId: d.id,
      });
    } else if (d.stage !== 'under_contract') {
      const days = U.daysBetween(d.stageChangedAt);
      add(map, d.clientId, d.client, {
        score: 78 - Math.min(10, days),
        reason: d.stage === 'offer_received' ? `Offer in on ${U.clip(prop, 36)}` : `Offer out on ${U.clip(prop, 36)}`,
        why: `${days === 0 ? 'Since today' : `${days} day${days === 1 ? '' : 's'} in play`} — update them even if there’s no news.`,
        source: 'heuristic', kind: 'offer', dealId: d.id,
      });
    }
  }

  // 4) Whales and 5-stars gone quiet
  const quiet = await prisma.client.findMany({
    where: { workspaceId, archivedAt: null, contactKind: 'client', phone: { not: null }, OR: [{ isWhale: true }, { rating: { gte: 5 } }], lastContactedAt: { lt: new Date(now - 30 * 864e5) } },
    select: LITE,
    orderBy: { lastContactedAt: 'asc' },
    take: 6,
  });
  for (const c of quiet) {
    const days = U.daysBetween(c.lastContactedAt);
    add(map, c.id, c, { score: 58 + (c.isWhale ? 6 : 0), reason: `${c.isWhale ? 'Whale' : '5-star'} — silent ${days} days`, why: 'A personal check-in keeps the relationship (and the referrals) warm.', source: 'heuristic', kind: 'quiet' });
  }

  // 5) Birthdays today/tomorrow
  const today = dayKey(new Date(), tz);
  const mmdd = today.slice(5);
  const bdays = await prisma.client.findMany({ where: { workspaceId, archivedAt: null, phone: { not: null }, birthday: { endsWith: mmdd } }, select: LITE, take: 5 });
  for (const c of bdays) add(map, c.id, c, { score: 72, reason: 'Birthday today', why: 'A call beats a text on a birthday.', source: 'heuristic', kind: 'birthday' });

  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

async function callSuggestions({ workspaceId, userId, limit = 5 }) {
  const tz = await U.tzFor(workspaceId, userId);
  // Battle-plan call moves lead (the planner weighed the whole book); live
  // signals it doesn't cover yet (a voicemail that just landed, an unanswered
  // question) are interleaved by urgency so nothing hot is buried.
  const plan = await fromBattlePlan({ workspaceId, userId, tz, limit });
  const h = await heuristic({ workspaceId, tz, limit: limit + plan.length });
  const seen = new Set(plan.map((p) => p.clientId));
  const extra = h.filter((x) => !seen.has(x.clientId));
  const merged = [];
  const hot = extra.filter((x) => x.score >= 85);
  const rest = extra.filter((x) => x.score < 85);
  while (merged.length < limit && (plan.length || hot.length || rest.length)) {
    if (hot.length) merged.push(hot.shift());
    if (merged.length < limit && plan.length) merged.push(plan.shift());
    if (!hot.length && !plan.length && rest.length && merged.length < limit) merged.push(rest.shift());
  }
  const usedPlan = merged.some((m) => m.source === 'battle_plan');
  const usedH = merged.some((m) => m.source !== 'battle_plan');
  return { source: usedPlan && usedH ? 'battle_plan+signals' : usedPlan ? 'battle_plan' : 'signals', suggestions: merged };
}

module.exports = { callSuggestions };
