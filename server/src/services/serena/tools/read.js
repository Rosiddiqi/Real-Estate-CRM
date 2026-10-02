// Serena READ tools — every answer about the book comes from here (tools
// first, never invent). Each tool: { name, kind:'read', description,
// input_schema, activity(input, ctx) → status line, run(input, ctx) → JSON }.
const prisma = require('../../../lib/prisma');
const { dayKey, dayBounds, addDays, monthBounds, yearBounds } = require('../../../lib/dates');
const U = require('../util');
const T = require('../time');

const OPEN_STAGES_NOT = ['closed', 'lost'];

function stagesMod() { return U.optionalRequire('../pipeline/stages'); }
function stageLabel(stage, side) {
  const S = stagesMod();
  try { if (S && S.labelFor) return S.labelFor(stage, side || 'buyer').label; } catch { /* ignore */ }
  return U.titleCase(stage || '');
}
function stageOdds(stage) {
  const S = stagesMod();
  try { if (S && S.odds) return S.odds(stage); } catch { /* ignore */ }
  return { new_lead: 0, seller_lead: 0, consultation: 0.1, listing_appt: 0.1, touring: 0.2, active: 0.2, offer_submitted: 0.4, offer_received: 0.4, under_contract: 0.85, closed: 1 }[stage] ?? 0.1;
}
const dealPrice = (d) => d.salePrice || d.contractPrice || d.price || d.listPrice || null;
function dealGci(d) {
  if (d.grossCommission) return d.grossCommission;
  if (d.estimatedGci) return d.estimatedGci;
  const p = dealPrice(d);
  const rate = d.sideRate || (d.side === 'listing' ? d.listRate : d.buyRate) || (d.side === 'listing' ? 0.03 : 0.025);
  return p ? Math.round(p * rate * (d.splitShare || 1)) : null;
}
function dealOut(d, tz) {
  return {
    deal_id: d.id,
    client: d.client ? U.nameOf(d.client) : undefined,
    client_id: d.clientId,
    title: d.title || d.propertyLabel || d.propertyAddress || null,
    property: d.propertyAddress || d.propertyLabel || null,
    side: d.side,
    stage: d.stage,
    stage_label: stageLabel(d.stage, d.side),
    sub_status: d.subStatus || null,
    price: dealPrice(d),
    price_label: dealPrice(d) ? U.moneyCompact(dealPrice(d)) : null,
    est_gci: dealGci(d),
    days_in_stage: d.stageChangedAt ? U.daysBetween(d.stageChangedAt) : null,
    closing_date_local: d.closingDate ? U.fmtDate(d.closingDate, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : null,
    inspection_deadline_local: d.inspectionDeadline ? U.fmtDate(d.inspectionDeadline, tz) : null,
    appraisal_deadline_local: d.appraisalDeadline ? U.fmtDate(d.appraisalDeadline, tz) : null,
    financing_deadline_local: d.financingDeadline ? U.fmtDate(d.financingDeadline, tz) : null,
  };
}
function apptOut(a, tz) {
  return {
    appointment_id: a.id,
    title: a.title,
    type: a.type,
    status: a.status,
    when_local: U.fmtWhen(a.startAt, tz),
    start_local: U.fmtTime(a.startAt, tz),
    end_local: U.fmtTime(a.endAt, tz),
    duration_min: Math.round((new Date(a.endAt) - new Date(a.startAt)) / 60000),
    location: a.location || null,
    client: a.client ? U.nameOf(a.client) : null,
    client_id: a.clientId || null,
    listing_id: a.listingId || null,
    deal_id: a.dealId || null,
  };
}
function taskOut(t, tz) {
  return {
    task_id: t.id,
    title: t.title,
    status: t.status,
    kind: t.kind || null,
    priority: t.priority,
    due_local: t.dueAt ? U.fmtWhen(t.dueAt, tz) : t.dueDate ? U.fmtDayKey(t.dueDate, tz) : null,
    overdue: t.status === 'pending' && ((t.dueAt && new Date(t.dueAt) < new Date()) || (t.dueDate && t.dueDate < dayKey(new Date(), tz))),
    client: t.client ? U.nameOf(t.client) : null,
    client_id: t.clientId || null,
    open_for: t.createdAt ? U.relAgo(t.createdAt).replace(' ago', '') : null,
  };
}
function listingOut(l) {
  const baths = l.bathsTotal || (l.bathsFull != null ? l.bathsFull + (l.bathsHalf ? l.bathsHalf * 0.5 : 0) : null);
  return {
    listing_id: l.id,
    address: U.addressOf(l),
    neighborhood: l.neighborhood || null,
    city: l.city || null,
    status: l.status,
    origin: l.origin,
    own_listing: !!l.isOwnListing,
    price: l.listPrice || null,
    price_label: l.listPrice ? U.moneyCompact(l.listPrice) : (l.priceGuide ? `guide ~${U.moneyCompact(l.priceGuide)} (whisper, never quote)` : null),
    beds: l.beds, baths, sqft: l.livingAreaSqft || null,
    property_type: l.propertyType || null,
    waterfront: l.waterfront || null,
    views: l.views || [],
    price_dropped: l.priceDroppedAt ? { from: l.previousPrice, at: l.priceDroppedAt } : null,
    days_on_market: l.listedAt ? U.daysBetween(l.listedAt) : null,
    mls: l.mlsNumber || null,
  };
}
function searchOut(s) {
  return {
    search_id: s.id,
    name: s.name || null,
    bucket: s.bucket,
    status: s.status,
    markets: s.markets, neighborhoods: s.neighborhoods, property_types: s.propertyTypes,
    price: [s.priceMin ? U.moneyCompact(s.priceMin) : null, s.priceMax ? U.moneyCompact(s.priceMax) : null].filter(Boolean).join('–') || null,
    beds_min: s.bedsMin, baths_min: s.bathsMin, sqft_min: s.sqftMin,
    waterfront: s.waterfront, views: s.views,
    must_haves: Array.isArray(s.mustHaves) ? s.mustHaves.map((m) => (typeof m === 'string' ? m : m.feature)).filter(Boolean) : [],
    timeline: s.timeline, financing: s.financing,
  };
}
function propertyOut(p, tz) {
  return {
    property_id: p.id,
    relationship: p.relationship,
    address: U.addressOf(p) || p.nickname,
    neighborhood: p.neighborhood, city: p.city,
    property_type: p.propertyType,
    beds: p.beds, baths: p.baths, sqft: p.sqft,
    est_value: p.estValue ? U.moneyCompact(p.estValue) : null,
    purchase: p.purchasePrice ? `${U.moneyCompact(p.purchasePrice)}${p.purchasedAt ? ` in ${new Date(p.purchasedAt).getUTCFullYear()}` : ''}` : null,
    loan: p.loanType ? `${p.loanType}${p.mortgageRate ? ` @ ${(p.mortgageRate * (p.mortgageRate < 1 ? 100 : 1)).toFixed(2)}%` : ''}${p.loanResetAt ? `, resets ${U.fmtDate(p.loanResetAt, tz, { month: 'short', year: 'numeric' })}` : ''}` : null,
    lease_ends: p.leaseEndsAt ? U.fmtDate(p.leaseEndsAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }) : null,
    thinking_of_selling: !!p.thinkingOfSelling,
    waterfront: p.waterfront || null,
  };
}

