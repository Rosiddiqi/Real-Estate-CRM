// Default automations — always-on, trigger-fired texts. Each is a Campaign row
// (kind 'automation', trigger = key) whose status is 'running' when ON and
// 'paused' when OFF. Turning one on IS the approval for its trigger-fired
// sends (the campaign-level carve-out); draft-mode automations instead draft
// each text for a one-tap approval. Every send still passes the Sender Guard.
//
// The trigger sweep (jobs/campaignAutomations.js, hourly) enrolls clients:
//   home_anniversary   owned home's purchase date (month/day), every year
//   birthday           Client.birthday (YYYY-MM-DD or MM-DD)
//   new_listing_match  Match score ≥ minScore (default 90) in the last 48h
//   price_drop         a listing a buyer watches/matched dropped in the last 48h
//   open_house_invite  the day after an open house, for linked attendees
//   post_closing       a closed deal → 1 week / 1 month / 6 months / 1 year
//   lease_expiry       a rented home's lease ends within leadDays (90)
//   showing_followup   the morning after a private showing
// Enrollment is idempotent per trigger key (meta.triggerKeys).
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { HttpError } = require('../../lib/http');
const { partsIn, zonedTime, dayKey } = require('../../lib/dates');
const { clientName } = require('../../lib/clients');
const Q = require('./queue');
const store = require('./settingsStore');
const { AUTOMATION_DEFS, AUTOMATION_ORDER } = require('./constants');

const DAY = 86400000;
const AUTOMATION_LANES = {
  green: { enabled: false, text: '', steps: [] },
  yellow: { enabled: false, text: '', steps: [] },
  red: { enabled: false, text: '', steps: [] },
  gray: { enabled: false, timerText: '2 DAYS', timerHours: 48, text: '' },
  aiReply: { mode: 'off', instructions: '' },
};

function emit(workspaceId, payload) {
  try { hub.broadcast(workspaceId, 'campaign_updated', { ...payload, kind: payload.kind || 'automation', at: new Date().toISOString() }); } catch { /* noop */ }
}

const ensuring = new Map();
async function ensureDefaults(workspaceId) {
  if (ensuring.has(workspaceId)) return ensuring.get(workspaceId);
  const p = (async () => {
    const existing = await prisma.campaign.findMany({ where: { workspaceId, kind: 'automation' }, select: { trigger: true } });
    const have = new Set(existing.map((e) => e.trigger));
    for (const key of AUTOMATION_ORDER) {
      if (have.has(key)) continue;
      const def = AUTOMATION_DEFS[key];
      await prisma.campaign.create({
        data: {
          workspaceId, kind: 'automation', trigger: key, name: def.name, status: 'paused',
          brief: def.brief,
          steps: def.steps ? def.steps.map((s) => ({ ...s })) : [{ dayOffset: 0, instructions: def.brief, includePhoto: ['new_listing_match', 'price_drop'].includes(key) }],
          lanes: AUTOMATION_LANES,
          audience: { approval: def.approval, ...(def.minScore ? { minScore: def.minScore } : {}), ...(def.leadDays ? { leadDays: def.leadDays } : {}) },
          pacing: 'safe',
        },
      });
    }
  })().finally(() => setTimeout(() => ensuring.delete(workspaceId), 2000));
  ensuring.set(workspaceId, p);
  return p;
}

