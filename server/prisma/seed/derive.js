// Derived rows: the unified Activity timeline and per-client contact +
// lifetime stats, computed from everything already built so they agree.
const { uid } = require('./util');
const { clean, fmtMoney, STAGE_LABEL } = require('./build_a');
const { dayKey } = require('../../src/lib/dates');

const SHOWING_TYPES = new Set(['showing', 'private_tour', 'open_house', 'broker_open']);
const REL_LABEL = { owns: 'home', rents: 'rental', sold: 'sold property', watching: 'watching', leased_out: 'rental property' };

function buildActivities(S, b) {
  const { ctx, WS } = S;
  const acts = [];
  const add = (a) => acts.push(clean({ workspaceId: WS, ...a, createdAt: a.occurredAt }));
  const first = (k) => (S.clientDefs[k] ? (S.clientDefs[k].displayName || S.clientDefs[k].firstName) : '');
  const short = (s, n = 180) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const campaignName = Object.fromEntries(b.campaigns.map((c) => [c.id, c.name]));

  // Messages: one row per conversation × local day × direction (× sender in groups).
  for (const [convKey, t] of Object.entries(S.threadMsgs)) {
    const groups = new Map();
    for (const m of t.rows) {
      if (m._campaign) {
        add({ clientId: S.clientId[t.client], type: 'campaign', title: `Campaign · ${campaignName[m.campaignId] || 'message'}`, body: short(m.body), actor: 'system', occurredAt: m.sentAt, meta: { campaignId: m.campaignId, messageId: m.id, conversationId: m.conversationId } });
        continue;
      }
      const day = dayKey(m.sentAt, ctx.TZ);
      const who = m.isFromMe ? 'out' : (m._senderKey || 'x');
      const k = `${day}|${who}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const [k, list] of groups) {
      const [, who] = k.split('|');
      const lastMsg = list[list.length - 1];
      const body = short(lastMsg.kind === 'listing' ? `🏠 ${lastMsg.meta.title} — ${lastMsg.body}` : (lastMsg.body || '📷 Photo'));
      const meta = { conversationId: lastMsg.conversationId, messageIds: list.map((m) => m.id), count: list.length, channel: lastMsg.service };
      if (who === 'out') {
        const targets = t.isGroup ? t.participants : (t.client ? [t.client] : []);
        for (const ck of targets) add({ clientId: S.clientId[ck], type: 'message_out', title: `Texted ${t.isGroup ? 'the Delacroix group' : first(ck)}${list.length > 1 ? ` · ${list.length} messages` : ''}`, body, actor: 'agent', occurredAt: lastMsg.sentAt, meta });
      } else if (who !== 'x') {
        add({ clientId: S.clientId[who], type: 'message_in', title: `${first(who)} texted${list.length > 1 ? ` · ${list.length} messages` : ''}`, body, actor: 'client', occurredAt: lastMsg.sentAt, meta });
      }
    }
  }

  // Calls
  const callClient = Object.fromEntries(Object.entries(S.clientId).map(([k, v]) => [v, k]));
  for (const c of b.calls) {
    const k = callClient[c.clientId];
    const mins = Math.max(1, Math.round(c.durationSec / 60));
    let type; let title;
    if (c.status === 'completed') { type = c.direction === 'inbound' ? 'call_in' : 'call_out'; title = `Call ${c.direction === 'inbound' ? 'from' : 'with'} ${first(k)} · ${mins} min`; }
    else if (c.status === 'voicemail') { type = 'voicemail'; title = `Voicemail from ${first(k)}`; }
    else if (c.status === 'missed') { type = 'call_missed'; title = `Missed call from ${first(k)}`; }
    else { type = 'call_out'; title = `Called ${first(k)} — no answer`; }
    add({ clientId: c.clientId, type, title, body: short(c.summary || c.voicemailTranscript), actor: c.direction === 'inbound' ? 'client' : 'agent', occurredAt: c.startedAt, meta: { callId: c.id, durationSec: c.durationSec, direction: c.direction, status: c.status } });
  }

  // Notes
  for (const n of b.notes) {
    add({ clientId: n.clientId, dealId: n.dealId, listingId: n.listingId, type: 'note', title: n.source === 'call' ? 'Call note' : n.source === 'serena' ? 'Serena note' : 'Note', body: n.body, actor: n.source === 'serena' ? 'ai' : 'agent', occurredAt: n.createdAt, meta: { noteId: n.id, pinned: !!n.pinned } });
  }

  // Appointments
  for (const a of b.appts) {
    if (!a.clientId) continue;
    const meta = { appointmentId: a.id, type: a.type, status: a.status, startAt: a.startAt };
    if (['completed', 'no_show', 'cancelled'].includes(a.status) && a.endAt < ctx.now) {
      const suffix = a.status === 'completed' ? '' : ` · ${a.status === 'no_show' ? 'no-show' : 'cancelled'}`;
      add({ clientId: a.clientId, dealId: a.dealId, listingId: a.listingId, type: SHOWING_TYPES.has(a.type) ? 'showing' : 'appointment', title: `${a.title}${suffix}`, body: a.outcome, actor: 'agent', occurredAt: a.status === 'completed' ? a.endAt : a.startAt, meta });
    } else {
      add({ clientId: a.clientId, dealId: a.dealId, listingId: a.listingId, type: 'appointment', title: `Booked · ${a.title}`, body: a.location, actor: 'agent', occurredAt: a.createdAt, meta });
    }
  }

  // Deals
  for (const d of Object.values(S.dealRow)) {
    d.def.path.forEach(([st, at], i) => {
      const base = { clientId: d.clientId, dealId: d.id, listingId: d.listingId, actor: 'agent', occurredAt: at };
      if (i === 0) add({ ...base, type: 'deal_created', title: `Deal created · ${d.title}`, body: d.propertyLabel || d.propertyAddress, meta: { side: d.side, stage: st } });
      else if (st === 'closed') add({ ...base, type: 'deal_closed', title: `Closed · ${fmtMoney(d.salePrice)}`, body: `${d.title} — ${d.side === 'dual' ? 'both sides' : `${d.side} side`}, GCI ${fmtMoney(d.grossCommission)}`, meta: { salePrice: d.salePrice, grossCommission: d.grossCommission } });
      else if (st === 'lost') add({ ...base, type: 'deal_stage_change', title: `Marked lost · ${d.lostReason}`, body: d.lostNote, meta: { fromStage: d.def.path[i - 1][0], toStage: 'lost' } });
      else add({ ...base, type: 'deal_stage_change', title: `${STAGE_LABEL[d.def.path[i - 1][0]]} → ${STAGE_LABEL[st]}`, body: d.title, meta: { fromStage: d.def.path[i - 1][0], toStage: st } });
    });
  }

  // Portfolio + searches
  for (const p of b.props) {
    const label = p.nickname || [p.street, p.unit].filter(Boolean).join(' ') || p.buildingName || p.city;
    add({ clientId: p.clientId, listingId: p.listingId, type: 'property_added', title: `Added ${REL_LABEL[p.relationship] || 'property'} · ${label}`, body: p.estValue ? `Est. value ${fmtMoney(p.estValue)}` : null, actor: p.source === 'described' ? 'ai' : 'agent', occurredAt: p.createdAt, meta: { propertyId: p.id, relationship: p.relationship } });
  }
  for (const s of b.searches) {
    const band = s.priceMin && s.priceMax ? `${fmtMoney(s.priceMin)}–${fmtMoney(s.priceMax)}` : '';
    add({ clientId: s.clientId, type: 'search_updated', title: `${s.bucket === 'dream' ? 'Dream' : s.bucket === 'inferred' ? 'Inferred search' : 'Search'} · ${s.name}`, body: [band, (s.neighborhoods || []).join(', ')].filter(Boolean).join(' · '), actor: s.bucket === 'inferred' ? 'ai' : 'agent', occurredAt: s.createdAt, meta: { searchId: s.id, bucket: s.bucket } });
  }

  // Tasks completed
  for (const t of b.tasks) {
    if (t.status === 'done' && t.clientId) add({ clientId: t.clientId, dealId: t.dealId, type: 'task_done', title: `Done · ${t.title}`, actor: 'agent', occurredAt: t.completedAt, meta: { taskId: t.id } });
  }

  acts.sort((a, b2) => a.occurredAt - b2.occurredAt);
  return acts.map((a, i) => ({ id: uid(`act:${i}:${a.type}:${a.occurredAt.getTime()}`), ...a }));
}

// Per-client contact timestamps + lifetime stats (mutates client rows).
function applyClientStats(S, clients, b) {
  const { ctx, rng } = S;
  const keyById = Object.fromEntries(Object.entries(S.clientId).map(([k, v]) => [v, k]));
  const inn = {}; const out = {}; const any = {};
  const bump = (map, k, t) => { if (k && (!map[k] || map[k] < t)) map[k] = t; };
  for (const t of Object.values(S.threadMsgs)) {
    for (const m of t.rows) {
      if (m.isFromMe) {
        const targets = t.isGroup ? t.participants : (t.client ? [t.client] : []);
        for (const k of targets) { bump(out, k, m.sentAt); if (m.status !== 'failed') bump(any, k, m.sentAt); }
      } else if (m._senderKey) { bump(inn, m._senderKey, m.sentAt); bump(any, m._senderKey, m.sentAt); }
    }
  }
  for (const c of b.calls) {
    const k = keyById[c.clientId];
    if (c.direction === 'inbound') bump(inn, k, c.startedAt); else bump(out, k, c.startedAt);
    if (c.status === 'completed') bump(any, k, c.startedAt);
  }
  for (const a of b.appts) if (a.clientId && a.status === 'completed' && a.endAt < ctx.now) bump(any, keyById[a.clientId], a.endAt);

  const life = {};
  for (const d of Object.values(S.dealRow)) {
    if (!d.closedAt) continue;
    const k = keyById[d.clientId];
    const L = life[k] || (life[k] = { volume: 0, gci: 0, count: 0, last: null });
    L.volume += d.salePrice; L.gci += d.grossCommission; L.count += d.splitShare || 1;
    if (!L.last || L.last < d.closedAt) L.last = d.closedAt;
  }

  for (const c of clients) {
    const k = keyById[c.id];
    const d = S.clientDefs[k];
    const L = life[k];
    if (L) Object.assign(c, { lifetimeVolume: L.volume, lifetimeGci: L.gci, transactionsCount: L.count, lastClosedAt: L.last });
    c.lastInboundAt = inn[k] || null;
    c.lastOutboundAt = out[k] || null;
    let last = any[k] || null;
    if (!last) {
      const fallbackDays = d.lastTouch || (L ? null : rng.int(18, 140));
      last = fallbackDays ? ctx.daysAgo(fallbackDays) : new Date(L.last.getTime() + 2 * 864e5);
      if (last > ctx.now) last = ctx.daysAgo(1);
    }
    c.lastContactedAt = last;
  }

  // Stefan replied STOP to the Just Listed blast.
  const stop = S.threadMsgs.c_stefan && S.threadMsgs.c_stefan.rows.find((m) => !m.isFromMe && /^STOP/.test(m.body));
  const stefan = clients.find((c) => c.id === S.clientId.stefan);
  if (stop && stefan) Object.assign(stefan, { textOptOut: true, textOptOutAt: stop.sentAt, textOptOutReason: 'Replied STOP to “Just Listed · 128 Sunset Drive” — prefers calls' });
}

module.exports = { buildActivities, applyClientStats };