// ── tools ──────────────────────────────────────────────────────────────────
const tools = [];
const def = (t) => tools.push({ kind: 'read', ...t });

def({
  name: 'search_clients',
  description: 'Search the agent\'s book of clients (and partners/vendors) by name, phone, email, or attributes. Multi-word names must match every word. Use BEFORE any client action to resolve the right person and their id. Filters: status, type, min rating, whales, has_active_deal, neighborhood/city, and portfolio filters (owned_city, owned_neighborhood, owned_property_type, waterfront_owner, owned_value_min) for seller prospecting.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name, phone, email or company. Optional when filtering.' },
      kind: { type: 'string', enum: ['client', 'partner', 'vendor'] },
      status: { type: 'string', enum: ['lead', 'active', 'past_client', 'sphere', 'inactive'] },
      type: { type: 'string', enum: ['buyer', 'seller', 'buyer_seller', 'investor', 'renter', 'landlord', 'developer', 'sphere'] },
      min_rating: { type: 'integer', description: '0-5 stars' },
      whales_only: { type: 'boolean' },
      has_active_deal: { type: 'boolean' },
      neighborhood: { type: 'string' },
      owned_city: { type: 'string' },
      owned_neighborhood: { type: 'string' },
      owned_property_type: { type: 'string' },
      waterfront_owner: { type: 'boolean' },
      owned_value_min: { type: 'integer' },
      silent_days_min: { type: 'integer', description: 'Only clients not contacted for at least this many days' },
      limit: { type: 'integer' },
    },
  },
  activity: (i) => (i.query ? `Searching your book for “${U.clip(i.query, 40)}”…` : 'Searching your book…'),
  async run(input, ctx) {
    const { workspaceId } = ctx;
    const take = Math.min(25, input.limit || 12);
    const where = { workspaceId, archivedAt: null };
    const and = [];
    if (input.kind) where.contactKind = input.kind;
    if (input.status) where.status = input.status;
    if (input.type) where.type = input.type;
    if (input.min_rating) where.rating = { gte: input.min_rating };
    if (input.whales_only) where.isWhale = true;
    if (input.neighborhood) and.push({ OR: [{ neighborhood: { contains: input.neighborhood, mode: 'insensitive' } }, { city: { contains: input.neighborhood, mode: 'insensitive' } }] });
    if (input.has_active_deal) where.deals = { some: { archivedAt: null, stage: { notIn: OPEN_STAGES_NOT } } };
    if (input.silent_days_min) and.push({ OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(Date.now() - input.silent_days_min * 864e5) } }] });
    const prop = {};
    if (input.owned_city) prop.city = { contains: input.owned_city, mode: 'insensitive' };
    if (input.owned_neighborhood) prop.neighborhood = { contains: input.owned_neighborhood, mode: 'insensitive' };
    if (input.owned_property_type) prop.propertyType = { contains: input.owned_property_type, mode: 'insensitive' };
    if (input.waterfront_owner) prop.waterfront = { not: null };
    if (input.owned_value_min) prop.estValue = { gte: input.owned_value_min };
    if (Object.keys(prop).length) where.properties = { some: { relationship: { in: ['owns', 'leased_out'] }, ...prop } };
    let rows;
    if (input.query) {
      const hits = await U.searchClientsByName(workspaceId, input.query, { take: 40, kind: input.kind });
      const ids = hits.map((h) => h.id);
      if (!ids.length) return { count: 0, clients: [], note: `No one matching "${input.query}".` };
      rows = await prisma.client.findMany({ where: { ...where, id: { in: ids }, ...(and.length ? { AND: and } : {}) }, include: { deals: { where: { archivedAt: null, stage: { notIn: OPEN_STAGES_NOT } }, select: { id: true, stage: true, side: true, price: true, title: true } }, properties: { where: { relationship: 'owns' }, select: { street: true, neighborhood: true, city: true, estValue: true }, take: 3 } }, take });
    } else {
      rows = await prisma.client.findMany({
        where: { ...where, ...(and.length ? { AND: and } : {}) },
        include: { deals: { where: { archivedAt: null, stage: { notIn: OPEN_STAGES_NOT } }, select: { id: true, stage: true, side: true, price: true, title: true } }, properties: { where: { relationship: 'owns' }, select: { street: true, neighborhood: true, city: true, estValue: true }, take: 3 } },
        orderBy: [{ isWhale: 'desc' }, { rating: 'desc' }, { lastContactedAt: 'desc' }],
        take,
      });
    }
    for (const c of rows) ctx.names.set(c.id, U.nameOf(c));
    return {
      count: rows.length,
      clients: rows.map((c) => ({
        client_id: c.id,
        name: U.nameOf(c),
        kind: c.contactKind,
        type: c.type,
        status: c.status,
        rating: c.rating,
        whale: c.isWhale,
        phone: c.phone ? U.formatPhone(c.phone) : null,
        email: c.email || null,
        neighborhood: c.neighborhood || c.city || null,
        last_contacted: c.lastContactedAt ? U.relAgo(c.lastContactedAt) : 'never',
        active_deals: c.deals.map((d) => ({ deal_id: d.id, stage: stageLabel(d.stage, d.side), price: d.price ? U.moneyCompact(d.price) : null, title: d.title })),
        owns: c.properties.map((p) => [U.addressOf(p), p.neighborhood || p.city, p.estValue ? U.moneyCompact(p.estValue) : null].filter(Boolean).join(' · ')),
      })),
    };
  },
});

