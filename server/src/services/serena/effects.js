// CRM mutations with their side effects (timeline + realtime) and their
// inverses. Used by Serena's write tools and the post-call recap so both get
// identical behavior and one-tap Undo.
//
//   const fx = require('./effects');
//   const { task, undo } = await fx.createTask(ctx, { title, clientId, dueDate });
//   await fx.applyUndo(ctx, undo);
//
// ctx = { workspaceId, userId, tz }. Writes delegate to the owning builder's
// service when it exports the function (services/tasks.js, services/calendar.js,
// services/pipeline/deals.js); otherwise they write through Prisma with the
// same side effects (logActivity + hub broadcasts).
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const { logActivity } = require('../../lib/activity');
const { normalizePhone } = require('../../lib/phone');
const { dayKey } = require('../../lib/dates');
const U = require('./util');

const APPT_LABEL = {
  showing: 'Showing', private_tour: 'Private tour', open_house: 'Open house', broker_open: 'Broker open',
  listing_presentation: 'Listing presentation', buyer_consult: 'Buyer consultation', inspection: 'Inspection',
  appraisal: 'Appraisal', final_walkthrough: 'Final walkthrough', closing: 'Closing', call: 'Call', video: 'Video call',
  meeting: 'Meeting', content: 'Listing media', personal: 'Personal', team: 'Team', other: 'Appointment',
};
const APPT_TYPES = Object.keys(APPT_LABEL);

function broadcast(ctx, event, payload) {
  try { hub.broadcast(ctx.workspaceId, event, payload); } catch { /* realtime is best-effort */ }
}
function planChanged(ctx, reason) { broadcast(ctx, 'plan_updated', { source: 'serena', reason }); }

async function activity(ctx, data) {
  const row = await logActivity({ workspaceId: ctx.workspaceId, actor: ctx.actor || 'ai', ...data });
  return row ? row.id : null;
}

// Owning-builder services (loaded lazily; null when absent).
const svc = {
  tasks: () => U.optionalRequire('../tasks'),
  calendar: () => U.optionalRequire('../calendar'),
  deals: () => U.optionalRequire('../pipeline/deals'),
  stages: () => U.optionalRequire('../pipeline/stages'),
};

// ── tasks ──────────────────────────────────────────────────────────────────
const PRIORITY = { low: -1, normal: 0, high: 1, urgent: 2 };

async function createTask(ctx, { title, clientId = null, dealId = null, listingId = null, dueAt = null, dueDate = null, notes = null, kind = null, priority = 'normal', source = 'serena', meta = null }) {
  if (!title || !String(title).trim()) throw new Error('A to-do needs a title.');
  const data = {
    workspaceId: ctx.workspaceId, userId: ctx.userId || null, clientId, dealId, listingId,
    title: String(title).trim().slice(0, 240), notes, kind, status: 'pending', source,
    dueAt: dueAt || null, dueDate: dueDate || (dueAt ? dayKey(dueAt, ctx.tz) : null),
    priority: typeof priority === 'number' ? priority : (PRIORITY[priority] ?? 0), meta,
  };
  let task = null;
  const fn = U.fnFrom(svc.tasks(), 'createTask');
  if (fn) {
    try { task = await fn({ ...data, workspaceId: ctx.workspaceId, userId: ctx.userId }); } catch (err) { if (!/is not a function|Cannot read prop/i.test(err.message)) throw err; }
    if (task && task.task) task = task.task;
  }
  if (!task || !task.id) {
    task = await prisma.task.create({ data });
    broadcast(ctx, 'task_updated', task);
  }
  const act = clientId ? await activity(ctx, { clientId, type: 'task_created', title: `To-do: ${task.title}`, meta: { taskId: task.id, source } }) : null;
  planChanged(ctx, 'task');
  return { task, undo: { kind: 'delete_task', taskId: task.id, activityIds: [act].filter(Boolean) } };
}

async function completeTask(ctx, { taskId }) {
  const t = await prisma.task.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
  if (!t) throw new Error(`No to-do with id ${taskId}.`);
  if (t.status === 'done') return { task: t, already: true, undo: null };
  const task = await prisma.task.update({ where: { id: t.id }, data: { status: 'done', completedAt: new Date() } });
  broadcast(ctx, 'task_updated', task);
  const act = t.clientId ? await activity(ctx, { clientId: t.clientId, type: 'task_done', title: `Done: ${t.title}`, meta: { taskId: t.id } }) : null;
  planChanged(ctx, 'task');
  return { task, undo: { kind: 'restore_task', taskId: t.id, prev: { status: t.status, completedAt: t.completedAt }, activityIds: [act].filter(Boolean) } };
}

