// Read models for money + pipeline screens:
//   commissionsSummary  → GET /api/commissions/summary (Commissions page, dashboard Stats)
//   boardSummary        → GET /api/pipeline/summary   (board header, Pipeline Health)
//   bookLedger / bookClients → GET /api/book, /api/book/clients
// Closed deals are always queried directly (never through the board's archive
// filter — RevMatch's "history drops after rollover" bug).
const prisma = require('../../lib/prisma');
const { monthBounds, yearBounds, partsIn, zonedTime } = require('../../lib/dates');
const S = require('./stages');
const C = require('./commission');
const { pricingContext, capYearBounds } = require('./plan');
const N = require('./normalize');

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthKeyOf(date, tz) {
  const p = partsIn(new Date(date), tz);
  return `${p.year}-${pad(p.month)}`;
}
function monthLabelOf(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  return short ? name.slice(0, 3) : `${name} ${y}`;
}
function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function monthStart(key, tz) { return zonedTime(`${key}-01`, 0, 0, tz); }

const emptyAgg = () => ({ closings: 0, sides: 0, volume: 0, gci: 0, net: 0, bookedNet: 0, estimatedNet: 0, estimatedCount: 0 });
function addTo(agg, r) {
  agg.closings += 1;
  agg.sides += r.sides;
  agg.volume += r.volume;
  agg.gci += r.myGci;
  agg.net += r.net;
  if (r.booked) agg.bookedNet += r.bookedNet; else { agg.estimatedNet += r.net; agg.estimatedCount += 1; }
  return agg;
}
function roundAgg(a) {
  return { ...a, sides: Math.round(a.sides * 100) / 100, volume: Math.round(a.volume), gci: Math.round(a.gci), net: Math.round(a.net), bookedNet: Math.round(a.bookedNet), estimatedNet: Math.round(a.estimatedNet) };
}

// Walk every closing in date order, resetting the cap state at each cap-year
// boundary, so each deal's estimated net reflects where the cap stood then.
function walkClosings(deals, plan, tz) {
  const sorted = [...deals].sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));
  const out = new Map();
  let yearKey = null;
  let ytd = { gci: 0, company: 0, franchise: 0 };
  for (const d of sorted) {
    const when = d.closedAt ? new Date(d.closedAt) : new Date(d.updatedAt || Date.now());
    const k = capYearBounds(plan, when, tz).start.toISOString();
    if (k !== yearKey) { yearKey = k; ytd = { gci: 0, company: 0, franchise: 0 }; }
    const e = C.estimate(d, plan, ytd);
    out.set(d.id, e);
    ytd = e.after;
  }
  return out;
}

async function clientsById(workspaceId, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await prisma.client.findMany({ where: { workspaceId, id: { in: uniq } }, select: N.CLIENT_SELECT });
  return new Map(rows.map((c) => [c.id, c]));
}
async function listingsById(workspaceId, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await prisma.listing.findMany({ where: { workspaceId, id: { in: uniq } }, select: N.LISTING_SELECT });
  return new Map(rows.map((l) => [l.id, l]));
}
async function propertiesById(workspaceId, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await prisma.portfolioProperty.findMany({ where: { workspaceId, id: { in: uniq } }, select: N.PROPERTY_SELECT });
  return new Map(rows.map((p) => [p.id, p]));
}

function dealAddress(d, listings, properties) {
  const l = d.listingId ? listings.get(d.listingId) : null;
  const p = d.portfolioPropertyId ? properties.get(d.portfolioPropertyId) : null;
  return d.propertyAddress || N.listingAddress(l) || N.propertyAddress(p) || d.propertyLabel || null;
}
function dealPhoto(d, listings, properties) {
  const l = d.listingId ? listings.get(d.listingId) : null;
  const p = d.portfolioPropertyId ? properties.get(d.portfolioPropertyId) : null;
  return (l && (l.heroPhoto || (l.photoUrls || [])[0])) || (p && (p.heroPhoto || (p.photos || [])[0])) || null;
}

