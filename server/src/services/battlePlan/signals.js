// Signal queries → deterministic candidates (the real-estate catalogue,
// spec 02 §11). The candidate pool is built FROM signals (unanswered
// questions, matches, lease ends, loan milestones, anniversaries, birthdays,
// idle searches, stalled deals, showings without feedback, optional sphere
// check-ins) — never from a "stale customers" list — then each referenced
// client gets a bundle (silence, tags, deal stage, expected GCI, property
// priority) the scorer reads.
const prisma = require('../../lib/prisma');
const { addDays, zonedTime } = require('../../lib/dates');
const { propertyPriority, tierFor } = require('./priority');

const DAY = 864e5;
const STAGE_ODDS = {
  new_lead: 0.2, seller_lead: 0.2, consultation: 0.35, listing_appt: 0.35,
  touring: 0.5, active: 0.5, offer_submitted: 0.7, offer_received: 0.7, under_contract: 0.9,
  unit_selection: 0.5, pricing_received: 0.6, priority_list: 0.7, reserved: 0.85,
};
const STAGE_LABEL = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted',
  under_contract: 'Under contract', seller_lead: 'Seller lead', listing_appt: 'Listing appointment', active: 'Active listing',
  offer_received: 'Offer received', unit_selection: 'Unit selection', pricing_received: 'Pricing received',
  priority_list: 'Priority list', reserved: 'Reserved',
};
const ESCROW_STAGES = ['under_contract', 'reserved', 'building_delivered'];
const SHOWING_TYPES = ['showing', 'private_tour', 'open_house'];

