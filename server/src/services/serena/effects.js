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
// Prefer the calendar builder's labels so every surface reads the same.
try {
  const cal = require('../calendar');
  if (cal && cal.TYPES) for (const [k, v] of Object.entries(cal.TYPES)) if (v && v.label) APPT_LABEL[k] = v.label;
} catch { /* calendar service not present */ }
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
  let task;
  const T = svc.tasks();
  if (T && typeof T.createTask === 'function') {
    // undefined clientId lets the service auto-link a client named in the title
    task = await T.createTask({ ...data, clientId: clientId || undefined, actor: ctx.actor || 'ai' });
  } else {
    task = await prisma.task.create({ data });
    broadcast(ctx, 'task_updated', { task, action: 'created' });
    if (clientId) await activity(ctx, { clientId, type: 'task_created', title: `To-do: ${task.title}`, meta: { taskId: task.id, source } });
  }
  planChanged(ctx, 'task');
  return { task, undo: { kind: 'delete_task', taskId: task.id } };
}

async function completeTask(ctx, { taskId }) {
  const t = await prisma.task.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
  if (!t) throw new Error(`No to-do with id ${taskId}.`);
  if (t.status === 'done') return { task: t, already: true, undo: null };
  let task;
  const T = svc.tasks();
  if (T && typeof T.completeTask === 'function') {
    task = await T.completeTask({ workspaceId: ctx.workspaceId, id: t.id, actor: ctx.actor || 'ai' });
  } else {
    task = await prisma.task.update({ where: { id: t.id }, data: { status: 'done', completedAt: new Date() } });
    broadcast(ctx, 'task_updated', { task, action: 'updated' });
    if (t.clientId) await activity(ctx, { clientId: t.clientId, type: 'task_done', title: `Done: ${t.title}`, meta: { taskId: t.id } });
  }
  planChanged(ctx, 'task');
  return { task, undo: { kind: 'restore_task', taskId: t.id, prev: { status: t.status, completedAt: t.completedAt } } };
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

async function createAppointment(ctx, { clientId = null, listingId = null, dealId = null, type = 'showing', title = null, startAt, endAt = null, durationMin = null, location = null, notes = null, source = 'serena' }) {
  if (!startAt || Number.isNaN(new Date(startAt).getTime())) throw new Error('Appointment needs a valid start time.');
  const t = APPT_TYPES.includes(type) ? type : 'other';
  const [client, listing] = await Promise.all([
    clientId ? prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId }, select: U.CLIENT_LITE }) : null,
    listingId ? prisma.listing.findFirst({ where: { id: listingId, workspaceId: ctx.workspaceId } }) : null,
  ]);
  if (clientId && !client) throw new Error(`No client with id ${clientId}.`);
  const start = new Date(startAt);
  const Cal = svc.calendar();
  let appt;
  if (Cal && typeof Cal.createAppointment === 'function') {
    appt = await Cal.createAppointment({
      workspaceId: ctx.workspaceId, userId: ctx.userId || null, type: t, title: (title && String(title).trim()) || apptTitle(t, client, listing),
      clientId: client ? client.id : null, dealId, listingId: listing ? listing.id : null, startAt: start, endAt: endAt || undefined,
      durationMin: durationMin || undefined, location: location || undefined, notes, source, actor: ctx.actor || 'ai',
    });
  } else {
    const end = endAt ? new Date(endAt) : new Date(start.getTime() + (durationMin || 60) * 60000);
    appt = await prisma.appointment.create({
      data: {
        workspaceId: ctx.workspaceId, userId: ctx.userId || null, clientId, listingId: listing ? listing.id : null, dealId,
        type: t, title: (title && String(title).trim()) || apptTitle(t, client, listing), notes,
        location: location || (listing ? [U.addressOf(listing), listing.city].filter(Boolean).join(', ') : null),
        startAt: start, endAt: end, status: 'scheduled', source,
      },
    });
    broadcast(ctx, 'appointment_updated', { appointment: appt, action: 'created' });
    if (clientId) await activity(ctx, { clientId, listingId: appt.listingId, type: ['showing', 'private_tour', 'open_house'].includes(t) ? 'showing' : 'appointment', title: `${APPT_LABEL[t] || 'Appointment'} booked · ${U.fmtWhen(start, ctx.tz)}`, meta: { appointmentId: appt.id, source } });
  }
  planChanged(ctx, 'appointment');
  return { appointment: appt, client, listing, undo: { kind: 'delete_appointment', appointmentId: appt.id } };
}