def({
  name: 'get_client',
  description: 'Full client file: contact info, rating/whale/status, financing + timeline, personal touch points the agent recorded, property portfolio (owned/rented/sold), buyer searches (wishlist criteria), deals, upcoming appointments, open to-dos, latest notes, recent texts and calls. Use before acting on a client or answering about them.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, client_name: { type: 'string', description: 'Use when you do not have the id yet' } } },
  activity: (i, ctx) => `Pulling up ${ctx.names.get(i.client_id) || i.client_name || 'the client'}’s file…`,
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const lite = await U.resolveClient(workspaceId, input);
    const c = await prisma.client.findFirst({
      where: { id: lite.id, workspaceId },
      include: {
        properties: { orderBy: { createdAt: 'desc' }, take: 12 },
        searches: { where: { status: { not: 'found' } }, orderBy: { createdAt: 'desc' }, take: 6 },
        deals: { where: { archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 8 },
      },
    });
    const now = new Date();
    const [appts, tasks, notes, messages, calls] = await Promise.all([
      prisma.appointment.findMany({ where: { workspaceId, clientId: c.id, startAt: { gte: new Date(now - 864e5) }, status: { not: 'cancelled' } }, orderBy: { startAt: 'asc' }, take: 5 }),
      prisma.task.findMany({ where: { workspaceId, clientId: c.id, status: 'pending' }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 6 }),
      prisma.note.findMany({ where: { workspaceId, clientId: c.id }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 4 }),
      prisma.message.findMany({ where: { workspaceId, clientId: c.id }, orderBy: { sentAt: 'desc' }, take: 10, select: { body: true, isFromMe: true, sentAt: true, service: true } }),
      prisma.phoneCall.findMany({ where: { workspaceId, clientId: c.id }, orderBy: { startedAt: 'desc' }, take: 3 }),
    ]);
    ctx.names.set(c.id, U.nameOf(c));
    const personal = c.personal && typeof c.personal === 'object' ? c.personal : {};
    return {
      client_id: c.id,
      name: U.nameOf(c),
      kind: c.contactKind, vendor_role: c.vendorRole || null,
      type: c.type, status: c.status, rating: c.rating, whale: c.isWhale,
      phone: c.phone ? U.formatPhone(c.phone) : null, email: c.email || null,
      company: c.company || null, job_title: c.jobTitle || null,
      home_area: [...new Set([c.neighborhood, c.city].filter(Boolean))].join(', ') || null,
      birthday: c.birthday || null,
      lead_source: c.leadSource || null,
      tags: c.tags,
      financing: c.financing || null,
      pre_approval: c.preApprovalAmount ? U.moneyCompact(c.preApprovalAmount) : null,
      lender: c.lenderName || null,
      timeline: c.timeline || null,
      motivation: c.motivation || null,
      lifetime_volume: c.lifetimeVolume ? U.moneyCompact(c.lifetimeVolume) : null,
      closings_with_agent: c.transactionsCount || 0,
      text_opt_out: c.textOptOut,
      personal_touch_points: personal,
      notes_field: c.notes ? U.clip(c.notes, 600) : null,
      ai_summary: c.aiSummary ? U.clip(c.aiSummary, 900) : null,
      last_contacted: c.lastContactedAt ? U.relAgo(c.lastContactedAt) : 'never',
      portfolio: c.properties.map((p) => propertyOut(p, tz)),
      buyer_searches: c.searches.map(searchOut),
      deals: c.deals.map((d) => dealOut(d, tz)),
      upcoming_appointments: appts.map((a) => apptOut(a, tz)),
      open_todos: tasks.map((t) => taskOut(t, tz)),
      recent_notes: notes.map((n) => ({ when: U.relAgo(n.createdAt), text: U.clip(n.body, 300) })),
      recent_texts: messages.reverse().map((m) => ({ from: m.isFromMe ? 'agent' : 'client', when: U.relAgo(m.sentAt), text: U.clip(m.body, 220) })),
      recent_calls: calls.map((k) => ({ direction: k.direction, status: k.status, when: U.relAgo(k.startedAt), duration_sec: k.durationSec, summary: k.summary ? U.clip(k.summary, 240) : null })),
    };
  },
});