// ── GET /api/commissions/summary ───────────────────────────────────────────
async function commissionsSummary(workspaceId, { now = new Date(), historyMonths = 36 } = {}) {
  const px = await pricingContext(workspaceId, now);
  const { tz, plan, cap } = px;
  const month = monthBounds(now, tz);
  const thisKey = monthKeyOf(now, tz);
  const lastKey = addMonths(thisKey, -1);
  const lastStart = monthStart(lastKey, tz);
  const year = yearBounds(now, tz);
  const histStart = monthStart(addMonths(thisKey, -(historyMonths - 1)), tz);
  const since = new Date(Math.min(histStart.getTime(), cap.start.getTime(), year.start.getTime()));

  const [closed, open] = await Promise.all([
    prisma.deal.findMany({ where: { workspaceId, stage: 'closed', OR: [{ closedAt: { gte: since } }, { closedAt: null }] }, orderBy: { closedAt: 'desc' } }),
    prisma.deal.findMany({ where: { workspaceId, stage: { notIn: ['closed', 'lost'] } } }),
  ]);
  // Earlier closings in the cap year still matter for its walk.
  const est = walkClosings(closed, plan, tz);
  const [clients, listings, properties] = await Promise.all([
    clientsById(workspaceId, [...closed, ...open].map((d) => d.clientId)),
    listingsById(workspaceId, [...closed, ...open].map((d) => d.listingId)),
    propertiesById(workspaceId, [...closed, ...open].map((d) => d.portfolioPropertyId)),
  ]);

  const mtd = emptyAgg(); const last = emptyAgg(); const ytd = emptyAgg(); const capYear = emptyAgg();
  const byMonth = new Map();
  for (const d of closed) {
    const e = est.get(d.id);
    if (!e) continue;
    const at = d.closedAt ? new Date(d.closedAt) : null;
    if (at) {
      if (at >= month.start && at < month.end) addTo(mtd, e);
      if (at >= lastStart && at < month.start) addTo(last, e);
      if (at >= year.start && at < year.end) addTo(ytd, e);
      if (at >= cap.start && at < cap.end) addTo(capYear, e);
    }
    const key = at ? monthKeyOf(at, tz) : 'earlier';
    if (!byMonth.has(key)) byMonth.set(key, { key, label: key === 'earlier' ? 'Earlier' : monthLabelOf(key), ...emptyAgg(), deals: [] });
    const b = byMonth.get(key);
    addTo(b, e);
    const c = clients.get(d.clientId);
    b.deals.push({
      id: d.id,
      clientId: d.clientId,
      name: N.clientName(c),
      side: d.side,
      sideLabel: S.sideInfo(d.side).label,
      address: dealAddress(d, listings, properties),
      photo: dealPhoto(d, listings, properties),
      price: e.price,
      closedAt: d.closedAt ? d.closedAt.toISOString() : null,
      net: e.net,
      gci: e.myGci,
      sides: e.sides,
      booked: e.booked,
    });
  }

  // 12-month series for the bar chart (oldest → newest).
  const series = [];
  for (let i = 11; i >= 0; i--) {
    const key = addMonths(thisKey, -i);
    const b = byMonth.get(key);
    series.push({
      key,
      label: monthLabelOf(key, true),
      year: Number(key.slice(0, 4)),
      net: b ? Math.round(b.net) : 0,
      gci: b ? Math.round(b.gci) : 0,
      sides: b ? Math.round(b.sides * 100) / 100 : 0,
      volume: b ? Math.round(b.volume) : 0,
      closings: b ? b.closings : 0,
      current: key === thisKey,
    });
  }
  const history = [...byMonth.values()]
    .sort((a, b) => (a.key === 'earlier' ? 1 : b.key === 'earlier' ? -1 : b.key.localeCompare(a.key)))
    .map((b) => ({ ...roundAgg(b), key: b.key, label: b.label, deals: b.deals.sort((x, y) => String(y.closedAt).localeCompare(String(x.closedAt))) }));

  // Open pipeline → forecast + pending.
  let weighted = 0; let unweighted = 0; let eomPending = 0;
  const fBuckets = new Map();
  const unscheduled = { weighted: 0, unweighted: 0, count: 0 };
  const pendingMap = new Map();
  for (const d of open) {
    const e = C.estimate(d, plan, cap.ytd);
    const net = e.estimatedNet != null ? e.estimatedNet : e.net;
    const odds = S.odds(d.stage);
    weighted += net * odds;
    unweighted += net;
    const date = d.closingDate || (d.track === 'new_dev' ? d.estCompletion : null);
    if (date) {
      const key = monthKeyOf(date, tz);
      if (key === thisKey) eomPending += net * odds;
      if (!fBuckets.has(key)) fBuckets.set(key, { weighted: 0, unweighted: 0, count: 0 });
      const fb = fBuckets.get(key);
      fb.weighted += net * odds; fb.unweighted += net; fb.count += 1;
    } else {
      unscheduled.weighted += net * odds; unscheduled.unweighted += net; unscheduled.count += 1;
    }
    if (S.phaseOf(d.stage) === 'under_contract') {
      const key = d.closingDate ? monthKeyOf(d.closingDate, tz) : 'nodate';
      if (!pendingMap.has(key)) pendingMap.set(key, { key, label: key === 'nodate' ? 'No closing date' : monthLabelOf(key), net: 0, gci: 0, volume: 0, count: 0, deals: [] });
      const p = pendingMap.get(key);
      p.net += net; p.gci += e.myGci; p.volume += e.volume; p.count += 1;
      const c = clients.get(d.clientId);
      p.deals.push({
        id: d.id,
        clientId: d.clientId,
        name: N.clientName(c),
        side: d.side,
        address: dealAddress(d, listings, properties),
        photo: dealPhoto(d, listings, properties),
        price: e.price,
        closingDate: d.closingDate ? d.closingDate.toISOString() : null,
        daysToClose: d.closingDate ? Math.ceil((new Date(d.closingDate) - now) / DAY) : null,
        net,
        subStatus: d.subStatus || null,
      });
    }
  }
  const forecastMonths = [];
  for (let i = 0; i < 6; i++) {
    const key = addMonths(thisKey, i);
    const fb = fBuckets.get(key) || { weighted: 0, unweighted: 0, count: 0 };
    forecastMonths.push({ key, label: monthLabelOf(key, true), weighted: Math.round(fb.weighted), unweighted: Math.round(fb.unweighted), count: fb.count });
  }
  const pending = [...pendingMap.values()]
    .sort((a, b) => (a.key === 'nodate' ? 1 : b.key === 'nodate' ? -1 : a.key.localeCompare(b.key)))
    .map((p) => ({ ...p, net: Math.round(p.net), gci: Math.round(p.gci), volume: Math.round(p.volume), deals: p.deals.sort((x, y) => String(x.closingDate).localeCompare(String(y.closingDate))) }));
  const pendingTotal = pending.reduce((s, p) => s + p.net, 0);

  // Cap.
  const capAmount = plan.capAmount;
  const paid = Math.round(cap.ytd.company);
  const capInfo = {
    amount: capAmount,
    paid,
    remaining: capAmount != null ? Math.max(0, capAmount - paid) : null,
    pct: capAmount ? Math.min(1, paid / capAmount) : null,
    capped: capAmount != null && paid >= capAmount,
    anniversary: cap.anniversary,
    start: cap.start.toISOString(),
    end: cap.end.toISOString(),
    gciYtd: Math.round(cap.ytd.gci),
    postCapSplit: plan.postCapSplit,
    agentSplit: plan.agentSplit,
    currentSplit: C.splitFor(plan, cap.ytd.gci),
    tiers: (plan.tiers || []).map((t) => ({ ...t, reached: cap.ytd.gci >= t.fromGci })),
    franchise: { paid: Math.round(cap.ytd.franchise), cap: plan.franchiseCap, pct: plan.franchisePct },
    planType: plan.planType,
  };

  // Goals + pace (calendar year).
  const g = plan.goals || {};
  const p = partsIn(now, tz);
  const dayOfYear = Math.floor((now - year.start) / DAY) + 1;
  const daysInYear = Math.round((year.end - year.start) / DAY);
  const daysInMonth = Math.round((month.end - month.start) / DAY);
  const yearFrac = dayOfYear / daysInYear;
  const monthFrac = p.day / daysInMonth;
  const goals = {
    annualGci: g.annualGci ?? null,
    annualNet: g.annualNet ?? null,
    annualSides: g.annualSides ?? null,
    annualVolume: g.annualVolume ?? null,
    monthlySides: g.monthlySides ?? (g.annualSides ? Math.round((g.annualSides / 12) * 10) / 10 : null),
    focusSides: g.focusSides ?? null,
    yearFrac,
    monthFrac,
    progress: {
      gci: g.annualGci ? ytd.gci / g.annualGci : null,
      sides: g.annualSides ? ytd.sides / g.annualSides : null,
      volume: g.annualVolume ? ytd.volume / g.annualVolume : null,
      monthSides: (g.monthlySides || (g.annualSides && g.annualSides / 12)) ? mtd.sides / (g.monthlySides || g.annualSides / 12) : null,
    },
    pace: {
      gci: g.annualGci ? Math.round(g.annualGci * yearFrac) : null,
      sides: g.annualSides ? Math.round(g.annualSides * yearFrac * 10) / 10 : null,
      volume: g.annualVolume ? Math.round(g.annualVolume * yearFrac) : null,
      monthSides: g.monthlySides ? Math.round(g.monthlySides * monthFrac * 10) / 10 : null,
    },
  };

  // Referral fees.
  const refRows = [...open, ...closed].filter((d) => (d.referralOutPct && d.referralOutPct > 0) || d.side === 'referral_out');
  const payable = { total: 0, pending: 0, due: 0, rows: [] };
  const receivable = { total: 0, pending: 0, received: 0, rows: [] };
  for (const d of refRows) {
    const e = est.get(d.id) || C.estimate(d, plan, cap.ytd);
    const c = clients.get(d.clientId);
    const ex = d.extras && typeof d.extras === 'object' ? d.extras : {};
    const base = {
      dealId: d.id,
      clientId: d.clientId,
      name: N.clientName(c),
      partner: ex.referralPartner || d.coAgentName || d.coAgentBrokerage || null,
      stage: d.stage,
      label: S.labelFor(d.stage, d.side).label,
      closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    };
    if (d.side === 'referral_out') {
      const amount = e.sideGci;
      const status = d.stage === 'closed' ? 'received' : 'pending';
      receivable.rows.push({ ...base, amount, status });
      receivable.total += amount;
      if (status === 'received') receivable.received += amount; else receivable.pending += amount;
    }
    if (d.referralOutPct && d.referralOutPct > 0) {
      const amount = e.referralOut;
      const status = d.stage === 'closed' ? (ex.referralPaid ? 'paid' : 'due') : 'pending';
      payable.rows.push({ ...base, amount, status, pct: d.referralOutPct });
      payable.total += amount;
      if (status === 'pending') payable.pending += amount; else payable.due += amount;
    }
  }
  const byStatus = (a, b) => (a.status === b.status ? String(b.closedAt).localeCompare(String(a.closedAt)) : a.status === 'pending' ? 1 : -1);
  payable.rows.sort(byStatus); receivable.rows.sort(byStatus);

  return {
    asOf: now.toISOString(),
    timezone: tz,
    month: { key: thisKey, label: monthLabelOf(thisKey), start: month.start.toISOString(), end: month.end.toISOString() },
    mtd: roundAgg(mtd),
    lastMonth: roundAgg(last),
    ytd: roundAgg(ytd),
    capYear: roundAgg(capYear),
    projected: {
      weighted: Math.round(weighted),
      unweighted: Math.round(unweighted),
      eom: Math.round(mtd.net + eomPending),
      eomPending: Math.round(eomPending),
      openDeals: open.length,
      byMonth: forecastMonths,
      unscheduled: { weighted: Math.round(unscheduled.weighted), unweighted: Math.round(unscheduled.unweighted), count: unscheduled.count },
      weights: Object.fromEntries(S.PHASES.map((ph) => [ph.id, ph.odds])),
    },
    pending,
    pendingTotal,
    goals,
    cap: capInfo,
    series,
    history,
    referrals: {
      payable: { ...payable, total: Math.round(payable.total), pending: Math.round(payable.pending), due: Math.round(payable.due) },
      receivable: { ...receivable, total: Math.round(receivable.total), pending: Math.round(receivable.pending), received: Math.round(receivable.received) },
    },
    plan: {
      id: plan.id,
      name: plan.name,
      planType: plan.planType,
      defaultBuyerRate: plan.defaultBuyerRate,
      defaultListingRate: plan.defaultListingRate,
      agentSplit: plan.agentSplit,
      capAmount: plan.capAmount,
      transactionFee: plan.transactionFee,
      postCapTransactionFee: plan.postCapTransactionFee,
    },
  };
}