async function updateAppointment(ctx, appointmentId, patch) {
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, workspaceId: ctx.workspaceId } });
  if (!a) throw new Error(`No appointment with id ${appointmentId}.`);
  const prev = { startAt: a.startAt, endAt: a.endAt, status: a.status, type: a.type, title: a.title, location: a.location, notes: a.notes };
  const p = {};
  if (patch.startAt) { p.startAt = new Date(patch.startAt); if (patch.endAt) p.endAt = new Date(patch.endAt); if (patch.durationMin) p.durationMin = patch.durationMin; }
  else if (patch.durationMin) p.durationMin = patch.durationMin;
  if (patch.status) p.status = patch.status;
  if (patch.type && APPT_TYPES.includes(patch.type)) p.type = patch.type;
  if (patch.location !== undefined) p.location = patch.location;
  if (patch.notes) p.notes = [a.notes, patch.notes].filter(Boolean).join('\n');
  let appointment;
  const Cal = svc.calendar();
  if (Cal && typeof Cal.updateAppointment === 'function') {
    appointment = await Cal.updateAppointment({ workspaceId: ctx.workspaceId, id: a.id, patch: p, actor: ctx.actor || 'ai' });
  } else {
    const data = { ...p };
    delete data.durationMin;
    if (p.startAt) data.endAt = p.endAt || new Date(p.startAt.getTime() + (p.durationMin ? p.durationMin * 60000 : (new Date(a.endAt) - new Date(a.startAt))));
    else if (p.durationMin) data.endAt = new Date(new Date(a.startAt).getTime() + p.durationMin * 60000);
    appointment = await prisma.appointment.update({ where: { id: a.id }, data });
    broadcast(ctx, 'appointment_updated', { appointment, action: 'updated' });
  }
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
  const D = svc.deals();
  let deal;
  if (D && typeof D.createDeal === 'function') {
    deal = await D.createDeal({
      workspaceId: ctx.workspaceId, clientId, side, stage: stage || undefined, title: title || undefined, price: price || undefined,
      propertyAddress: propertyAddress || undefined, listingId: listingId || undefined, portfolioPropertyId: portfolioPropertyId || undefined,
      closingDate: closingDate || undefined, notes: notes || undefined, actor: ctx.actor === 'agent' ? 'agent' : 'serena',
    });
  } else {
    const st = stage || (['listing', 'dual', 'lease_landlord'].includes(side) ? 'seller_lead' : 'new_lead');
    deal = await prisma.deal.create({ data: { workspaceId: ctx.workspaceId, clientId, side, stage: st, stageChangedAt: new Date(), title: title || propertyAddress || `${U.nameOf(client)} · ${side === 'buyer' ? 'Purchase' : 'Sale'}`, price, propertyAddress, listingId, portfolioPropertyId, closingDate: closingDate ? new Date(closingDate) : null, notes } });
    broadcast(ctx, 'deal_created', deal);
    await activity(ctx, { clientId, dealId: deal.id, type: 'deal_created', title: `Deal started · ${deal.title}`, meta: { dealId: deal.id, stage: deal.stage } });
  }
  return { deal, client, undo: { kind: 'delete_deal', dealId: deal.id } };
}

