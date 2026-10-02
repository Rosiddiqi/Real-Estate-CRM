// Calendar & appointments — the ONE writer for the Appointment table.
//
// Other builders import these instead of writing rows directly:
//   const calendar = require('../services/calendar');
//   await calendar.createAppointment({ workspaceId, userId, type: 'showing', clientId, listingId, startAt, durationMin: 60 });
//   await calendar.updateAppointment({ workspaceId, id, patch: { status: 'completed' } });
//
// Every write logs a client activity, broadcasts `appointment_updated`, and
// nudges the Battle Plan (`plan_updated`) — the rail reflows lunch / content
// around live appointments on read, so no regeneration is needed.
const prisma = require('../lib/prisma');
const hub = require('../realtime/hub');
const ai = require('../ai/claude');
const config = require('../config');
const { logActivity } = require('../lib/activity');
const { clientName } = require('../lib/clients');
const { dayKey } = require('../lib/dates');

const TYPES = {
  showing: { label: 'Showing', duration: 60 },
  private_tour: { label: 'Private tour', duration: 60 },
  open_house: { label: 'Open house', duration: 180 },
  broker_open: { label: 'Broker open', duration: 120 },
  listing_presentation: { label: 'Listing presentation', duration: 90 },
  buyer_consult: { label: 'Buyer consult', duration: 60 },
  inspection: { label: 'Inspection', duration: 180 },
  appraisal: { label: 'Appraisal', duration: 60 },
  final_walkthrough: { label: 'Final walkthrough', duration: 45 },
  closing: { label: 'Closing', duration: 60 },
  call: { label: 'Call', duration: 15 },
  video: { label: 'Video call', duration: 30 },
  meeting: { label: 'Meeting', duration: 45 },
  content: { label: 'Content', duration: 90 },
  personal: { label: 'Personal', duration: 60 },
  team: { label: 'Team meeting', duration: 30 },
  other: { label: 'Other', duration: 30 },
};
const TYPE_ALIASES = { test_drive: 'showing', tour: 'private_tour', consult: 'buyer_consult', consultation: 'buyer_consult', listing_appt: 'listing_presentation', phone_call: 'call', follow_up: 'call', walkthrough: 'final_walkthrough', team_meeting: 'team', appointment: 'other' };
const SHOWING_TYPES = new Set(['showing', 'private_tour', 'open_house', 'broker_open']);
const STATUSES = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'];
const OUTCOMES = {
  loved: 'Loved it', liked: 'Liked it', maybe: 'On the fence', pass: 'Not for them', second: 'Wants a second showing', offer: 'Ready to write an offer',
};

function normType(t) {
  const k = String(t || '').toLowerCase().trim();
  if (TYPES[k]) return k;
  return TYPE_ALIASES[k] || 'other';
}

const CLIENT_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true, avatarUrl: true,
  rating: true, isWhale: true, type: true, status: true,
};
const LISTING_SELECT = {
  id: true, title: true, headline: true, street: true, unitNumber: true, city: true, state: true, postalCode: true,
  neighborhood: true, buildingName: true, listPrice: true, beds: true, bathsTotal: true, livingAreaSqft: true,
  heroPhoto: true, photoUrls: true, status: true, isOwnListing: true, lat: true, lng: true,
};

function listingAddress(l) {
  if (!l) return null;
  const street = [l.street, l.unitNumber].filter(Boolean).join(' ');
  const line2 = [l.city, l.state].filter(Boolean).join(', ');
  return [street || l.buildingName || l.title, line2].filter(Boolean).join(', ') || null;
}
function listingShort(l) {
  if (!l) return null;
  return [l.street, l.unitNumber].filter(Boolean).join(' ') || l.buildingName || l.title || null;
}

function serialize(a, client, listing) {
  const durationMin = Math.max(5, Math.round((new Date(a.endAt) - new Date(a.startAt)) / 60000));
  return {
    ...a,
    type: normType(a.type),
    typeLabel: (TYPES[normType(a.type)] || TYPES.other).label,
    durationMin,
    client: client ? { ...client, name: clientName(client) } : null,
    listing: listing ? { ...listing, address: listingAddress(listing), short: listingShort(listing), photo: listing.heroPhoto || (listing.photoUrls || [])[0] || null } : null,
  };
}