// ── GET /api/pipeline/summary ──────────────────────────────────────────────
async function boardSummary(workspaceId, { now = new Date() } = {}) {
  const px = await pricingContext(workspaceId, now);
  const { tz, plan, cap } = px;
  const month = monthBounds(now, tz);
  const [open, closedThisMonth] = await Promise.all([
    prisma.deal.findMany({ where: { workspaceId, stage: { notIn: ['closed', 'lost'] } } }),
    prisma.deal.findMany({ where: { workspaceId, stage: 'closed', closedAt: { gte: month.start, lt: month.end } } }),
  ]);
  const [clients, listings, properties] = await Promise.all([
    clientsById(workspaceId, open.map((d) => d.clientId)),
    listingsById(workspaceId, open.map((d) => d.listingId)),
    propertiesById(workspaceId, open.map((d) => d.portfolioPropertyId)),
  ]);
  const byPhase = Object.fromEntries(S.PHASES.map((p) => [p.id, { id: p.id, label: p.label, color: p.color, count: 0, volume: 0, gci: 0 }]));
  const groups = { all: 0, buyers: 0, listings: 0, leases: 0 };
  let volume = 0; let gci = 0; let net = 0; let weighted = 0;
  const atRisk = [];
  const closingSoon = [];
  let newDev = 0; let delivered = 0;
  for (const d of open) {
    const e = C.estimate(d, plan, cap.ytd);
    const n = e.estimatedNet != null ? e.estimatedNet : e.net;
    const ph = S.phaseOf(d.stage);
    if (d.track === 'new_dev' || ph === 'new_dev') {
      newDev += 1;
      if (d.stage === 'building_delivered') delivered += 1;
    } else {
      const b = byPhase[ph];
      if (b) { b.count += 1; b.volume += e.price; b.gci += e.myGci; }
      groups.all += 1;
      groups[S.sideInfo(d.side).group] += 1;
    }
    volume += e.price; gci += e.myGci; net += n; weighted += n * S.odds(d.stage);
    const l = d.listingId ? listings.get(d.listingId) : null;
    const t = S.timing(d, now, { listedAt: l && l.isOwnListing ? l.listedAt : null });
    const c = clients.get(d.clientId);
    const row = {
      id: d.id,
      clientId: d.clientId,
      name: N.clientName(c),
      rating: c ? c.rating : 0,
      whale: c ? (!!c.isWhale || (c.lifetimeVolume || 0) >= N.WHALE_VOLUME) : false,
      stage: d.stage,
      phase: ph,
      label: S.labelFor(d.stage, d.side).label,
      side: d.side,
      address: dealAddress(d, listings, properties),
      photo: dealPhoto(d, listings, properties),
      price: e.price,
      estNet: n,
      staleDays: t.staleDays,
      stageAge: t.stageAge,
      closing: t.closing,
    };
    if (t.stale) atRisk.push(row);
    if (ph === 'under_contract' && t.closing && t.closing.days <= 14) closingSoon.push(row);
  }
  atRisk.sort((a, b) => b.staleDays - a.staleDays);
  closingSoon.sort((a, b) => a.closing.days - b.closing.days);
  const monthAgg = emptyAgg();
  const est = walkClosings(cap.deals, plan, tz);
  for (const d of closedThisMonth) {
    const e = est.get(d.id) || C.estimate(d, plan, cap.ytd);
    addTo(monthAgg, e);
  }
  return {
    asOf: now.toISOString(),
    open: groups.all,
    volume: Math.round(volume),
    estGci: Math.round(gci),
    estNet: Math.round(net),
    weightedNet: Math.round(weighted),
    byPhase: S.PHASES.map((p) => ({ ...byPhase[p.id], volume: Math.round(byPhase[p.id].volume), gci: Math.round(byPhase[p.id].gci) })),
    groups,
    newDev: { count: newDev, delivered },
    atRisk: atRisk.slice(0, 8),
    atRiskCount: atRisk.length,
    closingSoon: closingSoon.slice(0, 8),
    month: roundAgg(monthAgg),
  };
}