// ── appointments ───────────────────────────────────────────────────────────
function apptTitle(type, client, listing) {
  const label = APPT_LABEL[type] || 'Appointment';
  const place = listing ? U.addressOf(listing) : null;
  if (client && place) return `${label} · ${place} with ${U.nameOf(client)}`;
  if (client) return `${label} with ${U.nameOf(client)}`;
  if (place) return `${label} · ${place}`;
  return label;
}

async function createAppointment(ctx, { clientId = null, listingId = null, dealId = null, type = 'showing', title = null, startAt, endAt = null, durationMin = 60, location = null, notes = null, source = 'serena' }) {
  if (!startAt || Number.isNaN(new Date(startAt).getTime())) throw new Error('Appointment needs a valid start time.');
  const t = APPT_TYPES.includes(type) ? type : 'other';
  const [client, listing] = await Promise.all([
    clientId ? prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE }) : null,
    listingId ? prisma.listing.findFirst({ where: { id: listingId, workspaceId: ctx.workspaceId } }) : null,
  ]);
  if (clientId && !client) throw new Error(`No client with id ${clientId}.`);
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + (durationMin || 60) * 60000);
  const data = {
    workspaceId: ctx.workspaceId, userId: ctx.userId || null, clientId, listingId: listing ? listing.id : null, dealId,
    type: t, title: (title && String(title).trim()) || apptTitle(t, client, listing), notes,
    location: location || (listing ? [U.addressOf(listing), listing.city].filter(Boolean).join(', ') : null),
    startAt: start, endAt: end, status: 'scheduled', source,
  };
  let appt = null;
  const fn = U.fnFrom(svc.calendar(), 'createAppointment');
  if (fn) {
    try { appt = await fn({ ...data, workspaceId: ctx.workspaceId, userId: ctx.userId }); } catch (err) { if (!/is not a function|Cannot read prop/i.test(err.message)) throw err; }
    if (appt && appt.appointment) appt = appt.appointment;
  }
  if (!appt || !appt.id) {
    appt = await prisma.appointment.create({ data });
    broadcast(ctx, 'appointment_updated', appt);
  }
  const act = clientId ? await activity(ctx, { clientId, listingId: data.listingId, type: ['showing', 'private_tour', 'open_house'].includes(t) ? 'showing' : 'appointment', title: `${APPT_LABEL[t] || 'Appointment'} booked · ${U.fmtWhen(start, ctx.tz)}`, meta: { appointmentId: appt.id, source } }) : null;
  planChanged(ctx, 'appointment');
  return { appointment: appt, client, listing, undo: { kind: 'delete_appointment', appointmentId: appt.id, activityIds: [act].filter(Boolean) } };
}

async function updateAppointment(ctx, appointmentId, patch) {
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, workspaceId: ctx.workspaceId } });
  if (!a) throw new Error(`No appointment with id ${appointmentId}.`);
  const prev = { startAt: a.startAt, endAt: a.endAt, status: a.status, type: a.type, title: a.title, location: a.location };
  const data = {};
  if (patch.startAt) {
    const dur = new Date(a.endAt) - new Date(a.startAt);
    data.startAt = new Date(patch.startAt);
    data.endAt = patch.endAt ? new Date(patch.endAt) : new Date(data.startAt.getTime() + (patch.durationMin ? patch.durationMin * 60000 : dur));
  } else if (patch.durationMin) {
    data.endAt = new Date(new Date(a.startAt).getTime() + patch.durationMin * 60000);
  }
  if (patch.status) data.status = patch.status;
  if (patch.type && APPT_TYPES.includes(patch.type)) data.type = patch.type;
  if (patch.location !== undefined) data.location = patch.location;
  if (patch.notes) data.notes = [a.notes, patch.notes].filter(Boolean).join('\n');
  const appointment = await prisma.appointment.update({ where: { id: a.id }, data });
  broadcast(ctx, 'appointment_updated', appointment);
  planChanged(ctx, 'appointment');
  return { appointment, prev, undo: { kind: 'restore_appointment', appointmentId: a.id, prev } };
}