def({
  name: 'list_deals',
  description: 'List deals in the pipeline. Filter by stage key (buyer: new_lead, consultation, touring, offer_submitted, under_contract, closed; listing: seller_lead, listing_appt, active, offer_received, under_contract, closed; lost), side, client, open only (default true).',
  input_schema: { type: 'object', properties: { stage: { type: 'string' }, side: { type: 'string' }, client_id: { type: 'string' }, open_only: { type: 'boolean' }, closing_within_days: { type: 'integer' }, limit: { type: 'integer' } } },
  activity: (i, ctx) => (i.client_id ? `Looking up ${ctx.names.get(i.client_id) || 'their'}${ctx.names.get(i.client_id) ? '’s' : ''} deals…` : 'Checking your pipeline…'),
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const where = { workspaceId, archivedAt: null };
    if (input.stage) where.stage = input.stage;
    else if (input.open_only !== false) where.stage = { notIn: OPEN_STAGES_NOT };
    if (input.side) where.side = input.side;
    if (input.client_id) where.clientId = input.client_id;
    if (input.closing_within_days) where.closingDate = { gte: new Date(Date.now() - 864e5), lte: new Date(Date.now() + input.closing_within_days * 864e5) };
    const deals = await prisma.deal.findMany({ where, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ stageChangedAt: 'desc' }], take: Math.min(40, input.limit || 25) });
    for (const d of deals) if (d.client) ctx.names.set(d.clientId, U.nameOf(d.client));
    return { count: deals.length, deals: deals.map((d) => dealOut(d, tz)) };
  },
});

def({
  name: 'pipeline_summary',
  description: 'Pipeline snapshot: open deals per stage (count, volume, est. GCI), weighted forecast, deals closing in the next 30 days, and stale deals.',
  input_schema: { type: 'object', properties: {} },
  activity: () => 'Totting up your pipeline…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const deals = await prisma.deal.findMany({ where: { workspaceId, archivedAt: null, stage: { notIn: OPEN_STAGES_NOT } }, include: { client: { select: U.CLIENT_LITE } } });
    const by = new Map();
    let volume = 0; let gci = 0; let weighted = 0;
    for (const d of deals) {
      const label = stageLabel(d.stage, d.side);
      const k = `${d.stage}`;
      const row = by.get(k) || { stage: d.stage, label, count: 0, volume: 0, est_gci: 0 };
      const p = dealPrice(d) || 0;
      const g = dealGci(d) || 0;
      row.count += 1; row.volume += p; row.est_gci += g;
      by.set(k, row);
      volume += p; gci += g; weighted += g * stageOdds(d.stage);
    }
    const order = ['new_lead', 'seller_lead', 'consultation', 'listing_appt', 'touring', 'active', 'offer_submitted', 'offer_received', 'under_contract'];
    const stages = [...by.values()].sort((a, b) => (order.indexOf(a.stage) + 99 * (order.indexOf(a.stage) < 0)) - (order.indexOf(b.stage) + 99 * (order.indexOf(b.stage) < 0)));
    const soon = deals.filter((d) => d.closingDate && new Date(d.closingDate) - Date.now() < 30 * 864e5 && new Date(d.closingDate) > Date.now() - 864e5)
      .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate)).slice(0, 6);
    const stale = deals.filter((d) => d.stageChangedAt && U.daysBetween(d.stageChangedAt) > 21 && d.stage !== 'under_contract').slice(0, 6);
    return {
      open_deals: deals.length,
      volume: U.moneyCompact(volume),
      est_gci: U.moneyCompact(gci),
      weighted_gci: U.moneyCompact(weighted),
      stages: stages.map((s) => ({ ...s, volume: U.moneyCompact(s.volume), est_gci: U.moneyCompact(s.est_gci) })),
      closing_next_30_days: soon.map((d) => dealOut(d, tz)),
      stale_deals: stale.map((d) => ({ ...dealOut(d, tz) })),
    };
  },
});

def({
  name: 'commission_summary',
  description: 'GCI / commission numbers: closed sides, volume, GCI and net for month-to-date, year-to-date and last month, plus the projected (weighted) pipeline GCI.',
  input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['mtd', 'ytd', 'last_month', 'all'] } } },
  activity: () => 'Running your commission numbers…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const now = new Date();
    const mb = monthBounds(now, tz);
    const yb = yearBounds(now, tz);
    const lastMonthStart = monthBounds(new Date(mb.start.getTime() - 864e5), tz);
    const closed = await prisma.deal.findMany({ where: { workspaceId, stage: 'closed', closedAt: { gte: lastMonthStart.start < yb.start ? lastMonthStart.start : yb.start } } });
    const sum = (rows) => rows.reduce((acc, d) => {
      const p = dealPrice(d) || 0;
      const g = dealGci(d) || 0;
      const n = d.commission || d.estimatedNet || Math.round(g * 0.8);
      const sides = d.side === 'dual' ? 2 : d.side === 'referral_out' ? 0 : 1;
      return { sides: acc.sides + sides * (d.splitShare || 1), volume: acc.volume + p, gci: acc.gci + g, net: acc.net + n };
    }, { sides: 0, volume: 0, gci: 0, net: 0 });
    const fmt = (o) => ({ sides: Math.round(o.sides * 10) / 10, volume: U.moneyCompact(o.volume), gci: U.moneyCompact(o.gci), net: U.moneyCompact(o.net) });
    const inRange = (d, a, b) => d.closedAt && d.closedAt >= a && d.closedAt < b;
    const mtd = sum(closed.filter((d) => inRange(d, mb.start, mb.end)));
    const ytd = sum(closed.filter((d) => inRange(d, yb.start, yb.end)));
    const last = sum(closed.filter((d) => inRange(d, lastMonthStart.start, lastMonthStart.end)));
    const open = await prisma.deal.findMany({ where: { workspaceId, archivedAt: null, stage: { notIn: OPEN_STAGES_NOT } } });
    const weighted = open.reduce((a, d) => a + (dealGci(d) || 0) * stageOdds(d.stage), 0);
    const plan = await prisma.payPlan.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    const goals = plan && plan.goals ? plan.goals : null;
    return {
      mtd: fmt(mtd), ytd: fmt(ytd), last_month: fmt(last),
      projected_weighted_gci: U.moneyCompact(weighted),
      annual_gci_goal: goals && goals.annualGci ? U.moneyCompact(goals.annualGci) : null,
      ytd_pct_of_goal: goals && goals.annualGci ? Math.round((ytd.gci / goals.annualGci) * 100) : null,
      note: 'GCI = price × side rate × split share; net is booked commission when typed at close, else an estimate.',
    };
  },
});