async function hydrate(workspaceId, rows) {
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean))];
  const listingIds = [...new Set(rows.map((r) => r.listingId).filter(Boolean))];
  const [clients, listings] = await Promise.all([
    clientIds.length ? prisma.client.findMany({ where: { workspaceId, id: { in: clientIds } }, select: CLIENT_SELECT }) : [],
    listingIds.length ? prisma.listing.findMany({ where: { workspaceId, id: { in: listingIds } }, select: LISTING_SELECT }) : [],
  ]);
  const cBy = new Map(clients.map((c) => [c.id, c]));
  const lBy = new Map(listings.map((l) => [l.id, l]));
  return rows.map((r) => serialize(r, cBy.get(r.clientId), lBy.get(r.listingId)));
}

async function tzFor(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  return (ws && ws.timezone) || config.timezone;
}

function announce(workspaceId, appointment, action, tz) {
  hub.broadcast(workspaceId, 'appointment_updated', { appointment, action });
  try {
    hub.broadcast(workspaceId, 'plan_updated', { date: dayKey(new Date(appointment.startAt), tz), reason: 'appointment' });
  } catch { /* ignore */ }
}

function whenLabel(date, tz) {
  return new Date(date).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function createAppointment({
  workspaceId, userId = null, type, title, clientId = null, dealId = null, listingId = null, startAt, endAt, durationMin,
  location, notes = null, allDay = false, status = 'scheduled', source = 'user', attendees = null, imageUrl = null, actor = 'agent',
}) {
  if (!startAt || Number.isNaN(new Date(startAt).getTime())) throw Object.assign(new Error('A valid start time is required'), { status: 400 });
  const t = normType(type || 'showing');
  const start = new Date(startAt);
  let end = endAt ? new Date(endAt) : new Date(start.getTime() + (Number(durationMin) || TYPES[t].duration) * 60000);
  if (!(end > start)) end = new Date(start.getTime() + TYPES[t].duration * 60000);
  const [client, listing] = await Promise.all([
    clientId ? prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: CLIENT_SELECT }) : null,
    listingId ? prisma.listing.findFirst({ where: { id: listingId, workspaceId }, select: LISTING_SELECT }) : null,
  ]);
  if (clientId && !client) throw Object.assign(new Error('Client not found'), { status: 404 });
  const label = TYPES[t].label;
  const autoTitle = client
    ? `${label} with ${clientName(client)}`
    : listing ? `${label} — ${listingShort(listing)}` : label;
  const row = await prisma.appointment.create({
    data: {
      workspaceId, userId, clientId: client ? client.id : null, dealId: dealId || null, listingId: listing ? listing.id : null,
      type: t, title: String(title || '').trim() || autoTitle, notes, location: location || listingAddress(listing) || null,
      startAt: start, endAt: end, allDay: !!allDay, status: STATUSES.includes(status) ? status : 'scheduled', source,
      attendees, imageUrl,
    },
  });
  const tz = await tzFor(workspaceId);
  const appointment = serialize(row, client, listing);
  if (client) {
    logActivity({
      workspaceId, clientId: client.id, dealId: row.dealId, listingId: row.listingId,
      type: SHOWING_TYPES.has(t) ? 'showing' : 'appointment',
      title: `${label} booked · ${whenLabel(start, tz)}`,
      body: row.location || null,
      meta: { appointmentId: row.id, startAt: row.startAt, type: t },
      actor,
    });
  }
  announce(workspaceId, appointment, 'created', tz);
  return appointment;
}

async function getAppointment({ workspaceId, id }) {
  const row = await prisma.appointment.findFirst({ where: { id, workspaceId } });
  if (!row) return null;
  const [a] = await hydrate(workspaceId, [row]);
  return a;
}