// ── notes ──────────────────────────────────────────────────────────────────
async function addNote(ctx, { clientId, body, source = 'serena', dealId = null, listingId = null }) {
  if (!body || !String(body).trim()) throw new Error('Note is empty.');
  const note = await prisma.note.create({ data: { workspaceId: ctx.workspaceId, clientId, dealId, listingId, body: String(body).trim(), source } });
  const act = clientId ? await activity(ctx, { clientId, type: 'note', title: source === 'serena' ? 'Note added by Serena' : 'Note added', body: note.body, meta: { noteId: note.id, source } }) : null;
  broadcast(ctx, 'client_updated', { id: clientId, reason: 'note' });
  return { note, undo: { kind: 'delete_note', noteId: note.id, clientId, activityIds: [act].filter(Boolean) } };
}

// ── clients ────────────────────────────────────────────────────────────────
const CLIENT_FIELDS = ['firstName', 'lastName', 'displayName', 'phone', 'email', 'company', 'jobTitle', 'type', 'status', 'rating', 'isWhale', 'tags', 'financing', 'preApprovalAmount', 'lenderName', 'timeline', 'motivation', 'neighborhood', 'city', 'birthday', 'leadSource', 'preferredChannel', 'notes'];

async function updateClient(ctx, clientId, patch) {
  const c = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId } });
  if (!c) throw new Error(`No client with id ${clientId}.`);
  const data = {};
  const prev = {};
  for (const k of CLIENT_FIELDS) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'phone' && v) v = normalizePhone(v);
    if (k === 'rating') v = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
    if ((k === 'firstName' || k === 'lastName') && !String(v || '').trim()) continue; // never blank a name
    if (JSON.stringify(c[k]) === JSON.stringify(v)) continue;
    data[k] = v;
    prev[k] = c[k];
  }
  if (!Object.keys(data).length) return { client: c, changed: [], undo: null };
  const client = await prisma.client.update({ where: { id: c.id }, data });
  broadcast(ctx, 'client_updated', client);
  return { client, changed: Object.keys(data), prev, undo: { kind: 'restore_client', clientId: c.id, prev } };
}

async function createClient(ctx, { firstName, lastName = '', phone = null, email = null, type = 'buyer', status = 'lead', leadSource = null, notes = null, contactKind = 'client' }) {
  if (!firstName && !lastName && !phone && !email) throw new Error('A new client needs at least a name, phone or email.');
  const ph = phone ? normalizePhone(phone) : null;
  if (ph) {
    const dupe = await prisma.client.findFirst({ where: { workspaceId: ctx.workspaceId, OR: [{ phone: ph }, { phoneAlt: ph }] }, select: U.CLIENT_LITE });
    if (dupe) return { client: dupe, existing: true, undo: null };
  }
  const client = await prisma.client.create({ data: { workspaceId: ctx.workspaceId, firstName: firstName || '', lastName: lastName || '', phone: ph, email, type, status, leadSource: leadSource || 'Serena', notes, contactKind } });
  // Back-link earlier calls from this number.
  if (ph) await prisma.phoneCall.updateMany({ where: { workspaceId: ctx.workspaceId, clientId: null, OR: [{ fromNumber: ph }, { toNumber: ph }] }, data: { clientId: client.id } }).catch(() => {});
  broadcast(ctx, 'client_updated', client);
  const act = await activity(ctx, { clientId: client.id, type: 'system', title: 'Client added', meta: { source: ctx.actor === 'ai' ? 'serena' : 'agent' } });
  return { client, undo: { kind: 'delete_client_if_empty', clientId: client.id, activityIds: [act].filter(Boolean) } };
}