def({
  name: 'todays_schedule',
  description: 'The agent\'s day: appointments (showings, consults, closings…) in order with local times, to-dos due that day, and overdue to-dos. Default = today; pass date ("tomorrow", "friday", YYYY-MM-DD) for another day.',
  input_schema: { type: 'object', properties: { date: { type: 'string' } } },
  activity: (i, ctx) => {
    const day = T.parseDay(i.date, ctx.tz);
    if (!day || day === dayKey(new Date(), ctx.tz)) return 'Checking your day…';
    return `Checking your calendar for ${U.fmtDayKey(day, ctx.tz).replace(/^Tomorrow$/, 'tomorrow')}…`;
  },
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const day = T.parseDay(input.date, tz) || dayKey(new Date(), tz);
    const { start, end } = dayBounds(day, tz);
    const [appts, due, overdue] = await Promise.all([
      prisma.appointment.findMany({ where: { workspaceId, startAt: { gte: start, lt: end }, status: { not: 'cancelled' } }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { startAt: 'asc' } }),
      prisma.task.findMany({ where: { workspaceId, status: 'pending', OR: [{ dueDate: day }, { dueAt: { gte: start, lt: end } }] }, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }], take: 20 }),
      day === dayKey(new Date(), tz)
        ? prisma.task.findMany({ where: { workspaceId, status: 'pending', OR: [{ dueDate: { lt: day } }, { dueAt: { lt: start } }] }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { dueAt: 'asc' }, take: 10 })
        : [],
    ]);
    for (const a of appts) if (a.client) ctx.names.set(a.clientId, U.nameOf(a.client));
    return {
      date: day,
      date_label: U.fmtDayKey(day, tz),
      appointments: appts.map((a) => apptOut(a, tz)),
      todos_due: due.map((t) => taskOut(t, tz)),
      overdue_todos: overdue.map((t) => taskOut(t, tz)),
    };
  },
});

def({
  name: 'list_appointments',
  description: 'Appointments in a date range (default next 7 days), optionally for one client. Use to find an appointment id before rescheduling or cancelling.',
  input_schema: { type: 'object', properties: { from: { type: 'string', description: 'today / tomorrow / YYYY-MM-DD' }, to: { type: 'string' }, client_id: { type: 'string' }, include_cancelled: { type: 'boolean' }, limit: { type: 'integer' } } },
  activity: (i, ctx) => (i.client_id ? `Checking ${ctx.names.get(i.client_id) || 'their'}${ctx.names.get(i.client_id) ? '’s' : ''} appointments…` : 'Checking your calendar…'),
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const fromDay = T.parseDay(input.from, tz) || dayKey(new Date(), tz);
    const toDay = T.parseDay(input.to, tz) || addDays(fromDay, 7);
    const where = { workspaceId, startAt: { gte: dayBounds(fromDay, tz).start, lt: dayBounds(toDay, tz).end } };
    if (input.client_id) { where.clientId = input.client_id; where.startAt.gte = new Date(Date.now() - 30 * 864e5); }
    if (!input.include_cancelled) where.status = { not: 'cancelled' };
    const appts = await prisma.appointment.findMany({ where, include: { client: { select: U.CLIENT_LITE } }, orderBy: { startAt: 'asc' }, take: Math.min(40, input.limit || 25) });
    return { count: appts.length, appointments: appts.map((a) => apptOut(a, tz)) };
  },
});

def({
  name: 'list_tasks',
  description: 'The agent\'s to-dos (open by default), optionally for one client. Use to find a task id before completing it.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, include_done: { type: 'boolean' }, query: { type: 'string', description: 'Filter by words in the title' }, limit: { type: 'integer' } } },
  activity: () => 'Checking your to-dos…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const where = { workspaceId, status: input.include_done ? { in: ['pending', 'done'] } : 'pending' };
    if (input.client_id) where.clientId = input.client_id;
    if (input.query) where.title = { contains: input.query, mode: 'insensitive' };
    const tasks = await prisma.task.findMany({ where, include: { client: { select: U.CLIENT_LITE } }, orderBy: [{ status: 'asc' }, { priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }], take: Math.min(40, input.limit || 20) });
    return { count: tasks.length, tasks: tasks.map((t) => taskOut(t, tz)) };
  },
});

def({
  name: 'unread_conversations',
  description: 'Unread text threads (client sent something the agent has not read), newest first, with the latest message preview.',
  input_schema: { type: 'object', properties: { limit: { type: 'integer' } } },
  activity: () => 'Checking your unread texts…',
  async run(input, ctx) {
    const { workspaceId } = ctx;
    const rows = await prisma.conversation.findMany({ where: { workspaceId, unreadCount: { gt: 0 }, archived: false, blocked: false, lane: 'active' }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { lastMessageAt: 'desc' }, take: Math.min(20, input.limit || 10) });
    for (const r of rows) if (r.client) ctx.names.set(r.clientId, U.nameOf(r.client));
    return {
      count: rows.length,
      threads: rows.map((r) => ({
        conversation_id: r.id,
        client_id: r.clientId,
        name: r.client ? U.nameOf(r.client) : (r.displayName || r.groupName || U.formatPhone(r.handle)),
        unread: r.unreadCount,
        channel: r.channel,
        last_message: U.clip(r.lastMessagePreview, 200),
        when: U.relAgo(r.lastMessageAt),
        is_group: r.isGroup,
      })),
    };
  },
});