// ── Audience counts (who currently qualifies) ───────────────────────────
const textable = { textOptOut: false, blocked: false, archivedAt: null, phone: { not: null } };
async function audienceCount(workspaceId, trigger, now = new Date()) {
  try {
    switch (trigger) {
      case 'home_anniversary': return prisma.client.count({ where: { workspaceId, ...textable, properties: { some: { relationship: 'owns', purchasedAt: { not: null } } } } });
      case 'birthday': return prisma.client.count({ where: { workspaceId, ...textable, contactKind: 'client', birthday: { not: null } } });
      case 'new_listing_match': return prisma.client.count({ where: { workspaceId, ...textable, searches: { some: { status: 'active' } } } });
      case 'price_drop': return prisma.client.count({ where: { workspaceId, ...textable, OR: [{ properties: { some: { relationship: 'watching' } } }, { matches: { some: { status: { in: ['seen', 'sent', 'interested', 'toured'] } } } }] } });
      case 'open_house_invite': return prisma.client.count({ where: { workspaceId, ...textable, appointments: { some: { type: { in: ['open_house', 'broker_open'] }, startAt: { gte: new Date(now.getTime() - 30 * DAY) } } } } });
      case 'post_closing': return prisma.client.count({ where: { workspaceId, ...textable, deals: { some: { stage: 'closed', closedAt: { gte: new Date(now.getTime() - 366 * DAY) } } } } });
      case 'lease_expiry': return prisma.client.count({ where: { workspaceId, ...textable, properties: { some: { relationship: 'rents', leaseEndsAt: { gte: now } } } } });
      case 'showing_followup': return prisma.client.count({ where: { workspaceId, ...textable, appointments: { some: { type: { in: ['showing', 'private_tour'] }, startAt: { gte: new Date(now.getTime() - 30 * DAY) } } } } });
      default: return 0;
    }
  } catch (err) {
    console.error('[campaigns/automations] count failed', trigger, err.message);
    return 0;
  }
}

async function listAutomations(workspaceId) {
  await ensureDefaults(workspaceId);
  const rows = await prisma.campaign.findMany({ where: { workspaceId, kind: 'automation' }, orderBy: { createdAt: 'asc' } });
  const seen = new Set();
  const autos = rows.filter((r) => (seen.has(r.trigger) ? false : seen.add(r.trigger)));
  autos.sort((a, b) => AUTOMATION_ORDER.indexOf(a.trigger) - AUTOMATION_ORDER.indexOf(b.trigger));
  const ids = autos.map((a) => a.id);
  const [recent, counts, sendCounts, pending] = await Promise.all([
    prisma.message.findMany({ where: { workspaceId, campaignId: { in: ids }, isFromMe: true }, orderBy: { sentAt: 'desc' }, take: 60, select: { id: true, campaignId: true, body: true, sentAt: true, status: true, clientId: true, conversationId: true } }),
    Promise.all(autos.map((a) => audienceCount(workspaceId, a.trigger))),
    prisma.message.groupBy({ by: ['campaignId'], where: { workspaceId, campaignId: { in: ids }, isFromMe: true }, _count: { _all: true } }).catch(() => []),
    prisma.campaignRecipient.groupBy({ by: ['campaignId'], where: { workspaceId, campaignId: { in: ids }, nextSendAt: { not: null } }, _count: { _all: true } }).catch(() => []),
  ]);
  const clientIds = [...new Set(recent.map((m) => m.clientId).filter(Boolean))];
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true, displayName: true, avatarUrl: true } }) : [];
  const cById = new Map(clients.map((c) => [c.id, c]));
  const sendsBy = new Map(sendCounts.map((s) => [s.campaignId, s._count._all]));
  const pendingBy = new Map(pending.map((s) => [s.campaignId, s._count._all]));
  return autos.map((a, i) => {
    const def = AUTOMATION_DEFS[a.trigger] || {};
    const mine = recent.filter((m) => m.campaignId === a.id);
    const stats = a.stats && typeof a.stats === 'object' ? a.stats : {};
    return {
      id: a.id, trigger: a.trigger, name: a.name, enabled: a.status === 'running', status: a.status,
      icon: def.icon || 'zap', accent: def.accent || '#E6E6E6', when: def.when || '',
      brief: a.brief || '', steps: Array.isArray(a.steps) ? a.steps : [],
      approval: (a.audience && a.audience.approval) || def.approval || 'auto',
      minScore: (a.audience && a.audience.minScore) || def.minScore || null,
      leadDays: (a.audience && a.audience.leadDays) || def.leadDays || null,
      lanes: a.lanes || AUTOMATION_LANES,
      audienceCount: counts[i],
      sentCount: sendsBy.get(a.id) || 0,
      queued: pendingBy.get(a.id) || 0,
      lastRunAt: stats.lastRunAt || (mine[0] && mine[0].sentAt) || null,
      lastSentAt: (mine[0] && mine[0].sentAt) || null,
      recentSends: mine.slice(0, 3).map((m) => {
        const c = cById.get(m.clientId);
        return { id: m.id, clientId: m.clientId, conversationId: m.conversationId, name: c ? clientName(c) : 'Client', avatarUrl: c && c.avatarUrl, body: m.body, sentAt: m.sentAt, status: m.status };
      }),
    };
  });
}