// ── deals ──────────────────────────────────────────────────────────────────
async function createDeal(ctx, { clientId, side = 'buyer', stage = null, title = null, price = null, propertyAddress = null, listingId = null, portfolioPropertyId = null, closingDate = null, notes = null }) {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE });
  if (!client) throw new Error(`No client with id ${clientId}.`);
  const S = svc.stages();
  let st = stage || (['listing', 'dual', 'lease_landlord'].includes(side) ? 'seller_lead' : 'new_lead');
  let subStatus = null;
  if (S && S.canonicalize) {
    try { const c = S.canonicalize(st, side); if (c && c.stage) { st = c.stage; subStatus = c.subStatus || null; } } catch { /* keep raw */ }
  }
  const listing = listingId ? await prisma.listing.findFirst({ where: { id: listingId, workspaceId: ctx.workspaceId } }) : null;
  const plan = await prisma.payPlan.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: 'asc' } });
  const rate = ['listing', 'dual', 'lease_landlord'].includes(side) ? (plan ? plan.defaultListingRate : 0.03) : (plan ? plan.defaultBuyerRate : 0.025);
  const p = price || (listing && listing.listPrice) || null;
  const data = {
    workspaceId: ctx.workspaceId, clientId, side, stage: st, subStatus, stageChangedAt: new Date(),
    title: title || (listing ? U.addressOf(listing) : propertyAddress) || `${U.nameOf(client)} · ${side === 'buyer' ? 'Purchase' : 'Sale'}`,
    price: p, listPrice: listing ? listing.listPrice : null, propertyAddress: propertyAddress || (listing ? U.addressOf(listing) : null),
    propertyLabel: listing ? U.addressOf(listing) : null, listingId: listing ? listing.id : null, portfolioPropertyId,
    sideRate: rate, splitShare: 1, estimatedGci: p ? Math.round(p * rate) : null, closingDate: closingDate ? new Date(closingDate) : null, notes,
  };
  let deal = null;
  const fn = U.fnFrom(svc.deals(), 'createDeal');
  if (fn) {
    try { deal = await fn({ ...data, workspaceId: ctx.workspaceId, userId: ctx.userId }); } catch (err) { if (!/is not a function|Cannot read prop/i.test(err.message)) throw err; }
    if (deal && deal.deal) deal = deal.deal;
  }
  let acts = [];
  if (!deal || !deal.id) {
    deal = await prisma.deal.create({ data });
    await prisma.dealEvent.create({ data: { workspaceId: ctx.workspaceId, dealId: deal.id, type: 'created', toStage: deal.stage } }).catch(() => {});
    broadcast(ctx, 'deal_created', deal);
    const act = await activity(ctx, { clientId, dealId: deal.id, type: 'deal_created', title: `Deal started · ${deal.title}`, meta: { dealId: deal.id, stage: deal.stage } });
    acts = [act].filter(Boolean);
  }
  return { deal, client, undo: { kind: 'delete_deal', dealId: deal.id, activityIds: acts } };
}

async function moveDeal(ctx, dealId, toStage) {
  const d = await prisma.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
  if (!d) throw new Error(`No deal with id ${dealId}.`);
  const S = svc.stages();
  let stage = toStage;
  let subStatus = null;
  if (S && S.canonicalize) {
    try { const c = S.canonicalize(toStage, d.side); if (c && c.stage) { stage = c.stage; subStatus = c.subStatus || null; } } catch { /* keep raw */ }
  }
  if (S && S.isValidStage && !S.isValidStage(stage)) throw new Error(`"${toStage}" is not a pipeline stage.`);
  const prev = { stage: d.stage, subStatus: d.subStatus, stageChangedAt: d.stageChangedAt, closedAt: d.closedAt, lostAt: d.lostAt };
  if (d.stage === stage && (!subStatus || d.subStatus === subStatus)) return { deal: d, unchanged: true, undo: null };
  let deal = null;
  const fn = U.fnFrom(svc.deals(), 'moveDeal', 'moveStage', 'changeStage');
  if (fn) {
    try { deal = await fn({ workspaceId: ctx.workspaceId, userId: ctx.userId, dealId: d.id, stage, subStatus, source: 'serena' }); } catch (err) { if (!/is not a function|Cannot read prop/i.test(err.message)) throw err; }
    if (deal && deal.deal) deal = deal.deal;
  }
  let acts = [];
  if (!deal || !deal.id) {
    const data = { stage, subStatus, stageChangedAt: new Date() };
    if (stage === 'closed' && !d.closedAt) data.closedAt = new Date();
    if (stage === 'lost' && !d.lostAt) data.lostAt = new Date();
    deal = await prisma.deal.update({ where: { id: d.id }, data });
    await prisma.dealEvent.create({ data: { workspaceId: ctx.workspaceId, dealId: d.id, type: stage === 'closed' ? 'closed' : stage === 'lost' ? 'lost' : 'stage', fromStage: d.stage, toStage: stage } }).catch(() => {});
    broadcast(ctx, 'deal_updated', deal);
    const act = await activity(ctx, { clientId: d.clientId, dealId: d.id, type: stage === 'closed' ? 'deal_closed' : 'deal_stage_change', title: `${deal.title || 'Deal'} → ${stage.replace(/_/g, ' ')}`, meta: { dealId: d.id, from: d.stage, to: stage } });
    acts = [act].filter(Boolean);
  }
  return { deal, prev, undo: { kind: 'restore_deal_stage', dealId: d.id, prev, activityIds: acts } };
}