async function updateAppointment({ workspaceId, id, patch = {}, actor = 'agent' }) {
  const current = await prisma.appointment.findFirst({ where: { id, workspaceId } });
  if (!current) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  const data = {};
  for (const k of ['title', 'notes', 'location', 'allDay', 'attendees', 'reminders', 'imageUrl', 'outcome', 'dealId']) {
    if (patch[k] !== undefined) data[k] = patch[k];
  }
  if (patch.type !== undefined) data.type = normType(patch.type);
  if (patch.clientId !== undefined) {
    if (patch.clientId) {
      const ok = await prisma.client.findFirst({ where: { id: patch.clientId, workspaceId }, select: { id: true } });
      if (!ok) throw Object.assign(new Error('Client not found'), { status: 404 });
    }
    data.clientId = patch.clientId || null;
  }
  if (patch.listingId !== undefined) data.listingId = patch.listingId || null;
  if (patch.followUpLoggedAt !== undefined) data.followUpLoggedAt = patch.followUpLoggedAt ? new Date(patch.followUpLoggedAt) : null;
  let start = new Date(current.startAt); let end = new Date(current.endAt);
  if (patch.startAt) {
    const dur = end - start;
    start = new Date(patch.startAt);
    end = patch.endAt ? new Date(patch.endAt) : new Date(start.getTime() + (patch.durationMin ? patch.durationMin * 60000 : dur));
  } else if (patch.endAt) end = new Date(patch.endAt);
  else if (patch.durationMin) end = new Date(start.getTime() + Number(patch.durationMin) * 60000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw Object.assign(new Error('Invalid time'), { status: 400 });
  if (!(end > start)) end = new Date(start.getTime() + 30 * 60000);
  const moved = start.getTime() !== new Date(current.startAt).getTime() || end.getTime() !== new Date(current.endAt).getTime();
  if (moved) { data.startAt = start; data.endAt = end; data.reminderSentAt = null; }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
    data.status = patch.status;
  }
  const row = await prisma.appointment.update({ where: { id }, data });
  const tz = await tzFor(workspaceId);
  const [appointment] = await hydrate(workspaceId, [row]);
  const label = appointment.typeLabel;
  if (row.clientId) {
    const type = SHOWING_TYPES.has(row.type) ? 'showing' : 'appointment';
    if (data.status && data.status !== current.status) {
      const verb = { completed: 'completed', no_show: 'marked no-show', cancelled: 'cancelled', confirmed: 'confirmed', scheduled: 'reopened' }[data.status];
      logActivity({ workspaceId, clientId: row.clientId, listingId: row.listingId, type, title: `${label} ${verb}`, body: row.title, meta: { appointmentId: row.id, status: data.status }, actor });
    } else if (moved) {
      logActivity({ workspaceId, clientId: row.clientId, listingId: row.listingId, type, title: `${label} moved · ${whenLabel(start, tz)}`, meta: { appointmentId: row.id, from: current.startAt, to: start }, actor });
    }
  }
  announce(workspaceId, appointment, 'updated', tz);
  if (moved && dayKey(new Date(current.startAt), tz) !== dayKey(start, tz)) {
    hub.broadcast(workspaceId, 'plan_updated', { date: dayKey(new Date(current.startAt), tz), reason: 'appointment' });
  }
  return appointment;
}

async function deleteAppointment({ workspaceId, id }) {
  const current = await prisma.appointment.findFirst({ where: { id, workspaceId } });
  if (!current) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  await prisma.appointment.delete({ where: { id } });
  const tz = await tzFor(workspaceId);
  hub.broadcast(workspaceId, 'appointment_updated', { id, action: 'deleted', appointment: { id, startAt: current.startAt } });
  hub.broadcast(workspaceId, 'plan_updated', { date: dayKey(new Date(current.startAt), tz), reason: 'appointment' });
  return { ok: true };
}

async function listAppointments({ workspaceId, clientId, listingId, dealId, from, to, status, type, limit = 200, order = 'asc' }) {
  const where = { workspaceId };
  if (clientId) where.clientId = clientId;
  if (listingId) where.listingId = listingId;
  if (dealId) where.dealId = dealId;
  if (from || to) where.startAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) };
  if (status) where.status = { in: String(status).split(',') };
  if (type) where.type = { in: String(type).split(',').map(normType) };
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: { startAt: order === 'desc' ? 'desc' : 'asc' }, take: Math.min(1000, limit) }),
    prisma.appointment.count({ where }),
  ]);
  return { appointments: await hydrate(workspaceId, rows), total };
}