async function updateAutomation({ workspaceId, id, patch }) {
  const a = await prisma.campaign.findFirst({ where: { id, workspaceId, kind: 'automation' } });
  if (!a) throw new HttpError(404, 'Automation not found');
  const data = {};
  if (typeof patch.name === 'string' && patch.name.trim()) data.name = patch.name.trim().slice(0, 80);
  if (typeof patch.brief === 'string') data.brief = patch.brief.slice(0, 2000);
  if (Array.isArray(patch.steps)) {
    data.steps = patch.steps.slice(0, 8).map((s, i) => ({
      dayOffset: Number.isFinite(Number(s.dayOffset)) ? Number(s.dayOffset) : (a.steps && a.steps[i] ? a.steps[i].dayOffset : 0),
      label: s.label || (a.steps && a.steps[i] && a.steps[i].label) || null,
      instructions: String(s.instructions || '').slice(0, 1000),
      includePhoto: !!s.includePhoto,
    }));
  }
  if (patch.lanes && typeof patch.lanes === 'object') data.lanes = { ...(a.lanes || AUTOMATION_LANES), ...patch.lanes };
  const aud = { ...(a.audience && typeof a.audience === 'object' ? a.audience : {}) };
  if (['auto', 'draft'].includes(patch.approval)) aud.approval = patch.approval;
  if (patch.minScore != null) aud.minScore = Math.max(70, Math.min(100, Number(patch.minScore) || 90));
  if (patch.leadDays != null) aud.leadDays = Math.max(14, Math.min(180, Number(patch.leadDays) || 90));
  data.audience = aud;
  if (typeof patch.enabled === 'boolean') {
    const brief = data.brief != null ? data.brief : a.brief;
    if (patch.enabled && !String(brief || '').trim()) throw new HttpError(400, 'Explain the text before turning this on');
    data.status = patch.enabled ? 'running' : 'paused';
    if (!patch.enabled) {
      // Off means off: pending trigger texts are dropped, not held.
      const rows = await prisma.campaignRecipient.findMany({ where: { campaignId: a.id, nextSendAt: { not: null } }, select: { id: true, meta: true, lastSentAt: true, status: true } });
      for (const r of rows) {
        const q = Q.queueOf(r, { automation: true }).filter((i) => !['auto_step', 'approved_send'].includes(i.kind));
        await prisma.campaignRecipient.update({ where: { id: r.id }, data: { ...Q.withQueue(Q.metaOf(r), q), ...(!r.lastSentAt && ['pending', 'rate_deferred', 'scheduled'].includes(r.status) ? { status: 'canceled', error: 'Automation turned off' } : {}) } }).catch(() => {});
      }
    }
  }
  const updated = await prisma.campaign.update({ where: { id: a.id }, data });
  emit(workspaceId, { campaignId: a.id, kind: 'automation', enabled: updated.status === 'running' });
  if (patch.enabled === true) setTimeout(() => { runTriggers(workspaceId, { only: a.id }).catch((e) => console.error('[campaigns/automations] sweep after enable failed:', e.message)); }, 100);
  return updated;
}