async function moveDeal(ctx, dealId, toStage) {
  const d = await prisma.deal.findFirst({ where: { id: dealId, workspaceId: ctx.workspaceId } });
  if (!d) throw new Error(`No deal with id ${dealId}.`);
  const S = svc.stages();
  let stage = toStage;
  let subStatus = null;
  if (S && S.canonicalize) {
    const c = S.canonicalize(toStage, d.side);
    if (!c || !c.stage) throw new Error(`"${toStage}" is not a pipeline stage.`);
    stage = c.stage; subStatus = c.subStatus || null;
  }
  const prev = { stage: d.stage, subStatus: d.subStatus, stageChangedAt: d.stageChangedAt, closedAt: d.closedAt, lostAt: d.lostAt };
  if (d.stage === stage && (!subStatus || d.subStatus === subStatus)) return { deal: d, unchanged: true, undo: null };
  const D = svc.deals();
  let deal;
  if (D && typeof D.moveDeal === 'function') {
    deal = await D.moveDeal({ workspaceId: ctx.workspaceId, dealId: d.id, stage, ...(subStatus ? { subStatus } : {}), actor: ctx.actor === 'agent' ? 'agent' : 'serena' });
  } else {
    const data = { stage, subStatus, stageChangedAt: new Date() };
    if (stage === 'closed' && !d.closedAt) data.closedAt = new Date();
    if (stage === 'lost' && !d.lostAt) data.lostAt = new Date();
    deal = await prisma.deal.update({ where: { id: d.id }, data });
    broadcast(ctx, 'deal_updated', deal);
    await activity(ctx, { clientId: d.clientId, dealId: d.id, type: stage === 'closed' ? 'deal_closed' : 'deal_stage_change', title: `${deal.title || 'Deal'} → ${stage.replace(/_/g, ' ')}`, meta: { dealId: d.id, from: d.stage, to: stage } });
  }
  return { deal, prev, undo: { kind: 'restore_deal_stage', dealId: d.id, prev } };
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
// Services log their own timeline rows; undo removes the rows that point at
// the undone entity (meta.<key> === id), created in the last hour.
async function dropActivitiesByMeta(ctx, key, id) {
  if (!id) return;
  await prisma.activity.deleteMany({ where: { workspaceId: ctx.workspaceId, createdAt: { gte: new Date(Date.now() - 3600e3) }, meta: { path: [key], equals: id } } }).catch(() => {});
}

async function applyUndo(ctx, u) {
  if (!u || !u.kind) throw new Error('Nothing to undo.');
  const wid = ctx.workspaceId;
  switch (u.kind) {
    case 'delete_task': {
      const t = await prisma.task.findFirst({ where: { id: u.taskId, workspaceId: wid } });
      if (t) {
        const T = svc.tasks();
        if (T && typeof T.deleteTask === 'function') await T.deleteTask({ workspaceId: wid, id: t.id });
        else { await prisma.task.delete({ where: { id: t.id } }); broadcast(ctx, 'task_updated', { id: t.id, action: 'deleted' }); }
      }
      await dropActivities(ctx, u.activityIds);
      await dropActivitiesByMeta(ctx, 'taskId', u.taskId);
      planChanged(ctx, 'task');
      return { ok: true };
    }
    case 'restore_task': {
      const t = await prisma.task.findFirst({ where: { id: u.taskId, workspaceId: wid } });
      if (!t) throw new Error('That to-do no longer exists.');
      const T = svc.tasks();
      if (T && typeof T.updateTask === 'function') await T.updateTask({ workspaceId: wid, id: t.id, patch: { status: u.prev.status || 'pending' }, actor: 'agent' });
      else {
        const task = await prisma.task.update({ where: { id: t.id }, data: { status: u.prev.status, completedAt: u.prev.completedAt ? new Date(u.prev.completedAt) : null } });
        broadcast(ctx, 'task_updated', { task, action: 'updated' });
      }
      await dropActivities(ctx, u.activityIds);
      await prisma.activity.deleteMany({ where: { workspaceId: wid, type: 'task_done', meta: { path: ['taskId'], equals: t.id } } }).catch(() => {});
      planChanged(ctx, 'task');
      return { ok: true };
    }
    case 'delete_appointment': {
      const a = await prisma.appointment.findFirst({ where: { id: u.appointmentId, workspaceId: wid } });
      if (a) {
        const Cal = svc.calendar();
        if (Cal && typeof Cal.deleteAppointment === 'function') await Cal.deleteAppointment({ workspaceId: wid, id: a.id });
        else { await prisma.appointment.delete({ where: { id: a.id } }); broadcast(ctx, 'appointment_updated', { id: a.id, action: 'deleted', appointment: { id: a.id, startAt: a.startAt } }); }
      }
      await dropActivities(ctx, u.activityIds);
      await dropActivitiesByMeta(ctx, 'appointmentId', u.appointmentId);
      planChanged(ctx, 'appointment');
      return { ok: true };
    }
    case 'restore_appointment': {
      const a = await prisma.appointment.findFirst({ where: { id: u.appointmentId, workspaceId: wid } });
      if (!a) throw new Error('That appointment no longer exists.');
      const p = u.prev;
      const Cal = svc.calendar();
      if (Cal && typeof Cal.updateAppointment === 'function') {
        await Cal.updateAppointment({ workspaceId: wid, id: a.id, patch: { startAt: new Date(p.startAt), endAt: new Date(p.endAt), status: p.status, type: p.type, title: p.title, location: p.location, notes: p.notes }, actor: 'agent' });
      } else {
        const appointment = await prisma.appointment.update({ where: { id: a.id }, data: { startAt: new Date(p.startAt), endAt: new Date(p.endAt), status: p.status, type: p.type, title: p.title, location: p.location, notes: p.notes } });
        broadcast(ctx, 'appointment_updated', { appointment, action: 'updated' });
      }
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
        const D = svc.deals();
        await dropActivitiesByMeta(ctx, 'dealId', d.id);
        if (D && typeof D.deleteDeal === 'function') await D.deleteDeal({ workspaceId: wid, dealId: d.id });
        else { await prisma.deal.delete({ where: { id: d.id } }); broadcast(ctx, 'deal_deleted', { id: d.id, clientId: d.clientId }); }
      }
      return { ok: true };
    }
    case 'restore_deal_stage': {
      const d = await prisma.deal.findFirst({ where: { id: u.dealId, workspaceId: wid } });
      if (!d) throw new Error('That deal no longer exists.');
      const p = u.prev;
      const D = svc.deals();
      if (D && typeof D.moveDeal === 'function') {
        await D.moveDeal({ workspaceId: wid, dealId: d.id, stage: p.stage, ...(p.subStatus ? { subStatus: p.subStatus } : {}), actor: 'agent' });
      } else {
        const deal = await prisma.deal.update({ where: { id: d.id }, data: { stage: p.stage, subStatus: p.subStatus, stageChangedAt: p.stageChangedAt ? new Date(p.stageChangedAt) : new Date(), closedAt: p.closedAt ? new Date(p.closedAt) : null, lostAt: p.lostAt ? new Date(p.lostAt) : null } });
        broadcast(ctx, 'deal_updated', deal);
      }
      await dropActivities(ctx, u.activityIds);
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