async function upcomingAppointments({ workspaceId, clientId, limit = 10, withinHours = 24 * 14 }) {
  const now = new Date();
  const where = {
    workspaceId,
    status: { in: ['scheduled', 'confirmed'] },
    endAt: { gte: now },
    startAt: { lte: new Date(now.getTime() + Number(withinHours) * 3600e3) },
  };
  if (clientId) where.clientId = clientId;
  const rows = await prisma.appointment.findMany({ where, orderBy: { startAt: 'asc' }, take: Math.min(100, Number(limit) || 10) });
  return { appointments: await hydrate(workspaceId, rows) };
}

// ── Showing outcome / feedback capture ──────────────────────────────────
async function logOutcome({ workspaceId, id, outcome, feedback, actor = 'agent' }) {
  const current = await prisma.appointment.findFirst({ where: { id, workspaceId } });
  if (!current) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  const label = OUTCOMES[outcome] || null;
  const text = [label, feedback && String(feedback).trim()].filter(Boolean).join(' — ');
  const data = { outcome: text || null, followUpLoggedAt: new Date() };
  if (new Date(current.endAt) < new Date() && ['scheduled', 'confirmed'].includes(current.status)) data.status = 'completed';
  const row = await prisma.appointment.update({ where: { id }, data });
  const tz = await tzFor(workspaceId);
  const [appointment] = await hydrate(workspaceId, [row]);
  if (row.clientId) {
    logActivity({
      workspaceId, clientId: row.clientId, listingId: row.listingId,
      type: 'showing',
      title: `${appointment.typeLabel} feedback: ${label || 'Logged'}${appointment.listing ? ` · ${appointment.listing.short}` : ''}`,
      body: feedback || null,
      meta: { appointmentId: row.id, outcome },
      actor,
    });
    // The showing-feedback move for this client is handled.
    const moves = await prisma.planMove.findMany({ where: { workspaceId, clientId: row.clientId, kind: 'showing.feedback', status: 'open' }, include: { planDay: { select: { userId: true } } } });
    for (const m of moves) {
      await prisma.planMove.update({ where: { id: m.id }, data: { status: 'done' } });
      await prisma.planHandled.upsert({
        where: { userId_key: { userId: m.planDay.userId, key: m.key } },
        create: { workspaceId, userId: m.planDay.userId, key: m.key },
        update: { handledAt: new Date() },
      }).catch(() => {});
    }
  }
  announce(workspaceId, appointment, 'updated', tz);
  return appointment;
}