// ── GET /api/book (closings ledger) ────────────────────────────────────────
async function bookLedger(workspaceId) {
  const px = await pricingContext(workspaceId);
  const closed = await prisma.deal.findMany({ where: { workspaceId, stage: 'closed' }, orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }] });
  const est = walkClosings(closed, px.plan, px.tz);
  const [clients, listings, properties] = await Promise.all([
    clientsById(workspaceId, closed.map((d) => d.clientId)),
    listingsById(workspaceId, closed.map((d) => d.listingId)),
    propertiesById(workspaceId, closed.map((d) => d.portfolioPropertyId)),
  ]);
  let volume = 0; let gci = 0;
  const closings = closed.map((d) => {
    const e = est.get(d.id) || C.estimate(d, px.plan, px.ytd);
    const c = clients.get(d.clientId);
    volume += e.volume; gci += e.myGci;
    return {
      dealId: d.id,
      clientId: d.clientId,
      name: N.clientName(c),
      firstName: c ? c.firstName : '',
      lastName: c ? c.lastName : '',
      avatarUrl: c ? c.avatarUrl : null,
      rating: c ? c.rating : 0,
      isWhale: c ? !!c.isWhale : false,
      phone: c ? c.phone : null,
      side: d.side,
      sideLabel: S.sideInfo(d.side).label,
      sideChip: S.sideInfo(d.side).chip,
      verb: S.familyOf(d.side) === 'listing' ? 'Sold' : d.side.startsWith('lease') ? 'Leased' : 'Bought',
      address: dealAddress(d, listings, properties),
      photo: dealPhoto(d, listings, properties),
      price: e.price,
      closedAt: (d.closedAt || d.updatedAt).toISOString(),
      dated: !!d.closedAt,
      gci: e.myGci,
      net: e.net,
      booked: e.booked,
      archived: !!d.archivedAt,
    };
  });
  return {
    closings,
    stats: {
      closings: closings.length,
      clients: new Set(closings.map((x) => x.clientId)).size,
      volume: Math.round(volume),
      gci: Math.round(gci),
    },
  };
}