// ── Enrollment ─────────────────────────────────────────────────────────
async function enroll({ workspaceId, automation, clientId, triggerKey, items }) {
  if (!items.length) return false;
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, phone: true, textOptOut: true, blocked: true, archivedAt: true } });
  if (!client || !client.phone || client.textOptOut || client.blocked || client.archivedAt) return false;
  const existing = await prisma.campaignRecipient.findUnique({ where: { campaignId_clientId: { campaignId: automation.id, clientId } } });
  const queueItems = items.map((it) => Q.item('auto_step', it.at, { step: it.step || 0, payload: { ...(it.payload || {}), triggerKey } }));
  if (!existing) {
    await prisma.campaignRecipient.create({
      data: { workspaceId, campaignId: automation.id, clientId, status: 'pending', lane: 'none', ...Q.withQueue({ triggerKey, triggerKeys: [triggerKey] }, queueItems) },
    }).catch((e) => { if (e.code !== 'P2002') throw e; });
    return true;
  }
  const meta = Q.metaOf(existing);
  if ((meta.triggerKeys || []).includes(triggerKey)) return false;
  if (['opted_out', 'muted'].includes(existing.status)) return false;
  const have = Q.queueOf(existing, { automation: true });
  const keys = [...(meta.triggerKeys || []), triggerKey].slice(-60);
  // Already queued for the same moment another way (seeded rows, an earlier
  // run before trigger keys): record the key, never double up.
  const near = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 36 * 3600000;
  if (queueItems.every((n) => have.some((e) => e.kind === 'auto_step' && near(e.at, n.at)))) {
    await prisma.campaignRecipient.update({ where: { id: existing.id }, data: Q.withQueue({ ...meta, triggerKeys: keys }, have) });
    return false;
  }
  const q = [...have, ...queueItems];
  const data = { ...Q.withQueue({ ...meta, triggerKey, triggerKeys: keys }, q) };
  if (existing.status !== 'drafting' && !have.length) {
    Object.assign(data, { status: 'pending', lane: 'none', stepIndex: 0, error: null });
  }
  await prisma.campaignRecipient.update({ where: { id: existing.id }, data });
  return true;
}