// ── portfolio + searches ───────────────────────────────────────────────────
async function addBuyerSearch(ctx, clientId, s) {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE });
  if (!client) throw new Error(`No client with id ${clientId}.`);
  const search = await prisma.buyerSearch.create({
    data: {
      workspaceId: ctx.workspaceId, clientId, name: s.name || null, bucket: s.bucket || 'active', status: 'active',
      markets: s.markets || [], neighborhoods: s.neighborhoods || [], buildings: s.buildings || [], propertyTypes: s.propertyTypes || [],
      priceMin: s.priceMin || null, priceMax: s.priceMax || null, bedsMin: s.bedsMin || null, bathsMin: s.bathsMin || null,
      sqftMin: s.sqftMin || null, waterfront: s.waterfront || [], views: s.views || [],
      mustHaves: (s.mustHaves || []).map((f) => ({ feature: f, importance: 1, source: s.source || 'serena' })),
      niceToHaves: s.niceToHaves || [], dealBreakers: s.dealBreakers || [], timeline: s.timeline || null, financing: s.financing || null, notes: s.notes || null,
    },
  });
  broadcast(ctx, 'client_updated', { id: clientId, reason: 'search' });
  const act = await activity(ctx, { clientId, type: 'search_updated', title: `Buyer search added${search.name ? ` · ${search.name}` : ''}`, meta: { searchId: search.id } });
  return { search, client, undo: { kind: 'delete_search', searchId: search.id, clientId, activityIds: [act].filter(Boolean) } };
}

async function addPortfolioProperty(ctx, clientId, p) {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE });
  if (!client) throw new Error(`No client with id ${clientId}.`);
  const property = await prisma.portfolioProperty.create({
    data: {
      workspaceId: ctx.workspaceId, clientId, relationship: p.relationship || 'owns', source: 'described',
      street: p.street || null, unit: p.unit || null, city: p.city || null, state: p.state || null, neighborhood: p.neighborhood || null,
      buildingName: p.buildingName || null, propertyType: p.propertyType || null, beds: p.beds || null, baths: p.baths || null,
      sqft: p.sqft || null, lotSqft: p.lotSqft || null, yearBuilt: p.yearBuilt || null, waterfront: p.waterfront || null,
      views: p.views || [], estValue: p.estValue || null, estValueAt: p.estValue ? new Date() : null, valueSource: p.estValue ? 'manual' : null,
      purchasePrice: p.purchasePrice || null, purchasedAt: p.purchasedAt ? new Date(p.purchasedAt) : null,
      loanType: p.loanType || null, mortgageRate: p.mortgageRate || null, loanResetAt: p.loanResetAt ? new Date(p.loanResetAt) : null,
      leaseEndsAt: p.leaseEndsAt ? new Date(p.leaseEndsAt) : null, thinkingOfSelling: !!p.thinkingOfSelling, notes: p.notes || null,
    },
  });
  broadcast(ctx, 'client_updated', { id: clientId, reason: 'portfolio' });
  const act = await activity(ctx, { clientId, type: 'property_added', title: `Portfolio · ${U.addressOf(property) || property.neighborhood || 'property'} (${property.relationship})`, meta: { propertyId: property.id } });
  return { property, client, undo: { kind: 'delete_property', propertyId: property.id, clientId, activityIds: [act].filter(Boolean) } };
}