def({
  name: 'get_conversation',
  description: 'Recent text messages with a client (by client_id or conversation_id), oldest→newest. Use to understand context before drafting a reply.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, conversation_id: { type: 'string' }, limit: { type: 'integer' } } },
  activity: (i, ctx) => `Reading your thread with ${ctx.names.get(i.client_id) || 'them'}…`,
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    let convo = null;
    if (input.conversation_id) convo = await prisma.conversation.findFirst({ where: { id: input.conversation_id, workspaceId }, include: { client: { select: U.CLIENT_LITE } } });
    else if (input.client_id) convo = await prisma.conversation.findFirst({ where: { workspaceId, clientId: input.client_id }, include: { client: { select: U.CLIENT_LITE } }, orderBy: { lastMessageAt: 'desc' } });
    if (!convo) return { messages: [], note: 'No text thread with this client yet.' };
    const msgs = await prisma.message.findMany({ where: { conversationId: convo.id }, orderBy: { sentAt: 'desc' }, take: Math.min(40, input.limit || 15) });
    return {
      conversation_id: convo.id,
      client: convo.client ? U.nameOf(convo.client) : convo.displayName,
      channel: convo.channel,
      messages: msgs.reverse().map((m) => ({ from: m.isFromMe ? 'agent' : 'client', when_local: U.fmtWhen(m.sentAt, tz), text: U.clip(m.body, 400), status: m.status })),
    };
  },
});

def({
  name: 'find_listings',
  description: 'Search listings (own, MLS feed, pocket/coming-soon, whispers, new development) by text (address, building, neighborhood, MLS #) and filters. Whisper price guides are never quoted to clients.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' }, city: { type: 'string' }, neighborhood: { type: 'string' },
      min_price: { type: 'integer' }, max_price: { type: 'integer' }, beds_min: { type: 'integer' }, baths_min: { type: 'number' },
      property_type: { type: 'string' }, waterfront: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'coming_soon', 'under_contract', 'pending', 'sold', 'off_market', 'any'] },
      own_only: { type: 'boolean' }, price_drops_only: { type: 'boolean' }, limit: { type: 'integer' },
    },
  },
  activity: (i) => (i.query ? `Looking for “${U.clip(i.query, 40)}” in listings…` : 'Searching listings…'),
  async run(input, ctx) {
    const { workspaceId } = ctx;
    const where = { workspaceId, droppedAt: null };
    const and = [];
    if (!input.status) where.status = { in: ['active', 'coming_soon', 'off_market'] };
    else if (input.status !== 'any') where.status = input.status;
    if (input.query) {
      const q = input.query.trim();
      const words = q.split(/\s+/).filter(Boolean);
      and.push({ AND: words.map((w) => ({ OR: ['street', 'neighborhood', 'buildingName', 'city', 'title', 'mlsNumber', 'developmentName', 'headline'].map((f) => ({ [f]: { contains: w, mode: 'insensitive' } })) })) });
    }
    if (input.city) where.city = { contains: input.city, mode: 'insensitive' };
    if (input.neighborhood) and.push({ OR: [{ neighborhood: { contains: input.neighborhood, mode: 'insensitive' } }, { city: { contains: input.neighborhood, mode: 'insensitive' } }] });
    if (input.min_price || input.max_price) where.listPrice = { ...(input.min_price ? { gte: input.min_price } : {}), ...(input.max_price ? { lte: input.max_price } : {}) };
    if (input.beds_min) where.beds = { gte: input.beds_min };
    if (input.baths_min) where.bathsTotal = { gte: input.baths_min };
    if (input.property_type) where.propertyType = { contains: input.property_type, mode: 'insensitive' };
    if (input.waterfront) where.waterfront = { not: null };
    if (input.own_only) where.isOwnListing = true;
    if (input.price_drops_only) where.priceDroppedAt = { not: null };
    const rows = await prisma.listing.findMany({ where: { ...where, ...(and.length ? { AND: and } : {}) }, orderBy: [{ listPrice: 'desc' }], take: Math.min(25, input.limit || 10) });
    return { count: rows.length, listings: rows.map(listingOut) };
  },
});

def({
  name: 'matches_for_client',
  description: 'Best listing matches for a client\'s buyer searches (scored 0-100 by the matchmaker; 80+ is a real match, 90+ is hot).',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, min_score: { type: 'integer' }, limit: { type: 'integer' } }, required: ['client_id'] },
  activity: (i, ctx) => `Matching listings to ${ctx.names.get(i.client_id) || 'their'}${ctx.names.get(i.client_id) ? '’s' : ''} search…`,
  async run(input, ctx) {
    const { workspaceId } = ctx;
    const min = input.min_score ?? 70;
    let rows = await prisma.match.findMany({ where: { workspaceId, clientId: input.client_id, score: { gte: min }, status: { not: 'dismissed' }, listingId: { not: null } }, include: { listing: true }, orderBy: { score: 'desc' }, take: Math.min(15, input.limit || 6) });
    if (rows.length) return { count: rows.length, matches: rows.map((m) => ({ match_id: m.id, score: m.score, summary: m.summary, status: m.status, listing: m.listing ? listingOut(m.listing) : null })) };
    // Score live when the matchmaker hasn't persisted rows yet.
    const scorer = U.fnFrom(U.optionalRequire('../matchmaker/score'), 'scoreListingForSearch');
    const searches = await prisma.buyerSearch.findMany({ where: { workspaceId, clientId: input.client_id, status: 'active' } });
    if (!scorer || !searches.length) return { count: 0, matches: [], note: searches.length ? 'No scored matches yet.' : 'This client has no active buyer search.' };
    const listings = await prisma.listing.findMany({ where: { workspaceId, droppedAt: null, status: { in: ['active', 'coming_soon', 'off_market'] } }, take: 400 });
    const scored = [];
    for (const s of searches) {
      for (const l of listings) {
        try {
          const r = scorer(l, s, {});
          if (r && !r.gated && r.score >= min) scored.push({ score: Math.round(r.score), summary: r.summary || null, listing: l });
        } catch { /* skip bad rows */ }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const top = scored.filter((x) => (seen.has(x.listing.id) ? false : seen.add(x.listing.id))).slice(0, Math.min(15, input.limit || 6));
    return { count: top.length, matches: top.map((m) => ({ score: m.score, summary: m.summary, listing: listingOut(m.listing) })) };
  },
});