// ── GET /api/book/clients (lifetime roll-up) ──────────────────────────────
const SORTS = {
  volume: (a, b) => b.lifetimeVolume - a.lifetimeVolume,
  gci: (a, b) => b.lifetimeGci - a.lifetimeGci,
  recent: (a, b) => String(b.lastClosedAt || '').localeCompare(String(a.lastClosedAt || '')),
  alpha: (a, b) => (a.lastName || a.name).localeCompare(b.lastName || b.name) || a.name.localeCompare(b.name),
  rating: (a, b) => b.rating - a.rating || b.lifetimeVolume - a.lifetimeVolume,
  transactions: (a, b) => b.transactions - a.transactions || b.lifetimeVolume - a.lifetimeVolume,
};

async function bookClients(workspaceId, { sort = 'volume', search = '', now = new Date() } = {}) {
  const px = await pricingContext(workspaceId, now);
  const closed = await prisma.deal.findMany({ where: { workspaceId, stage: 'closed' }, orderBy: { closedAt: 'desc' } });
  const est = walkClosings(closed, px.plan, px.tz);
  const dealClientIds = [...new Set(closed.map((d) => d.clientId))];
  const q = String(search || '').trim();
  const nameFilter = q ? {
    OR: [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } },
      { company: { contains: q, mode: 'insensitive' } },
    ],
  } : {};
  const clients = await prisma.client.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      AND: [
        { OR: [{ id: { in: dealClientIds } }, { transactionsCount: { gt: 0 } }, { lifetimeVolume: { gt: 0 } }] },
        nameFilter,
      ],
    },
    select: { ...N.CLIENT_SELECT, company: true, referredById: true },
  });
  const ids = clients.map((c) => c.id);
  const [referred, owned, listings, properties] = await Promise.all([
    prisma.client.findMany({ where: { workspaceId, referredById: { in: ids } }, select: { id: true, referredById: true, transactionsCount: true } }),
    prisma.portfolioProperty.findMany({ where: { workspaceId, clientId: { in: ids }, relationship: 'owns' }, select: { clientId: true, purchasedAt: true, street: true, unit: true, buildingName: true } }),
    listingsById(workspaceId, closed.map((d) => d.listingId)),
    propertiesById(workspaceId, closed.map((d) => d.portfolioPropertyId)),
  ]);
  const closedIds = new Set(dealClientIds);
  const referrerOf = new Map();
  for (const r of referred) {
    if ((r.transactionsCount || 0) > 0 || closedIds.has(r.id)) referrerOf.set(r.referredById, (referrerOf.get(r.referredById) || 0) + 1);
  }
  const ownedBy = new Map();
  for (const p of owned) {
    if (!ownedBy.has(p.clientId)) ownedBy.set(p.clientId, []);
    ownedBy.get(p.clientId).push(p);
  }
  const dealsBy = new Map();
  for (const d of closed) {
    if (!dealsBy.has(d.clientId)) dealsBy.set(d.clientId, []);
    dealsBy.get(d.clientId).push(d);
  }
  const today = partsIn(now, px.tz);
  const rows = clients.map((c) => {
    const ds = dealsBy.get(c.id) || [];
    let vol = 0; let gciSum = 0; let maxSide = 0; let last = null;
    for (const d of ds) {
      const e = est.get(d.id);
      const price = d.side === 'referral_out' || C.isLease(d.side) ? 0 : C.dealPrice(d);
      vol += price; gciSum += e ? e.myGci : 0; maxSide = Math.max(maxSide, price);
      if (d.closedAt && (!last || d.closedAt > last)) last = d.closedAt;
    }
    const lifetimeVolume = Math.max(c.lifetimeVolume || 0, Math.round(vol));
    const lifetimeGci = Math.max(c.lifetimeGci || 0, Math.round(gciSum));
    const transactions = Math.max(c.transactionsCount || 0, ds.length);
    const lastClosedAt = [c.lastClosedAt, last].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
    const props = ownedBy.get(c.id) || [];
    const anniversary = props.map((p) => {
      if (!p.purchasedAt) return null;
      const pp = partsIn(new Date(p.purchasedAt), px.tz);
      if (pp.year >= today.year) return null;
      let next = new Date(Date.UTC(today.year, pp.month - 1, pp.day));
      const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
      if (next.getTime() < todayUtc) next = new Date(Date.UTC(today.year + 1, pp.month - 1, pp.day));
      const days = Math.round((next.getTime() - todayUtc) / DAY);
      return days <= 30 ? { days, years: next.getUTCFullYear() - pp.year, address: N.propertyAddress(p) } : null;
    }).filter(Boolean).sort((a, b) => a.days - b.days)[0] || null;
    const badges = [];
    if (c.isWhale || lifetimeVolume >= N.WHALE_VOLUME || maxSide >= 5000000) badges.push('whale');
    if (transactions >= 2) badges.push('repeat');
    if (referrerOf.get(c.id)) badges.push('referrer');
    if ((c.rating || 0) >= 5) badges.push('vip');
    if (lastClosedAt && now - lastClosedAt <= 30 * DAY) badges.push('recent');
    if (props.length >= 2) badges.push('investor');
    if (anniversary) badges.push('anniversary');
    const latestDeal = ds[0];
    return {
      id: c.id,
      name: N.clientName(c),
      firstName: c.firstName,
      lastName: c.lastName,
      avatarUrl: c.avatarUrl,
      rating: c.rating || 0,
      isWhale: !!c.isWhale,
      company: c.company || null,
      phone: c.phone || null,
      lifetimeVolume,
      lifetimeGci,
      transactions,
      lastClosedAt: lastClosedAt ? lastClosedAt.toISOString() : null,
      ownedCount: props.length,
      referrals: referrerOf.get(c.id) || 0,
      anniversary,
      badges,
      latest: latestDeal ? {
        dealId: latestDeal.id,
        address: dealAddress(latestDeal, listings, properties),
        price: C.dealPrice(latestDeal),
        closedAt: latestDeal.closedAt ? latestDeal.closedAt.toISOString() : null,
        side: latestDeal.side,
      } : null,
    };
  });
  rows.sort(SORTS[sort] || SORTS.volume);
  const totalVolume = rows.reduce((s, r) => s + r.lifetimeVolume, 0);
  const totalTx = rows.reduce((s, r) => s + r.transactions, 0);
  return {
    clients: rows,
    total: rows.length,
    stats: {
      clients: rows.length,
      lifetimeVolume: totalVolume,
      lifetimeGci: rows.reduce((s, r) => s + r.lifetimeGci, 0),
      avgPrice: totalTx ? Math.round(totalVolume / totalTx) : 0,
      repeat: rows.filter((r) => r.transactions >= 2).length,
    },
  };
}

module.exports = { commissionsSummary, boardSummary, bookLedger, bookClients, walkClosings, monthKeyOf, monthLabelOf, addMonths };