// ── AI pre-appointment relationship briefing ────────────────────────────
const money = (n) => (n ? (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1e3)}K`) : null);
function rel(date) {
  if (!date) return null;
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 864e5);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}
const STAGE = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer submitted', under_contract: 'Under contract',
  closed: 'Closed', seller_lead: 'Seller lead', listing_appt: 'Listing appointment', active: 'Active listing', offer_received: 'Offer received', lost: 'Lost',
};
const SAFE_PERSONAL = ['spouse', 'partner', 'pets', 'pet', 'hobbies', 'hobby', 'wine', 'restaurants', 'favoriteRestaurant', 'clubs', 'interests', 'sports', 'travel', 'cars', 'art'];

async function gatherBriefingContext(workspaceId, appt) {
  const clientId = appt.clientId;
  const [client, searches, deals, props, notes, messages, pastAppts, listing] = await Promise.all([
    clientId ? prisma.client.findFirst({ where: { id: clientId, workspaceId } }) : null,
    clientId ? prisma.buyerSearch.findMany({ where: { workspaceId, clientId, status: 'active' }, take: 3 }) : [],
    clientId ? prisma.deal.findMany({ where: { workspaceId, clientId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 3 }) : [],
    clientId ? prisma.portfolioProperty.findMany({ where: { workspaceId, clientId }, take: 4 }) : [],
    clientId ? prisma.note.findMany({ where: { workspaceId, clientId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 4 }) : [],
    clientId ? prisma.message.findMany({ where: { workspaceId, clientId }, orderBy: { sentAt: 'desc' }, take: 8, select: { isFromMe: true, body: true, sentAt: true } }) : [],
    clientId ? prisma.appointment.findMany({ where: { workspaceId, clientId, id: { not: appt.id }, startAt: { lt: new Date(appt.startAt) } }, orderBy: { startAt: 'desc' }, take: 4 }) : [],
    appt.listingId ? prisma.listing.findFirst({ where: { id: appt.listingId, workspaceId } }) : null,
  ]);
  return { client, searches, deals, props, notes, messages, pastAppts, listing };
}

function fallbackBriefing(appt, ctx) {
  const { client, searches, deals, props, notes, messages, pastAppts, listing } = ctx;
  const first = client ? (client.firstName || clientName(client).split(' ')[0]) : null;
  const typeLabel = (TYPES[normType(appt.type)] || TYPES.other).label;
  const bullets = [];
  const talkingPoints = [];
  const watchOuts = [];
  if (client) {
    const bits = [];
    if (client.rating) bits.push(`${client.rating}★`);
    if (client.isWhale) bits.push('whale');
    bits.push(client.type ? client.type.replace('_', ' / ') : 'client');
    if (client.transactionsCount) bits.push(`${client.transactionsCount} closed with you`);
    // Last touch = the later of the contact stamp and their latest message.
    const lastMsgAt = messages && messages[0] ? new Date(messages[0].sentAt) : null;
    const stamp = client.lastContactedAt ? new Date(client.lastContactedAt) : null;
    const lastTouch = lastMsgAt && (!stamp || lastMsgAt > stamp) ? lastMsgAt : stamp;
    bullets.push(`${clientName(client)} — ${bits.join(' · ')}${lastTouch ? ` · last spoke ${rel(lastTouch)}` : ''}`);
    const fin = [];
    if (client.financing) fin.push({ cash_pof: 'Cash (proof of funds)', preapproved: 'Pre-approved', prequalified: 'Pre-qualified', contingent: 'Contingent on sale' }[client.financing] || client.financing);
    if (client.preApprovalAmount) fin.push(`up to ${money(client.preApprovalAmount)}`);
    if (client.timeline) fin.push(`timeline ${client.timeline}`);
    if (fin.length) bullets.push(`Buying power: ${fin.join(' · ')}`);
    if (client.preApprovalExpires && new Date(client.preApprovalExpires) < new Date(Date.now() + 21 * 864e5)) {
      watchOuts.push(`Pre-approval ${new Date(client.preApprovalExpires) < new Date() ? 'has expired' : 'expires soon'} — confirm with ${client.lenderName || 'their lender'}.`);
    }
    if (client.financing === 'contingent') watchOuts.push('Purchase is contingent on selling their current home.');
  }
  const s = searches[0];
  if (s) {
    const where = [...(s.neighborhoods || []), ...(s.markets || [])].slice(0, 3).join(', ');
    const range = s.priceMin && s.priceMax ? `${money(s.priceMin)}–${money(s.priceMax)}` : s.priceMax ? `up to ${money(s.priceMax)}` : null;
    bullets.push(`Searching ${[where, range, s.bedsMin ? `${s.bedsMin}+ bd` : null].filter(Boolean).join(' · ') || 'actively'}`);
    const musts = Array.isArray(s.mustHaves) ? s.mustHaves.map((m) => (typeof m === 'string' ? m : m.feature)).filter(Boolean) : [];
    if (musts.length) talkingPoints.push(`Their must-haves: ${musts.slice(0, 4).join(', ')} — point these out first.`);
    if ((s.dealBreakers || []).length) watchOuts.push(`Deal-breakers: ${s.dealBreakers.slice(0, 3).join(', ')}.`);
  }
  const d = deals.find((x) => !['closed', 'lost'].includes(x.stage));
  if (d) bullets.push(`Open deal — ${STAGE[d.stage] || String(d.stage).replace(/_/g, ' ')}${d.propertyLabel ? ` · ${d.propertyLabel}` : ''}${d.price ? ` · ${money(d.price)}` : ''}`);
  const owned = props.find((p) => p.relationship === 'owns');
  if (owned) bullets.push(`Owns ${[owned.street, owned.city].filter(Boolean).join(', ') || 'a home'}${owned.estValue ? ` (est. ${money(owned.estValue)})` : ''}${owned.thinkingOfSelling ? ' — thinking of selling' : ''}`);
  const rents = props.find((p) => p.relationship === 'rents');
  if (rents && rents.leaseEndsAt) bullets.push(`Renting — lease ends ${new Date(rents.leaseEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  if (listing) {
    const specs = [listing.beds ? `${listing.beds} bd` : null, listing.bathsTotal ? `${listing.bathsTotal} ba` : null, listing.livingAreaSqft ? `${Number(listing.livingAreaSqft).toLocaleString()} sq ft` : null].filter(Boolean).join(' · ');
    talkingPoints.push(`${listingShort(listing) || 'The property'}: ${[money(listing.listPrice), specs].filter(Boolean).join(' · ')}${listing.listPrice && listing.livingAreaSqft ? ` · $${Math.round(listing.listPrice / listing.livingAreaSqft).toLocaleString()}/sq ft` : ''}`);
    if (listing.priceDroppedAt && listing.previousPrice) talkingPoints.push(`Price cut from ${money(listing.previousPrice)} — sellers are motivated.`);
    if ((listing.amenities || []).length) talkingPoints.push(`Lead with: ${listing.amenities.slice(0, 4).join(', ')}.`);
  }
  const lastIn = messages.find((m) => !m.isFromMe && m.body);
  if (lastIn) {
    bullets.push(`Last text from ${first || 'them'} ${rel(lastIn.sentAt)}: “${String(lastIn.body).slice(0, 110)}${String(lastIn.body).length > 110 ? '…' : ''}”`);
    if (messages[0] && !messages[0].isFromMe && String(messages[0].body || '').includes('?')) watchOuts.push('Their last text is an unanswered question — answer it before you arrive.');
  }
  const prevShowing = pastAppts.find((a) => a.outcome);
  if (prevShowing) talkingPoints.push(`Last ${(TYPES[normType(prevShowing.type)] || TYPES.other).label.toLowerCase()}: ${prevShowing.outcome}`);
  if (client && client.personal && typeof client.personal === 'object') {
    const bits = Object.entries(client.personal)
      .filter(([k, v]) => SAFE_PERSONAL.includes(k) && v && typeof v !== 'object')
      .slice(0, 3).map(([k, v]) => `${k}: ${v}`);
    if (bits.length) talkingPoints.push(`Rapport: ${bits.join(' · ')}`);
  }
  const pinned = notes.find((n) => n.pinned) || notes[0];
  if (pinned) bullets.push(`Note: ${String(pinned.body).slice(0, 120)}`);
  if (!talkingPoints.length) talkingPoints.push(`Confirm what they want out of this ${typeLabel.toLowerCase()} and agree the next step before you leave.`);
  const headline = client
    ? `${typeLabel} with ${first}${listing ? ` at ${listingShort(listing)}` : ''}${client.isWhale ? ' — whale, white-glove it' : ''}`
    : `${typeLabel}${listing ? ` at ${listingShort(listing)}` : ''}`;
  return { headline, bullets: bullets.slice(0, 6), talkingPoints: talkingPoints.slice(0, 4), watchOuts: watchOuts.slice(0, 3), source: 'fallback', generatedAt: new Date().toISOString() };
}

const BRIEF_SYSTEM = `You prepare a luxury real estate agent for an upcoming client appointment. Using ONLY the facts provided, write a tight pre-appointment relationship briefing: who they are to the agent, what they want, where the deal stands, what to say, and what to watch for.

Output JSON: headline (≤90 chars), bullets (3–6 short facts, ≤140 chars each), talkingPoints (2–4, ≤140 chars each, specific to this property and this person), watchOuts (0–3, ≤140 chars each).
Never invent facts, prices or dates that are not in the data. No platitudes ("great opportunity", "build rapport").
Fair Housing: never mention, infer or use race, color, religion, national origin, sex, familial status (children), disability or any other protected characteristic, and never describe a neighborhood by who lives there. Talk only about the property, the money, the timeline and the relationship.`;

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    talkingPoints: { type: 'array', items: { type: 'string' } },
    watchOuts: { type: 'array', items: { type: 'string' } },
  },
};