// ── calls ──────────────────────────────────────────────────────────────────
async function logCall(ctx, { clientId, direction = 'outbound', status = 'completed', durationSec = 0, summary = null, outcome = null, startedAt = null }) {
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE });
  if (!client) throw new Error(`No client with id ${clientId}.`);
  const start = startedAt ? new Date(startedAt) : new Date(Date.now() - (durationSec || 0) * 1000);
  const call = await prisma.phoneCall.create({
    data: {
      workspaceId: ctx.workspaceId, clientId, direction, status, durationSec: Math.round(durationSec || 0),
      fromNumber: direction === 'inbound' ? client.phone : null, toNumber: direction === 'outbound' ? client.phone : null,
      startedAt: start, answeredAt: status === 'completed' ? start : null, endedAt: new Date(start.getTime() + (durationSec || 0) * 1000),
      summary, meta: { source: 'logged', outcome },
    },
  });
  const prevContact = client.lastContactedAt;
  await prisma.client.update({ where: { id: clientId }, data: { lastContactedAt: new Date() } }).catch(() => {});
  broadcast(ctx, 'call_updated', call);
  const type = status === 'missed' ? 'call_missed' : direction === 'inbound' ? 'call_in' : 'call_out';
  const act = await activity(ctx, { clientId, type, title: `${direction === 'inbound' ? 'Call from' : 'Called'} ${U.firstOf(client)}${outcome ? ` · ${outcome}` : ''}`, body: summary, meta: { callId: call.id, durationSec: call.durationSec, outcome } });
  return { call, client, undo: { kind: 'delete_call', callId: call.id, clientId, prevContact, activityIds: [act].filter(Boolean) } };
}

// ── memory ─────────────────────────────────────────────────────────────────
async function remember(ctx, { text, kind = 'fact', source = 'serena' }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Nothing to remember.');
  const existing = await prisma.serenaMemory.findFirst({ where: { workspaceId: ctx.workspaceId, userId: ctx.userId, text: { equals: t, mode: 'insensitive' } } });
  if (existing) return { memory: existing, existing: true, undo: null };
  const memory = await prisma.serenaMemory.create({ data: { workspaceId: ctx.workspaceId, userId: ctx.userId, kind, text: t.slice(0, 400), source } });
  return { memory, undo: { kind: 'delete_memory', memoryId: memory.id } };
}

// ── undo ───────────────────────────────────────────────────────────────────
async function dropActivities(ctx, ids) {
  if (ids && ids.length) await prisma.activity.deleteMany({ where: { id: { in: ids }, workspaceId: ctx.workspaceId } }).catch(() => {});
}