def({
  name: 'hottest_matches',
  description: 'The hottest buyer↔listing matches across the whole book (default 90+), newest first — who to send what.',
  input_schema: { type: 'object', properties: { min_score: { type: 'integer' }, since_days: { type: 'integer' }, limit: { type: 'integer' } } },
  activity: () => 'Checking the matchmaker for hot matches…',
  async run(input, ctx) {
    const { workspaceId } = ctx;
    const min = input.min_score ?? 88;
    const since = input.since_days ? new Date(Date.now() - input.since_days * 864e5) : undefined;
    const rows = await prisma.match.findMany({
      where: { workspaceId, score: { gte: min }, status: { in: ['new', 'seen', 'interested'] }, ...(since ? { createdAt: { gte: since } } : {}) },
      include: { client: { select: U.CLIENT_LITE }, listing: true },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(20, input.limit || 8),
    });
    for (const m of rows) if (m.client) ctx.names.set(m.clientId, U.nameOf(m.client));
    return {
      count: rows.length,
      matches: rows.map((m) => ({ match_id: m.id, score: m.score, kind: m.kind, status: m.status, client: m.client ? U.nameOf(m.client) : null, client_id: m.clientId, summary: m.summary, listing: m.listing ? listingOut(m.listing) : null })),
    };
  },
});

def({
  name: 'client_signals',
  description: 'Relationship moments: birthdays, home-purchase anniversaries, ARM resets / loan maturities, renter lease expiries, equity milestones, and clients gone silent. Great for "who should I reach out to".',
  input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['all', 'birthdays', 'anniversaries', 'arm_resets', 'lease_expiries', 'equity', 'silent'] }, kinds: { type: 'array', items: { type: 'string' } }, within_days: { type: 'integer' }, limit: { type: 'integer' } } },
  activity: () => 'Scanning for birthdays, anniversaries and loan resets…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const within = input.within_days || 30;
    const kinds = (input.kinds && input.kinds.length ? input.kinds : [input.kind || 'all']).filter(Boolean);
    const want = (k) => kinds.includes('all') || kinds.includes(k);
    const limit = Math.min(40, input.limit || 20);
    // The clients builder's signal engine is the source of truth.
    const S = U.optionalRequire('../clients/signals');
    if (S && typeof S.allSignals === 'function') {
      const jobs = [];
      if (want('birthdays')) jobs.push(S.upcomingBirthdays({ workspaceId, days: Math.max(within, 14) }));
      if (want('anniversaries')) jobs.push(S.upcomingAnniversaries({ workspaceId, days: Math.max(within, 30) }));
      if (want('arm_resets')) jobs.push(S.armResets({ workspaceId, days: Math.max(within, 180) }));
      if (want('lease_expiries')) jobs.push(S.leaseExpiries({ workspaceId, days: Math.max(within, 120) }));
      if (want('equity')) jobs.push(S.equityMilestones({ workspaceId }));
      if (kinds.includes('silent')) jobs.push(S.silentClients({ workspaceId, days: 30, limit: 15 }));
      const rows = (await Promise.all(jobs.map((j) => j.catch(() => [])))).flat();
      rows.sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || (b.urgency || 0) - (a.urgency || 0));
      const out = rows.slice(0, limit).map((r) => ({
        kind: r.kind, in_days: r.days ?? null, client: (r.client && (r.client.name || U.nameOf(r.client))) || null, client_id: r.clientId,
        detail: [r.title, r.sub].filter(Boolean).join(' · '),
      }));
      for (const s of out) if (s.client_id) ctx.names.set(s.client_id, s.client);
      return { count: out.length, signals: out };
    }
    const today = dayKey(new Date(), tz);
    const [ty, tm, td] = today.split('-').map(Number);
    const todayUtc = Date.UTC(ty, tm - 1, td);
    const daysUntilMD = (m, d) => {
      let t = Date.UTC(ty, m - 1, d);
      if (t < todayUtc) t = Date.UTC(ty + 1, m - 1, d);
      return Math.round((t - todayUtc) / 864e5);
    };
    const out = [];
    if (want('birthdays')) {
      const rows = await prisma.client.findMany({ where: { workspaceId, archivedAt: null, birthday: { not: null } }, select: { ...U.CLIENT_LITE, birthday: true } });
      for (const c of rows) {
        const m = /(\d{1,2})-(\d{1,2})$/.exec(c.birthday || '');
        if (!m) continue;
        const n = daysUntilMD(Number(m[1]), Number(m[2]));
        if (n <= within) out.push({ kind: 'birthday', in_days: n, client: U.nameOf(c), client_id: c.id, detail: n === 0 ? 'Birthday today' : `Birthday in ${n} days` });
      }
    }
    const props = await prisma.portfolioProperty.findMany({ where: { workspaceId }, include: { client: { select: U.CLIENT_LITE } } });
    for (const p of props) {
      if (!p.client) continue;
      const who = { client: U.nameOf(p.client), client_id: p.clientId, property: U.addressOf(p) || p.nickname };
      if (want('anniversaries') && p.purchasedAt && p.relationship === 'owns') {
        const d = new Date(p.purchasedAt);
        const n = daysUntilMD(d.getUTCMonth() + 1, d.getUTCDate());
        const years = ty - d.getUTCFullYear() + (Date.UTC(ty, d.getUTCMonth(), d.getUTCDate()) < todayUtc ? 1 : 0);
        if (n <= within && years > 0) out.push({ kind: 'home_anniversary', in_days: n, ...who, detail: `${years} year${years === 1 ? '' : 's'} at ${who.property}` });
      }
      if (want('arm_resets') && p.loanResetAt) {
        const n = Math.round((new Date(p.loanResetAt) - Date.now()) / 864e5);
        if (n >= 0 && n <= Math.max(within, 180)) out.push({ kind: 'arm_reset', in_days: n, ...who, detail: `ARM resets ${U.fmtDate(p.loanResetAt, tz, { month: 'short', day: 'numeric', year: 'numeric' })}` });
      }
      if (want('lease_expiries') && p.leaseEndsAt && ['rents', 'leased_out'].includes(p.relationship)) {
        const n = Math.round((new Date(p.leaseEndsAt) - Date.now()) / 864e5);
        if (n >= 0 && n <= Math.max(within, 120)) out.push({ kind: 'lease_expiry', in_days: n, ...who, detail: `Lease ends ${U.fmtDate(p.leaseEndsAt, tz, { month: 'short', day: 'numeric' })}` });
      }
    }
    out.sort((a, b) => a.in_days - b.in_days);
    for (const s of out) ctx.names.set(s.client_id, s.client);
    return { count: out.length, signals: out.slice(0, limit) };
  },
});