function nameOf(c) {
  if (!c) return '';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Client';
}
function firstOf(c) {
  if (!c) return 'them';
  return c.firstName || String(nameOf(c)).split(' ')[0] || 'them';
}
function addressOf(p) {
  if (!p) return null;
  const street = [p.street, p.unit || p.unitNumber].filter(Boolean).join(' ');
  return street || p.buildingName || p.nickname || p.neighborhood || p.city || null;
}
function listingLabel(l) {
  if (!l) return null;
  return addressOf(l) || l.title || l.headline || l.buildingName || null;
}
function dealPrice(d) {
  return d.contractPrice || d.salePrice || d.price || d.listPrice || 0;
}
function dealGci(d) {
  if (!d) return 0;
  if (d.estimatedGci) return d.estimatedGci;
  const price = dealPrice(d);
  if (!price) return 0;
  let rate = d.sideRate;
  if (!rate) {
    if (d.side === 'dual') rate = (d.listRate || 0.03) + (d.buyRate || 0.025);
    else if (d.side === 'listing') rate = d.listRate || 0.03;
    else rate = d.buyRate || 0.025;
  }
  return Math.round(price * rate * (d.splitShare || 1));
}
function expectedGci(d) {
  return Math.round(dealGci(d) * (STAGE_ODDS[d.stage] ?? 0.5));
}
function daysBetween(a, b) { return Math.round((b - a) / DAY); }
function ago(ms) {
  const h = Math.round(ms / 3600e3);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function dayLabel(date, tz) {
  return new Date(date).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
}

// birthday string ('YYYY-MM-DD' | 'MM-DD' | '--MM-DD') → days until next occurrence from planDate.
function daysToAnnual(monthDay, planDate) {
  if (!monthDay) return null;
  const [mm, dd] = monthDay;
  if (!mm || !dd) return null;
  const [y, m, d] = planDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  let next = Date.UTC(y, mm - 1, dd);
  if (next < base) next = Date.UTC(y + 1, mm - 1, dd);
  return Math.round((next - base) / DAY);
}
function parseMonthDay(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return [Number(m[2]), Number(m[3])];
  m = /^-{0,2}(\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

async function loadMatches(workspaceId, nowMs) {
  // Prefer the listings builder's matchmaker service when it exists.
  for (const mod of ['../matchmaker', '../matchmaker/recent', '../matchmaker/score']) {
    try {
      const svc = require(mod);
      if (svc && typeof svc.getRecentMatches === 'function') {
        const rows = await svc.getRecentMatches({ workspaceId, sinceDays: 14, minScore: 80 });
        const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.matches) ? rows.matches : []);
        if (list.length && list.every((r) => r && r.clientId && typeof r.score === 'number')) return list;
      }
    } catch { /* not built yet / different shape — fall back to the table */ }
  }
  return prisma.match.findMany({
    where: { workspaceId, score: { gte: 80 }, status: { in: ['new', 'seen', 'interested'] }, updatedAt: { gte: new Date(nowMs - 14 * DAY) } },
    orderBy: { score: 'desc' },
    take: 120,
  });
}

async function collectCandidates({ workspaceId, date, tz, now = new Date(), settings = {}, schedule, constraints = {} }) {
  const nowMs = now.getTime();
  const anchor = zonedTime(date, 12, 0, tz).getTime(); // noon of the plan day
  const out = [];
  const refs = new Set();
  const add = (c) => { out.push(c); if (c.contactId) refs.add(c.contactId); };

  const [convs, matches, props, birthdayClients, searches, deals, showings] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId, clientId: { not: null }, lastMessageFromMe: false, isGroup: false, archived: false, blocked: false, lastMessageAt: { gte: new Date(nowMs - 3 * DAY) } },
      select: { id: true, clientId: true, lastMessageAt: true, lastMessagePreview: true, channel: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 40,
    }),
    loadMatches(workspaceId, nowMs),
    prisma.portfolioProperty.findMany({
      where: {
        workspaceId,
        OR: [
          { relationship: 'rents', leaseEndsAt: { gte: new Date(anchor - DAY), lte: new Date(anchor + 90 * DAY) } },
          { relationship: { in: ['owns', 'leased_out'] }, loanResetAt: { gte: new Date(anchor - DAY), lte: new Date(anchor + 90 * DAY) } },
          { relationship: { in: ['owns', 'leased_out'] }, loanMaturesAt: { gte: new Date(anchor - DAY), lte: new Date(anchor + 60 * DAY) } },
          { relationship: 'owns', purchasedAt: { not: null, lte: new Date(anchor - 300 * DAY) } },
        ],
      },
      select: {
        id: true, clientId: true, relationship: true, street: true, unit: true, city: true, neighborhood: true, buildingName: true,
        nickname: true, leaseEndsAt: true, loanResetAt: true, loanMaturesAt: true, loanType: true, purchasedAt: true,
        estValue: true, purchasePrice: true, rentAmount: true,
      },
      take: 400,
    }),
    prisma.client.findMany({
      where: { workspaceId, birthday: { not: null }, archivedAt: null, blocked: false, contactKind: 'client' },
      select: { id: true, birthday: true },
      take: 2000,
    }),
    prisma.buyerSearch.findMany({
      where: {
        workspaceId, status: 'active', bucket: 'active', createdAt: { lte: new Date(nowMs - 14 * DAY) },
        OR: [{ lastMatchedAt: null }, { lastMatchedAt: { lt: new Date(nowMs - 14 * DAY) } }],
      },
      select: { id: true, clientId: true, name: true, createdAt: true, neighborhoods: true, markets: true, priceMax: true },
      take: 80,
    }),
    prisma.deal.findMany({
      where: {
        workspaceId, archivedAt: null, track: 'main', stage: { notIn: ['closed', 'lost', ...ESCROW_STAGES] },
        stageChangedAt: { lte: new Date(nowMs - 10 * DAY) },
      },
      orderBy: { stageChangedAt: 'asc' },
      take: 60,
    }),
    prisma.appointment.findMany({
      where: {
        workspaceId, type: { in: SHOWING_TYPES }, clientId: { not: null }, followUpLoggedAt: null, outcome: null,
        status: { notIn: ['cancelled', 'no_show'] },
        endAt: { gte: new Date(nowMs - 7 * DAY), lte: new Date(nowMs - 24 * 3600e3) },
      },
      orderBy: { endAt: 'desc' },
      take: 40,
    }),
  ]);

  // ── respond.text: their last message is a question, still unanswered ──
  if (convs.length) {
    const lastIn = await prisma.message.findMany({
      where: { conversationId: { in: convs.map((c) => c.id) }, isFromMe: false },
      orderBy: { sentAt: 'desc' },
      distinct: ['conversationId'],
      select: { conversationId: true, body: true, sentAt: true },
    });
    const byConv = new Map(lastIn.map((m) => [m.conversationId, m]));
    const seen = new Set();
    for (const c of convs) {
      const msg = byConv.get(c.id);
      const body = (msg && msg.body) || c.lastMessagePreview || '';
      if (!body.includes('?') || seen.has(c.clientId)) continue;
      seen.add(c.clientId);
      const at = (msg && msg.sentAt) || c.lastMessageAt;
      add({
        kind: 'respond.text', channel: 'text', contactId: c.clientId, durationMin: 5,
        conversationId: c.id,
        signal: { sourceKind: 'message', summary: `Asked a question: "${body.slice(0, 140)}"` },
        ctx: { preview: body.replace(/\s+/g, ' ').slice(0, 140), agoLabel: ago(nowMs - new Date(at).getTime()), lastInboundAt: at },
      });
    }
  }

  // ── matches: one per client (the top one) ──
  const listingIds = [...new Set(matches.map((m) => m.listingId).filter(Boolean))];
  const propIds = [...new Set(matches.map((m) => m.propertyId).filter(Boolean))];
  const searchIds = [...new Set(matches.map((m) => m.searchId).filter(Boolean))];
  const [listings, offProps, matchSearches] = await Promise.all([
    listingIds.length ? prisma.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, headline: true, street: true, unitNumber: true, city: true, neighborhood: true, buildingName: true, listPrice: true, waterfront: true, views: true, propertyType: true, status: true } }) : [],
    propIds.length ? prisma.portfolioProperty.findMany({ where: { id: { in: propIds } }, select: { id: true, clientId: true, street: true, unit: true, city: true, neighborhood: true, buildingName: true, estValue: true, waterfront: true, views: true } }) : [],
    searchIds.length ? prisma.buyerSearch.findMany({ where: { id: { in: searchIds } }, select: { id: true, name: true, neighborhoods: true } }) : [],
  ]);
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const propById = new Map(offProps.map((p) => [p.id, p]));
  const searchById = new Map(matchSearches.map((s) => [s.id, s]));
  const topMatch = new Map();
  const matchedClients = new Set();
  for (const m of matches) {
    matchedClients.add(m.clientId);
    const listing = m.listingId ? listingById.get(m.listingId) : null;
    if (listing && ['sold', 'withdrawn', 'expired'].includes(listing.status)) continue;
    const prev = topMatch.get(m.clientId);
    if (!prev || m.score > prev.score) topMatch.set(m.clientId, m);
  }
  for (const m of topMatch.values()) {
    const listing = m.listingId ? listingById.get(m.listingId) : null;
    const prop = m.propertyId ? propById.get(m.propertyId) : null;
    const offmarket = m.kind === 'offmarket' || (!!prop && !listing);
    let kind;
    if (offmarket) { if (m.score < 90) continue; kind = 'offmarket.match.call'; }
    else kind = m.score >= 95 ? 'listing.match.call' : 'listing.match.send';
    const price = listing ? listing.listPrice : (prop ? prop.estValue : null);
    const label = listing ? listingLabel(listing) : addressOf(prop);
    const search = m.searchId ? searchById.get(m.searchId) : null;
    add({
      kind, channel: kind.endsWith('.call') ? 'call' : 'text', contactId: m.clientId,
      durationMin: kind === 'listing.match.send' ? 10 : 15,
      matchScore: m.score, listingId: m.listingId || null, propertyId: m.propertyId || null,
      potentialGci: price ? Math.round(price * 0.025 * 0.35) : null,
      signal: { sourceKind: offmarket ? 'offmarket' : 'match', summary: `${offmarket ? 'Off-market' : (m.kind === 'price_drop' ? 'Price-drop' : 'New-listing')} match @ ${m.score} — ${label || 'listing'}${price ? ` (${Math.round(price / 1e5) / 10}M)` : ''}.` },
      ctx: {
        matchScore: m.score, listingLabel: label, listingShort: label ? `the ${String(label).split(',')[0]} listing` : null,
        listingPrice: price, searchName: search ? (search.name || null) : null,
        matchReason: m.summary ? String(m.summary).slice(0, 100) : null, ownerId: prop ? prop.clientId : null,
        attrText: listing ? [listing.waterfront, ...(listing.views || []), listing.propertyType].filter(Boolean).join(' ') : '',
      },
    });
  }

  // ── portfolio: lease ends, loan milestones, purchase anniversaries ──
  const [py, pm, pd] = date.split('-').map(Number);
  for (const p of props) {
    const addr = addressOf(p);
    if (p.relationship === 'rents' && p.leaseEndsAt) {
      const t = new Date(p.leaseEndsAt).getTime();
      if (t >= anchor - DAY && t <= anchor + 90 * DAY) {
        const days = Math.max(0, daysBetween(anchor, t));
        add({
          kind: 'lease.expiry.call', channel: 'call', contactId: p.clientId, durationMin: 15, propertyId: p.id,
          signal: { sourceKind: 'lease', summary: `Lease ending in ${days} days${addr ? ` at ${addr}` : ''}.` },
          ctx: { address: addr, daysUntil: days, dateLabel: dayLabel(p.leaseEndsAt, tz) },
        });
        continue;
      }
    }
    const reset = p.loanResetAt ? new Date(p.loanResetAt).getTime() : null;
    const mature = p.loanMaturesAt ? new Date(p.loanMaturesAt).getTime() : null;
    if (reset && reset >= anchor - DAY && reset <= anchor + 90 * DAY) {
      const days = Math.max(0, daysBetween(anchor, reset));
      add({
        kind: 'equity.milestone.call', channel: 'call', contactId: p.clientId, durationMin: 15, propertyId: p.id,
        signal: { sourceKind: 'equity', summary: `${p.loanType === 'arm' ? 'ARM' : 'Rate'} reset in ${days} days${addr ? ` on ${addr}` : ''}.` },
        ctx: { address: addr, daysUntil: days, milestone: `${p.loanType === 'arm' ? 'ARM' : 'rate'} reset ${dayLabel(p.loanResetAt, tz).split(', ')[1] || ''}`.trim(), milestoneSentence: `Their ${p.loanType === 'arm' ? 'ARM' : 'loan rate'} resets`, estValue: p.estValue },
      });
      continue;
    }
    if (mature && mature >= anchor - DAY && mature <= anchor + 60 * DAY) {
      const days = Math.max(0, daysBetween(anchor, mature));
      add({
        kind: 'equity.milestone.call', channel: 'call', contactId: p.clientId, durationMin: 15, propertyId: p.id,
        signal: { sourceKind: 'equity', summary: `Loan matures in ${days} days${addr ? ` on ${addr}` : ''}.` },
        ctx: { address: addr, daysUntil: days, milestone: 'loan maturity', milestoneSentence: 'Their loan matures', estValue: p.estValue },
      });
      continue;
    }
    if (p.relationship === 'owns' && p.purchasedAt) {
      const pdte = new Date(p.purchasedAt);
      const md = [pdte.getUTCMonth() + 1, pdte.getUTCDate()];
      const days = daysToAnnual(md, date);
      if (days != null && days <= 14) {
        const annivYear = Date.UTC(py, md[0] - 1, md[1]) >= Date.UTC(py, pm - 1, pd) ? py : py + 1;
        const years = annivYear - pdte.getUTCFullYear();
        if (years >= 1) {
          add({
            kind: 'anniversary.text', channel: 'text', contactId: p.clientId, durationMin: 5, propertyId: p.id,
            signal: { sourceKind: 'anniversary', summary: `${years}-year home anniversary${days ? ` in ${days} days` : ' today'}${addr ? ` — ${addr}` : ''}.` },
            ctx: { address: addr, years, daysUntil: days, dateLabel: days === 0 ? 'today' : dayLabel(Date.UTC(annivYear, md[0] - 1, md[1], 12), 'UTC') },
          });
        }
      }
    }
  }

  // ── birthdays ≤ 14 days ──
  for (const c of birthdayClients) {
    const days = daysToAnnual(parseMonthDay(c.birthday), date);
    if (days == null || days > 14) continue;
    const md = parseMonthDay(c.birthday);
    const yr = Date.UTC(py, md[0] - 1, md[1]) >= Date.UTC(py, pm - 1, pd) ? py : py + 1;
    add({
      kind: 'birthday.text', channel: 'text', contactId: c.id, durationMin: 5,
      signal: { sourceKind: 'birthday', summary: days === 0 ? 'Birthday today.' : `Birthday in ${days} days.` },
      ctx: { daysUntil: days, dateLabel: days === 0 ? 'today' : new Date(Date.UTC(yr, md[0] - 1, md[1], 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }) },
    });
  }

  // ── search.nudge: active ≥14 d, no match or showing in 14 d ──
  if (searches.length) {
    const sClientIds = [...new Set(searches.map((s) => s.clientId))];
    const recentShowings = await prisma.appointment.findMany({
      where: { workspaceId, clientId: { in: sClientIds }, type: { in: SHOWING_TYPES }, startAt: { gte: new Date(nowMs - 14 * DAY) }, status: { not: 'cancelled' } },
      select: { clientId: true },
    });
    const showed = new Set(recentShowings.map((a) => a.clientId));
    const seen = new Set();
    for (const s of searches) {
      if (seen.has(s.clientId) || showed.has(s.clientId) || matchedClients.has(s.clientId)) continue;
      seen.add(s.clientId);
      const days = daysBetween(new Date(s.createdAt).getTime(), nowMs);
      const label = s.name || (s.neighborhoods && s.neighborhoods.length ? `${s.neighborhoods.slice(0, 2).join(' / ')} search` : 'Their search');
      add({
        kind: 'search.nudge', channel: 'text', contactId: s.clientId, durationMin: 10, searchId: s.id,
        signal: { sourceKind: 'search', summary: `${label} running ${days} days with no new match or showing in 14 days.` },
        ctx: { searchName: label, searchDays: days, priceMax: s.priceMax },
      });
    }
  }

  // ── deal.unstick: open, non-escrow, stage ≥10 d and quiet ≥10 d ──
  for (const d of deals) {
    const stageDays = daysBetween(new Date(d.stageChangedAt).getTime(), nowMs);
    add({
      kind: 'deal.unstick', channel: 'call', contactId: d.clientId, durationMin: 15, dealId: d.id,
      requireSilenceDays: 10,
      impactDollars: expectedGci(d),
      signal: { sourceKind: 'deal', summary: `Deal stuck at "${STAGE_LABEL[d.stage] || d.stage}" for ${stageDays} days.` },
      ctx: { stageLabel: STAGE_LABEL[d.stage] || d.stage, stageDays, property: d.propertyLabel || d.propertyAddress || d.title || null },
    });
  }

  // ── showing.feedback: ended ≥24h ago, no outcome / follow-up logged ──
  {
    const seen = new Set();
    for (const a of showings) {
      if (seen.has(a.clientId)) continue;
      seen.add(a.clientId);
      const typeLabel = a.type === 'open_house' ? 'Open house' : a.type === 'private_tour' ? 'Private tour' : 'Showing';
      add({
        kind: 'showing.feedback', channel: 'call', contactId: a.clientId, durationMin: 10, appointmentId: a.id, listingId: a.listingId || null,
        followUpAfter: a.endAt,
        signal: { sourceKind: 'showing', summary: `${typeLabel} at ${a.location || a.title} ended ${ago(nowMs - new Date(a.endAt).getTime())} — no feedback logged.` },
        ctx: { address: a.location || a.title, typeLabel, whenLabel: ago(nowMs - new Date(a.endAt).getTime()) },
      });
    }
  }

  // ── soi.checkin.text (opt-in): past clients / sphere silent ≥ 90 d ──
  const bp = (settings && settings.battlePlan) || {};
  if (bp.soiCheckins) {
    const cap = Math.max(1, Math.min(10, Number(bp.soiDailyCap) || 3));
    const recent = await prisma.planMove.findMany({
      where: { workspaceId, kind: 'soi.checkin.text', createdAt: { gte: new Date(nowMs - 3 * DAY) } },
      select: { clientId: true },
    });
    const cooled = new Set(recent.map((r) => r.clientId));
    const sphere = await prisma.client.findMany({
      where: {
        workspaceId, archivedAt: null, blocked: false, contactKind: 'client', status: { in: ['past_client', 'sphere'] },
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(nowMs - 90 * DAY) } }],
      },
      orderBy: [{ rating: 'desc' }, { lastContactedAt: 'asc' }],
      select: { id: true, status: true, lastContactedAt: true },
      take: cap * 4,
    });
    let n = 0;
    for (const c of sphere) {
      if (n >= cap || cooled.has(c.id) || refs.has(c.id)) continue;
      n += 1;
      const days = c.lastContactedAt ? daysBetween(new Date(c.lastContactedAt).getTime(), nowMs) : null;
      add({
        kind: 'soi.checkin.text', channel: 'text', contactId: c.id, durationMin: 5,
        signal: { sourceKind: 'silence', summary: days ? `${days} days since last touch — ${c.status === 'past_client' ? 'past client' : 'sphere'}.` : 'No logged outreach yet.' },
        ctx: { silenceDays: days, statusLabel: c.status === 'past_client' ? 'a past client' : 'in your sphere' },
      });
    }
  }

  // ── bundles for every referenced client ──
  const ids = [...refs];
  const bundles = new Map();
  if (ids.length) {
    const [clients, openDeals, activeSearches, owned] = await Promise.all([
      prisma.client.findMany({
        where: { workspaceId, id: { in: ids } },
        select: {
          id: true, firstName: true, lastName: true, displayName: true, phone: true, rating: true, isWhale: true,
          transactionsCount: true, lastContactedAt: true, lastInboundAt: true, lastOutboundAt: true, notes: true,
          textOptOut: true, blocked: true, archivedAt: true, contactKind: true, status: true, purchasePower: true, avatarUrl: true,
        },
      }),
      prisma.deal.findMany({ where: { workspaceId, clientId: { in: ids }, archivedAt: null, stage: { notIn: ['closed', 'lost'] } }, orderBy: { updatedAt: 'desc' } }),
      prisma.buyerSearch.findMany({ where: { workspaceId, clientId: { in: ids }, status: 'active' }, select: { clientId: true, priceMax: true, priceMin: true, waterfront: true, views: true, propertyTypes: true } }),
      prisma.portfolioProperty.findMany({ where: { workspaceId, clientId: { in: ids }, relationship: 'owns' }, select: { clientId: true, estValue: true, purchasePrice: true, waterfront: true, views: true, propertyType: true } }),
    ]);
    const dealsBy = new Map(); for (const d of openDeals) { if (!dealsBy.has(d.clientId)) dealsBy.set(d.clientId, d); }
    const searchBy = new Map(); for (const s of activeSearches) { const p = searchBy.get(s.clientId); if (!p || (s.priceMax || 0) > (p.priceMax || 0)) searchBy.set(s.clientId, s); }
    const ownBy = new Map(); for (const o of owned) { const p = ownBy.get(o.clientId); if (!p || (o.estValue || 0) > (p.estValue || 0)) ownBy.set(o.clientId, o); }
    for (const c of clients) {
      const deal = dealsBy.get(c.id) || null;
      const search = searchBy.get(c.id) || null;
      const own = ownBy.get(c.id) || null;
      const lastTouch = [c.lastContactedAt, c.lastInboundAt, c.lastOutboundAt].filter(Boolean).map((d) => new Date(d).getTime());
      const silenceDays = lastTouch.length ? Math.floor((nowMs - Math.max(...lastTouch)) / DAY) : null;
      const price = (deal && dealPrice(deal)) || (search && (search.priceMax || search.priceMin)) || (own && (own.estValue || own.purchasePrice)) || c.purchasePower || null;
      const attr = [
        ...(search ? [...(search.waterfront || []), ...(search.views || []), ...(search.propertyTypes || [])] : []),
        ...(own ? [own.waterfront, ...(own.views || []), own.propertyType] : []),
      ].filter(Boolean).join(' ');
      const tags = [];
      if (c.isWhale || (c.rating || 0) >= 5) tags.push('whale');
      if ((c.transactionsCount || 0) >= 2) tags.push('repeat');
      if ((c.rating || 0) >= 4) tags.push('vip');
      bundles.set(c.id, {
        client: c,
        name: nameOf(c),
        first: firstOf(c),
        tags,
        silenceDays,
        lastInboundAt: c.lastInboundAt,
        dealStage: deal ? deal.stage : null,
        deal,
        dealGci: deal ? dealGci(deal) : 0,
        expectedGci: deal ? expectedGci(deal) : 0,
        propertyPriority: propertyPriority(price, attr),
        tier: tierFor(price),
        noteHighlights: String(c.notes || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5).map((l) => l.slice(0, 180)),
        textOptOut: !!c.textOptOut,
        excluded: c.blocked || !!c.archivedAt || (c.contactKind && c.contactKind !== 'client'),
      });
    }
  }

  // ── finalize: attach names, impact, drop excluded / opted-out / not-quiet-enough ──
  const final = [];
  for (const c of out) {
    const b = bundles.get(c.contactId);
    if (!b || b.excluded) continue;
    if (c.channel === 'text' && b.textOptOut) continue;
    if (c.requireSilenceDays && b.silenceDays != null && b.silenceDays < c.requireSilenceDays) continue;
    if (c.kind === 'showing.feedback' && b.client.lastOutboundAt && c.followUpAfter && new Date(b.client.lastOutboundAt) > new Date(c.followUpAfter)) continue;
    if (c.impactDollars == null) {
      if (b.expectedGci) c.impactDollars = b.expectedGci;
      else if (c.potentialGci) c.impactDollars = c.potentialGci;
    }
    c.nowMs = nowMs;
    c.ctx = { ...c.ctx, first: b.first, name: b.name };
    if (c.kind === 'offmarket.match.call' && c.ctx.ownerId) {
      const ownerB = bundles.get(c.ctx.ownerId);
      if (ownerB) c.ctx.ownerFirst = ownerB.first;
    }
    final.push(c);
  }

  // mandatory standing blocks
  const contentMin = constraints.contentBlockMin || (schedule && schedule.contentBlock && schedule.contentBlock.durationMin) || 90;
  if (!schedule || schedule.contentBlock.enabled !== false) {
    final.push({ kind: 'content.block', channel: 'content', contactId: null, durationMin: Math.max(15, Math.min(240, contentMin)), signal: { sourceKind: 'content', summary: 'Daily content block.' }, ctx: {}, mandatory: true });
  }
  if (!schedule || schedule.lunch.enabled !== false) {
    const lunchMin = constraints.lunchDurationMin || (schedule && schedule.lunch && schedule.lunch.durationMin) || 45;
    final.push({ kind: 'personal.lunch', channel: 'personal', contactId: null, durationMin: Math.max(15, Math.min(120, lunchMin)), signal: { sourceKind: 'lunch', summary: 'Protected lunch.' }, ctx: {}, mandatory: true });
  }
  return { candidates: final, bundles };
}

module.exports = { collectCandidates, dealGci, expectedGci, dealPrice, STAGE_ODDS, STAGE_LABEL, addressOf, listingLabel, nameOf, firstOf, parseMonthDay, daysToAnnual };
