// Campaign scoreboard — computed from the recipient rows (the source of
// truth), cached onto Campaign.stats for other surfaces (dashboard, Serena).
const prisma = require('../../lib/prisma');
const { NOT_SENT } = require('./constants');

const ROW_SELECT = { id: true, campaignId: true, status: true, lane: true, lastSentAt: true, repliedAt: true, nextSendAt: true, error: true, updatedAt: true };

// Which lane column a recipient sits in on the detail screen.
//   green | yellow | red  → their reply lane (opted out = red)
//   gray                  → texted, no reply to the campaign yet
//   waiting               → not texted yet (queued / deferred / failed before send)
function bucketOf(r) {
  if (r.status === 'opted_out') return 'red';
  if (['green', 'yellow', 'red'].includes(r.lane)) return r.lane;
  if (r.lastSentAt) return 'gray';
  return 'waiting';
}

function computeStats(rows, campaign = null) {
  const s = {
    total: 0, sent: 0, delivered: 0, replied: 0, replyRate: 0, optedOut: 0, failed: 0, takenOver: 0, muted: 0,
    lanes: { green: 0, yellow: 0, red: 0, gray: 0, waiting: 0 },
    pendingInitial: 0, deferred: 0, deferredReason: null, nextSendAt: null, eta: null, lastActivityAt: null,
  };
  const reasons = {};
  for (const r of rows) {
    if (r.status === 'canceled' && !r.lastSentAt) continue;
    s.total += 1;
    if (r.lastSentAt) s.sent += 1;
    if (r.repliedAt) s.replied += 1;
    if (r.status === 'opted_out') s.optedOut += 1;
    if (r.status === 'failed') s.failed += 1;
    if (r.status === 'taken_over') s.takenOver += 1;
    if (r.status === 'muted') s.muted += 1;
    s.lanes[bucketOf(r)] += 1;
    if (NOT_SENT.includes(r.status) && !r.lastSentAt) {
      s.pendingInitial += 1;
      if (r.nextSendAt) {
        const t = new Date(r.nextSendAt).getTime();
        if (!s.nextSendAt || t < new Date(s.nextSendAt).getTime()) s.nextSendAt = new Date(t).toISOString();
        if (!s.eta || t > new Date(s.eta).getTime()) s.eta = new Date(t).toISOString();
      }
    }
    if (r.status === 'rate_deferred') {
      s.deferred += 1;
      const k = r.error || 'Waiting for a safe slot';
      reasons[k] = (reasons[k] || 0) + 1;
    }
    const act = r.repliedAt && (!r.lastSentAt || r.repliedAt > r.lastSentAt) ? r.repliedAt : r.lastSentAt;
    if (act && (!s.lastActivityAt || new Date(act) > new Date(s.lastActivityAt))) s.lastActivityAt = new Date(act).toISOString();
  }
  s.replyRate = s.sent ? Math.round((s.replied / s.sent) * 1000) / 10 : 0;
  s.deferredReason = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k]) => k)[0] || null;
  if (campaign) {
    s.phase = campaign.status === 'running' ? (s.pendingInitial > 0 ? 'sending' : 'listening') : campaign.status;
  }
  return s;
}

// Delivered = recipients whose campaign text went out without failing.
// -> Map(campaignId → { linked, ok }) for campaigns whose texts are linked to
//    recipient rows (seeded campaigns may not be; they fall back to sent-failed).
async function deliveredCounts(campaignIds) {
  if (!campaignIds.length) return new Map();
  const rows = await prisma.message.groupBy({
    by: ['campaignId', 'campaignRecipientId', 'status'],
    where: { campaignId: { in: campaignIds }, isFromMe: true, campaignRecipientId: { not: null } },
  }).catch(() => []);
  const linked = new Map();
  const ok = new Map();
  for (const r of rows) {
    if (!linked.has(r.campaignId)) linked.set(r.campaignId, new Set());
    linked.get(r.campaignId).add(r.campaignRecipientId);
    if (['sent', 'delivered', 'read'].includes(r.status)) {
      if (!ok.has(r.campaignId)) ok.set(r.campaignId, new Set());
      ok.get(r.campaignId).add(r.campaignRecipientId);
    }
  }
  const m = new Map();
  for (const [id, set] of linked) m.set(id, { linked: set.size, ok: ok.has(id) ? ok.get(id).size : 0 });
  return m;
}

// statsFor([campaign]) -> Map(id → stats)
async function statsFor(campaigns) {
  const ids = campaigns.map((c) => c.id);
  if (!ids.length) return new Map();
  const [rows, delivered] = await Promise.all([
    prisma.campaignRecipient.findMany({ where: { campaignId: { in: ids } }, select: ROW_SELECT }),
    deliveredCounts(ids),
  ]);
  const by = new Map(ids.map((id) => [id, []]));
  for (const r of rows) by.get(r.campaignId).push(r);
  const out = new Map();
  for (const c of campaigns) {
    const list = by.get(c.id) || [];
    let s;
    if (!list.length && c.stats && typeof c.stats === 'object' && (c.stats.total || c.stats.sent)) {
      // Seeded/imported campaign without recipient rows: trust its cached stats.
      s = { ...computeStats([], c), ...c.stats, lanes: { ...computeStats([], c).lanes, ...(c.stats.lanes || {}) } };
    } else {
      s = computeStats(list, c);
      const d = delivered.get(c.id);
      s.delivered = d ? Math.min(s.sent, d.ok) : Math.max(0, s.sent - s.failed);
    }
    out.set(c.id, s);
  }
  return out;
}

// Persist a fresh scoreboard onto Campaign.stats (keeps non-score keys like run frame).
async function refreshCached(campaignId) {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!c) return null;
  const s = (await statsFor([c])).get(c.id);
  const prev = c.stats && typeof c.stats === 'object' ? c.stats : {};
  const { run } = prev;
  await prisma.campaign.update({ where: { id: c.id }, data: { stats: { ...s, ...(run ? { run } : {}), updatedAt: new Date().toISOString() } } }).catch(() => {});
  return s;
}

module.exports = { computeStats, statsFor, refreshCached, bucketOf, ROW_SELECT };