// Local wall-clock helpers in the workspace tz.
function localParts(d, tz) { const p = partsIn(d, tz); return { ...p, key: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` }; }
function jitterMin(seed, span) {
  let h = 0; const s = String(seed); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % span;
}
// Today at hh:mm local (+ deterministic jitter), or a few minutes from now if
// that moment already passed today (still inside the day).
function todayAt(now, tz, hour, seed, latestHour = 18) {
  const k = localParts(now, tz).key;
  const at = new Date(zonedTime(k, hour, 0, tz).getTime() + jitterMin(seed, 50) * 60000);
  if (at > now) return at;
  const lp = localParts(now, tz);
  if (lp.hour < latestHour) return new Date(now.getTime() + (2 + jitterMin(seed, 6)) * 60000);
  return null;
}
function dateAt(d, tz, hour, seed) {
  const k = localParts(d, tz).key;
  return new Date(zonedTime(k, hour, 0, tz).getTime() + jitterMin(seed, 50) * 60000);
}

async function matchesRecent(workspaceId, sinceDays, minScore) {
  try {
    const mm = require('../matchmaker/score');
    if (mm && typeof mm.getRecentMatches === 'function') {
      const out = await mm.getRecentMatches({ workspaceId, sinceDays, minScore });
      if (Array.isArray(out)) return out.map((m) => ({ clientId: m.clientId, listingId: m.listingId || (m.listing && m.listing.id), score: m.score })).filter((m) => m.clientId && m.listingId);
    }
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') console.error('[campaigns/automations] getRecentMatches failed, querying directly:', err.message);
  }
  const rows = await prisma.match.findMany({
    where: { workspaceId, score: { gte: minScore }, listingId: { not: null }, createdAt: { gte: new Date(Date.now() - sinceDays * DAY) }, status: { notIn: ['dismissed', 'sent'] } },
    select: { clientId: true, listingId: true, score: true },
  });
  return rows;
}

async function sweepOne({ workspaceId, automation, tz, now, settings }) {
  const trigger = automation.trigger;
  const today = localParts(now, tz);
  const year = today.year;
  let enrolled = 0;
  const add = async (clientId, triggerKey, items) => { if (await enroll({ workspaceId, automation, clientId, triggerKey, items })) enrolled += 1; };

  if (trigger === 'home_anniversary') {
    const props = await prisma.portfolioProperty.findMany({ where: { workspaceId, relationship: 'owns', purchasedAt: { not: null } }, select: { id: true, clientId: true, purchasedAt: true, street: true, neighborhood: true, city: true } });
    for (const p of props) {
      const bought = localParts(new Date(p.purchasedAt), 'UTC');
      if (bought.month !== today.month || bought.day !== today.day || bought.year >= year) continue;
      const at = todayAt(now, tz, 10, p.id);
      if (!at) continue;
      const years = year - bought.year;
      await add(p.clientId, `anniv:${p.id}:${year}`, [{ at, payload: { facts: { years: `${years} year${years === 1 ? '' : 's'} in the home`, yearsSentence: `${years} year${years === 1 ? '' : 's'} already. `, home: p.street || p.neighborhood || p.city } } }]);
    }
  } else if (trigger === 'birthday') {
    const clients = await prisma.client.findMany({ where: { workspaceId, contactKind: 'client', birthday: { not: null } }, select: { id: true, birthday: true } });
    const mmdd = `${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    for (const c of clients) {
      const b = String(c.birthday || '').trim();
      const md = /^\d{4}-\d{2}-\d{2}$/.test(b) ? b.slice(5) : /^\d{2}-\d{2}$/.test(b) ? b : null;
      if (md !== mmdd) continue;
      const at = todayAt(now, tz, 9, c.id, 19);
      if (at) await add(c.id, `bday:${year}`, [{ at }]);
    }
  } else if (trigger === 'new_listing_match') {
    const minScore = (automation.audience && automation.audience.minScore) || 90;
    const ms = await matchesRecent(workspaceId, 2, minScore);
    for (const m of ms) {
      const at = new Date(now.getTime() + (3 + jitterMin(`${m.clientId}${m.listingId}`, 20)) * 60000);
      await add(m.clientId, `match:${m.listingId}`, [{ at, payload: { listingId: m.listingId, facts: { matchScore: m.score } } }]);
    }
  } else if (trigger === 'price_drop') {
    const drops = await prisma.listing.findMany({ where: { workspaceId, priceDroppedAt: { gte: new Date(now.getTime() - 2 * DAY) }, status: { in: ['active', 'coming_soon'] } }, select: { id: true, listPrice: true, previousPrice: true } });
    for (const l of drops) {
      const [watchers, matched] = await Promise.all([
        prisma.portfolioProperty.findMany({ where: { workspaceId, relationship: 'watching', listingId: l.id }, select: { clientId: true } }),
        prisma.match.findMany({ where: { workspaceId, listingId: l.id, OR: [{ status: { in: ['seen', 'sent', 'interested', 'toured'] } }, { score: { gte: 85 } }] }, select: { clientId: true } }),
      ]);
      const ids = [...new Set([...watchers, ...matched].map((x) => x.clientId))];
      for (const cid of ids) {
        const at = new Date(now.getTime() + (3 + jitterMin(`${cid}${l.id}`, 20)) * 60000);
        await add(cid, `drop:${l.id}:${l.listPrice || 0}`, [{ at, payload: { listingId: l.id } }]);
      }
    }
  } else if (trigger === 'open_house_invite' || trigger === 'showing_followup') {
    const types = trigger === 'open_house_invite' ? ['open_house', 'broker_open'] : ['showing', 'private_tour'];
    const appts = await prisma.appointment.findMany({
      where: { workspaceId, type: { in: types }, endAt: { gte: new Date(now.getTime() - 36 * 3600000), lte: new Date(now.getTime() - 2 * 3600000) }, status: { notIn: ['cancelled', 'no_show'] } },
      select: { id: true, clientId: true, listingId: true, endAt: true, attendees: true },
    });
    for (const a of appts) {
      const ids = new Set([a.clientId].filter(Boolean));
      if (Array.isArray(a.attendees)) a.attendees.forEach((x) => { if (x && x.clientId) ids.add(x.clientId); });
      const ended = localParts(new Date(a.endAt), tz);
      // The morning after.
      let at = ended.key === today.key ? dateAt(new Date(now.getTime() + DAY), tz, 10, a.id) : todayAt(now, tz, 10, a.id);
      if (!at) continue;
      for (const cid of ids) await add(cid, `${trigger === 'open_house_invite' ? 'oh' : 'showing'}:${a.id}`, [{ at, payload: { listingId: a.listingId || null } }]);
    }
  } else if (trigger === 'post_closing') {
    const deals = await prisma.deal.findMany({ where: { workspaceId, stage: 'closed', closedAt: { gte: new Date(now.getTime() - 366 * DAY) } }, select: { id: true, clientId: true, closedAt: true, listingId: true } });
    const steps = Array.isArray(automation.steps) && automation.steps.length ? automation.steps : AUTOMATION_DEFS.post_closing.steps;
    for (const d of deals) {
      const items = steps.map((s, i) => ({ at: dateAt(new Date(new Date(d.closedAt).getTime() + (Number(s.dayOffset) || 0) * DAY), tz, 10, `${d.id}${i}`), step: i, payload: { dealId: d.id, listingId: d.listingId || null } }))
        .filter((it) => it.at > now);
      if (items.length) await add(d.clientId, `close:${d.id}`, items);
    }
  } else if (trigger === 'lease_expiry') {
    const lead = (automation.audience && automation.audience.leadDays) || 90;
    const props = await prisma.portfolioProperty.findMany({ where: { workspaceId, relationship: 'rents', leaseEndsAt: { gte: now, lte: new Date(now.getTime() + lead * DAY) } }, select: { id: true, clientId: true, leaseEndsAt: true } });
    for (const p of props) {
      const at = todayAt(now, tz, 11, p.id);
      if (!at) continue;
      const end = new Date(p.leaseEndsAt);
      const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric' }).format(end);
      await add(p.clientId, `lease:${p.id}:${end.toISOString().slice(0, 10)}`, [{ at, payload: { facts: { leaseDate: ` on ${label}`, leaseEnds: label } } }]);
    }
  }
  if (enrolled) {
    const stats = { ...(automation.stats && typeof automation.stats === 'object' ? automation.stats : {}), lastRunAt: now.toISOString(), lastEnrolled: enrolled };
    await prisma.campaign.update({ where: { id: automation.id }, data: { stats } }).catch(() => {});
    emit(workspaceId, { campaignId: automation.id, kind: 'automation', enrolled });
  }
  return enrolled;
}

// Run every enabled automation's trigger for one workspace (idempotent).
async function runTriggers(workspaceId, { only, now = new Date() } = {}) {
  const { settings, timezone } = await store.readSettings(workspaceId);
  const autos = await prisma.campaign.findMany({ where: { workspaceId, kind: 'automation', status: 'running', ...(only ? { id: only } : {}) } });
  let total = 0;
  for (const a of autos) {
    try { total += await sweepOne({ workspaceId, automation: a, tz: timezone, now, settings }); } catch (err) { console.error('[campaigns/automations] sweep failed', a.trigger, err.message); }
  }
  await store.setKey(workspaceId, 'automationsRun', { at: now.toISOString(), dayKey: dayKey(now, timezone), enrolled: total }).catch(() => {});
  return total;
}

async function runAllWorkspaces() {
  const rows = await prisma.campaign.findMany({ where: { kind: 'automation', status: 'running' }, select: { workspaceId: true }, distinct: ['workspaceId'] });
  let total = 0;
  for (const r of rows) total += await runTriggers(r.workspaceId).catch((e) => { console.error('[campaigns/automations] workspace sweep failed', e.message); return 0; });
  return total;
}

module.exports = { ensureDefaults, listAutomations, updateAutomation, runTriggers, runAllWorkspaces, enroll, audienceCount, AUTOMATION_LANES };