async function applyUndo(ctx, u) {
  if (!u || !u.kind) throw new Error('Nothing to undo.');
  const wid = ctx.workspaceId;
  switch (u.kind) {
    case 'delete_task': {
      const t = await prisma.task.findFirst({ where: { id: u.taskId, workspaceId: wid } });
      if (t) {
        await prisma.task.delete({ where: { id: t.id } });
        broadcast(ctx, 'task_updated', { ...t, deleted: true, status: 'cancelled' });
      }
      await dropActivities(ctx, u.activityIds);
      planChanged(ctx, 'task');
      return { ok: true };
    }
    case 'restore_task': {
      const t = await prisma.task.findFirst({ where: { id: u.taskId, workspaceId: wid } });
      if (!t) throw new Error('That to-do no longer exists.');
      const task = await prisma.task.update({ where: { id: t.id }, data: { status: u.prev.status, completedAt: u.prev.completedAt ? new Date(u.prev.completedAt) : null } });
      broadcast(ctx, 'task_updated', task);
      await dropActivities(ctx, u.activityIds);
      planChanged(ctx, 'task');
      return { ok: true };
    }
    case 'delete_appointment': {
      const a = await prisma.appointment.findFirst({ where: { id: u.appointmentId, workspaceId: wid } });
      if (a) {
        const fn = U.fnFrom(svc.calendar(), 'deleteAppointment');
        let done = false;
        if (fn) { try { await fn({ workspaceId: wid, userId: ctx.userId, id: a.id, appointmentId: a.id }); done = true; } catch { done = false; } }
        if (!done) {
          await prisma.appointment.delete({ where: { id: a.id } }).catch(() => {});
          broadcast(ctx, 'appointment_updated', { ...a, deleted: true, status: 'cancelled' });
        }
      }
      await dropActivities(ctx, u.activityIds);
      planChanged(ctx, 'appointment');
      return { ok: true };
    }
    case 'restore_appointment': {
      const a = await prisma.appointment.findFirst({ where: { id: u.appointmentId, workspaceId: wid } });
      if (!a) throw new Error('That appointment no longer exists.');
      const p = u.prev;
      const appointment = await prisma.appointment.update({ where: { id: a.id }, data: { startAt: new Date(p.startAt), endAt: new Date(p.endAt), status: p.status, type: p.type, title: p.title, location: p.location } });
      broadcast(ctx, 'appointment_updated', appointment);
      planChanged(ctx, 'appointment');
      return { ok: true };
    }
    case 'delete_note': {
      await prisma.note.deleteMany({ where: { id: u.noteId, workspaceId: wid } });
      await dropActivities(ctx, u.activityIds);
      broadcast(ctx, 'client_updated', { id: u.clientId, reason: 'note' });
      return { ok: true };
    }
    case 'restore_client': {
      const c = await prisma.client.findFirst({ where: { id: u.clientId, workspaceId: wid } });
      if (!c) throw new Error('That client no longer exists.');
      const client = await prisma.client.update({ where: { id: c.id }, data: u.prev });
      broadcast(ctx, 'client_updated', client);
      return { ok: true };
    }
    case 'delete_client_if_empty': {
      const c = await prisma.client.findFirst({ where: { id: u.clientId, workspaceId: wid }, include: { _count: { select: { deals: true, appointments: true, conversations: true, properties: true, searches: true, notesList: true } } } });
      if (!c) return { ok: true };
      const n = Object.values(c._count).reduce((a, b) => a + b, 0);
      if (n > 0) throw new Error('The client already has activity — archive them from their card instead.');
      await dropActivities(ctx, u.activityIds);
      await prisma.client.delete({ where: { id: c.id } });
      broadcast(ctx, 'client_updated', { id: c.id, deleted: true });
      return { ok: true };
    }
    case 'delete_deal': {
      const d = await prisma.deal.findFirst({ where: { id: u.dealId, workspaceId: wid } });
      if (d) {
        await dropActivities(ctx, u.activityIds);
        await prisma.deal.delete({ where: { id: d.id } });
        broadcast(ctx, 'deal_deleted', { id: d.id });
      }
      return { ok: true };
    }
    case 'restore_deal_stage': {
      const d = await prisma.deal.findFirst({ where: { id: u.dealId, workspaceId: wid } });
      if (!d) throw new Error('That deal no longer exists.');
      const p = u.prev;
      const deal = await prisma.deal.update({ where: { id: d.id }, data: { stage: p.stage, subStatus: p.subStatus, stageChangedAt: p.stageChangedAt ? new Date(p.stageChangedAt) : new Date(), closedAt: p.closedAt ? new Date(p.closedAt) : null, lostAt: p.lostAt ? new Date(p.lostAt) : null } });
      await prisma.dealEvent.create({ data: { workspaceId: wid, dealId: d.id, type: 'stage', fromStage: d.stage, toStage: p.stage, meta: { undo: true } } }).catch(() => {});
      await dropActivities(ctx, u.activityIds);
      broadcast(ctx, 'deal_updated', deal);
      return { ok: true };
    }
    case 'delete_search': {
      await prisma.buyerSearch.deleteMany({ where: { id: u.searchId, workspaceId: wid } });
      await dropActivities(ctx, u.activityIds);
      broadcast(ctx, 'client_updated', { id: u.clientId, reason: 'search' });
      return { ok: true };
    }
    case 'delete_property': {
      await prisma.portfolioProperty.deleteMany({ where: { id: u.propertyId, workspaceId: wid } });
      await dropActivities(ctx, u.activityIds);
      broadcast(ctx, 'client_updated', { id: u.clientId, reason: 'portfolio' });
      return { ok: true };
    }
    case 'delete_call': {
      await prisma.phoneCall.deleteMany({ where: { id: u.callId, workspaceId: wid } });
      await dropActivities(ctx, u.activityIds);
      if (u.clientId) await prisma.client.update({ where: { id: u.clientId }, data: { lastContactedAt: u.prevContact ? new Date(u.prevContact) : null } }).catch(() => {});
      broadcast(ctx, 'call_updated', { id: u.callId, deleted: true });
      return { ok: true };
    }
    case 'delete_memory': {
      await prisma.serenaMemory.deleteMany({ where: { id: u.memoryId, workspaceId: wid } });
      return { ok: true };
    }
    default:
      throw new Error(`Can't undo ${u.kind}.`);
  }
}

module.exports = {
  APPT_LABEL, APPT_TYPES, PRIORITY,
  createTask, completeTask, createAppointment, updateAppointment, addNote, updateClient, createClient,
  createDeal, moveDeal, addBuyerSearch, addPortfolioProperty, logCall, remember, applyUndo,
};