def({
  name: 'who_to_call',
  description: 'Ranked call list for right now: unanswered client questions, missed calls not returned, hot deals with deadlines, whales gone quiet, relationship moments. Each with the reason.',
  input_schema: { type: 'object', properties: { limit: { type: 'integer' } } },
  activity: () => 'Working out who to call first…',
  async run(input, ctx) {
    const { callSuggestions } = require('../../calls/callNow');
    const out = await callSuggestions({ workspaceId: ctx.workspaceId, userId: ctx.userId, limit: input.limit || 5 });
    for (const s of out.suggestions) if (s.clientId) ctx.names.set(s.clientId, s.name);
    return {
      source: out.source,
      suggestions: out.suggestions.map((s) => ({ client_id: s.clientId, name: s.name, phone: s.phone ? U.formatPhone(s.phone) : null, reason: s.reason, why: s.why, urgency: s.score })),
    };
  },
});

def({
  name: 'recent_calls',
  description: 'Recent phone calls (inbound/outbound/missed/voicemail), optionally for one client, with summaries.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, missed_only: { type: 'boolean' }, limit: { type: 'integer' } } },
  activity: () => 'Checking your recent calls…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const where = { workspaceId };
    if (input.client_id) where.clientId = input.client_id;
    if (input.missed_only) { where.direction = 'inbound'; where.status = { in: ['missed', 'no_answer', 'voicemail'] }; }
    const rows = await prisma.phoneCall.findMany({ where, include: { client: { select: U.CLIENT_LITE } }, orderBy: { startedAt: 'desc' }, take: Math.min(25, input.limit || 10) });
    return {
      calls: rows.map((k) => ({
        call_id: k.id, client: k.client ? U.nameOf(k.client) : U.formatPhone(k.direction === 'inbound' ? k.fromNumber : k.toNumber),
        client_id: k.clientId, direction: k.direction, status: k.status, when_local: U.fmtWhen(k.startedAt, tz),
        duration_sec: k.durationSec, summary: k.summary ? U.clip(k.summary, 240) : null, voicemail: k.voicemailTranscript ? U.clip(k.voicemailTranscript, 240) : null,
      })),
    };
  },
});

def({
  name: 'find_owners',
  description: 'Seller prospecting: which clients OWN a property matching a description (city, neighborhood, type, waterfront, value). E.g. "who owns a waterfront home in Coral Gables worth $5M+".',
  input_schema: { type: 'object', properties: { city: { type: 'string' }, neighborhood: { type: 'string' }, property_type: { type: 'string' }, waterfront: { type: 'boolean' }, min_value: { type: 'integer' }, beds_min: { type: 'integer' }, thinking_of_selling: { type: 'boolean' }, limit: { type: 'integer' } } },
  activity: () => 'Checking who in your book owns that kind of home…',
  async run(input, ctx) {
    const { workspaceId, tz } = ctx;
    const where = { workspaceId, relationship: { in: ['owns', 'leased_out'] } };
    if (input.city) where.city = { contains: input.city, mode: 'insensitive' };
    if (input.neighborhood) where.OR = [{ neighborhood: { contains: input.neighborhood, mode: 'insensitive' } }, { subdivision: { contains: input.neighborhood, mode: 'insensitive' } }, { buildingName: { contains: input.neighborhood, mode: 'insensitive' } }];
    if (input.property_type) where.propertyType = { contains: input.property_type, mode: 'insensitive' };
    if (input.waterfront) where.waterfront = { not: null };
    if (input.min_value) where.estValue = { gte: input.min_value };
    if (input.beds_min) where.beds = { gte: input.beds_min };
    if (input.thinking_of_selling) where.thinkingOfSelling = true;
    const rows = await prisma.portfolioProperty.findMany({ where, include: { client: { select: U.CLIENT_LITE } }, orderBy: { estValue: 'desc' }, take: Math.min(25, input.limit || 10) });
    return { count: rows.length, owners: rows.filter((p) => p.client).map((p) => ({ client: U.nameOf(p.client), client_id: p.clientId, rating: p.client.rating, whale: p.client.isWhale, ...propertyOut(p, tz) })) };
  },
});

module.exports = { tools, dealOut, apptOut, taskOut, listingOut, stageLabel, dealPrice, dealGci };