async function getBriefing({ workspaceId, id, refresh = false }) {
  const appt = await prisma.appointment.findFirst({ where: { id, workspaceId } });
  if (!appt) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  const fresh = appt.briefing && appt.briefingAt && (Date.now() - new Date(appt.briefingAt).getTime() < 6 * 3600e3);
  if (fresh && !refresh && (appt.briefing.source === 'ai' || !ai.available())) return appt.briefing;
  const ctx = await gatherBriefingContext(workspaceId, appt);
  let briefing = fallbackBriefing(appt, ctx);
  if (ai.available()) {
    try {
      const facts = {
        appointment: { type: appt.type, title: appt.title, startAt: appt.startAt, location: appt.location, notes: appt.notes },
        client: ctx.client ? {
          name: clientName(ctx.client), type: ctx.client.type, status: ctx.client.status, rating: ctx.client.rating, whale: ctx.client.isWhale,
          financing: ctx.client.financing, preApprovalAmount: ctx.client.preApprovalAmount, preApprovalExpires: ctx.client.preApprovalExpires,
          timeline: ctx.client.timeline, motivation: ctx.client.motivation, lastContactedAt: ctx.client.lastContactedAt, transactions: ctx.client.transactionsCount,
          notes: ctx.client.notes ? String(ctx.client.notes).slice(0, 600) : null,
        } : null,
        searches: ctx.searches.map((s) => ({ name: s.name, neighborhoods: s.neighborhoods, priceMin: s.priceMin, priceMax: s.priceMax, bedsMin: s.bedsMin, mustHaves: s.mustHaves, dealBreakers: s.dealBreakers })),
        deals: ctx.deals.map((d) => ({ stage: d.stage, side: d.side, property: d.propertyLabel, price: d.price, closingDate: d.closingDate })),
        portfolio: ctx.props.map((p) => ({ relationship: p.relationship, address: [p.street, p.city].filter(Boolean).join(', '), estValue: p.estValue, leaseEndsAt: p.leaseEndsAt, thinkingOfSelling: p.thinkingOfSelling })),
        listing: ctx.listing ? { address: listingAddress(ctx.listing), price: ctx.listing.listPrice, beds: ctx.listing.beds, baths: ctx.listing.bathsTotal, sqft: ctx.listing.livingAreaSqft, amenities: ctx.listing.amenities, views: ctx.listing.views, waterfront: ctx.listing.waterfront, description: ctx.listing.description ? String(ctx.listing.description).slice(0, 500) : null } : null,
        recentMessages: ctx.messages.map((m) => ({ from: m.isFromMe ? 'agent' : 'client', body: String(m.body || '').slice(0, 200), at: m.sentAt })),
        pastAppointments: ctx.pastAppts.map((a) => ({ type: a.type, at: a.startAt, outcome: a.outcome })),
        notes: ctx.notes.map((n) => String(n.body).slice(0, 240)),
      };
      const out = await ai.json({ system: BRIEF_SYSTEM, prompt: `Facts:\n${JSON.stringify(facts)}\n\nWrite the briefing.`, schema: BRIEF_SCHEMA, effort: 'low', maxTokens: 3000, feature: 'appointment_briefing', workspaceId });
      if (out && out.headline && Array.isArray(out.bullets) && out.bullets.length) {
        const trim = (a, n) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => x.slice(0, 160)) : []);
        briefing = { headline: String(out.headline).slice(0, 110), bullets: trim(out.bullets, 6), talkingPoints: trim(out.talkingPoints, 4), watchOuts: trim(out.watchOuts, 3), source: 'ai', generatedAt: new Date().toISOString() };
      }
    } catch (err) {
      if (err.code !== 'ai_unavailable') console.warn('[calendar] briefing AI failed:', err.message);
    }
  }
  await prisma.appointment.update({ where: { id }, data: { briefing, briefingAt: new Date() } }).catch(() => {});
  return briefing;
}

module.exports = {
  createAppointment, updateAppointment, deleteAppointment, getAppointment, listAppointments, upcomingAppointments,
  logOutcome, getBriefing, hydrate, serialize, normType, TYPES, SHOWING_TYPES, STATUSES, OUTCOMES, listingAddress, listingShort,
};
