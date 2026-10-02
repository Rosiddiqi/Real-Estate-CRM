// Serena WRITE tools — execute immediately (the agent approves by not
// undoing) and return a receipt card with a server-side undo payload.
// run() returns { ...resultForModel, __card: { category, label, title, meta, open, undo } }.
const prisma = require('../../../lib/prisma');
const { dayKey } = require('../../../lib/dates');
const U = require('../util');
const T = require('../time');
const fx = require('../effects');

const tools = [];
const def = (t) => tools.push({ kind: 'write', ...t });

const who = (ctx, id, fallback = 'the client') => ctx.names.get(id) || fallback;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

function dueFrom(input, tz) {
  const date = input.due_date || input.date || null;
  const time = input.due_time || input.time || null;
  if (!date && !time) return { dueAt: null, dueDate: null };
  const day = T.parseDay(date, tz) || T.parseDay(time, tz) || dayKey(new Date(), tz);
  const t = T.parseTime(time) || (date ? T.parseTime(date) : null);
  if (!t) return { dueAt: null, dueDate: day };
  return { dueAt: T.resolveWhen({ date: day, time: `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` }, tz), dueDate: day };
}

def({
  name: 'create_task',
  description: 'Add a to-do to the agent\'s list. ALWAYS use for "remind me to…", "don\'t let me forget…", "I need to…", "I owe X…" and anything to DO with no fixed meeting time (send comps, pull the HOA docs, film the walkthrough, call the lender). Optional due date ("today", "tomorrow", "friday", YYYY-MM-DD) and time (HH:MM 24h).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Imperative, e.g. "Send the Delacroixs the HOA docs"' },
      client_id: { type: 'string' },
      due_date: { type: 'string' },
      due_time: { type: 'string', description: 'HH:MM 24h local' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      kind: { type: 'string', enum: ['call', 'text', 'email', 'showing', 'paperwork', 'follow_up', 'other'] },
      notes: { type: 'string' },
      deal_id: { type: 'string' },
    },
    required: ['title'],
  },
  activity: () => 'Adding it to your to-dos…',
  async run(input, ctx) {
    const { dueAt, dueDate } = dueFrom(input, ctx.tz);
    const { task, undo } = await fx.createTask(ctx, { title: input.title, clientId: input.client_id || null, dealId: input.deal_id || null, dueAt, dueDate, priority: input.priority || 'normal', kind: input.kind || null, notes: input.notes || null });
    const due = dueAt ? U.fmtWhen(dueAt, ctx.tz) : dueDate ? U.fmtDayKey(dueDate, ctx.tz) : null;
    return {
      ok: true, task_id: task.id, title: task.title, due_local: due,
      __card: { category: 'todo', label: 'To-do · added', title: task.title, meta: [due ? `Due ${due.replace(' · ', ', ').replace(/^(Today|Tomorrow)/, (m) => m.toLowerCase())}` : 'No due date', input.client_id ? who(ctx, input.client_id, null) : null].filter(Boolean).join(' · '), open: { type: 'todo', id: task.id, clientId: input.client_id || null }, undo },
    };
  },
});

def({
  name: 'complete_task',
  description: 'Mark a to-do done. Find the task_id with list_tasks first.',
  input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  activity: () => 'Checking that off…',
  async run(input, ctx) {
    const { task, already, undo } = await fx.completeTask(ctx, { taskId: input.task_id });
    if (already) return { ok: true, note: 'Already done.', task_id: task.id };
    return { ok: true, task_id: task.id, title: task.title, __card: { category: 'todo', label: 'To-do · done', title: task.title, meta: 'Checked off', undo } };
  },
});

def({
  name: 'create_appointment',
  description: 'Book an appointment on the agent\'s calendar (anything with a real time). Types: showing, private_tour, open_house, broker_open, listing_presentation, buyer_consult, inspection, appraisal, final_walkthrough, closing, call, video, meeting, content, personal. Pass date as "today"/"tomorrow"/weekday/YYYY-MM-DD and time as HH:MM 24h local — the server resolves the time zone. Resolve the client first.',
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string' },
      type: { type: 'string' },
      date: { type: 'string' },
      time: { type: 'string', description: 'HH:MM 24h local, default 09:00' },
      duration_minutes: { type: 'integer' },
      title: { type: 'string', description: 'Optional; auto-generated from type + client + property' },
      listing_id: { type: 'string' },
      deal_id: { type: 'string' },
      location: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['type', 'date'],
  },
  activity: (i, ctx) => `Booking ${(fx.APPT_LABEL[i.type] || 'the appointment').toLowerCase()}${i.client_id && ctx.names.get(i.client_id) ? ` with ${ctx.names.get(i.client_id)}` : ''}…`,
  async run(input, ctx) {
    const startAt = T.resolveWhen({ date: input.date, time: input.time }, ctx.tz);
    const { appointment, client, undo } = await fx.createAppointment(ctx, {
      clientId: input.client_id || null, listingId: input.listing_id || null, dealId: input.deal_id || null,
      type: input.type, title: input.title || null, startAt, durationMin: input.duration_minutes || (input.type === 'call' ? 30 : 60),
      location: input.location || null, notes: input.notes || null,
    });
    if (client) ctx.names.set(client.id, U.nameOf(client));
    const when = U.fmtWhen(appointment.startAt, ctx.tz);
    const dur = Math.round((new Date(appointment.endAt) - new Date(appointment.startAt)) / 60000);
    return {
      ok: true, appointment_id: appointment.id, title: appointment.title, when_local: when, duration_min: dur,
      __card: { category: 'calendar', label: 'Calendar · booked', title: appointment.title, meta: `${when.replace(' · ', ', ')} · ${dur} min`, open: { type: 'appointment', id: appointment.id }, undo },
    };
  },
});

def({
  name: 'reschedule_appointment',
  description: 'Move an appointment to a new date/time (keeps its length unless duration_minutes is given). Find the id with todays_schedule or list_appointments.',
  input_schema: { type: 'object', properties: { appointment_id: { type: 'string' }, date: { type: 'string' }, time: { type: 'string', description: 'HH:MM 24h local' }, duration_minutes: { type: 'integer' } }, required: ['appointment_id'] },
  activity: () => 'Moving it on your calendar…',
  async run(input, ctx) {
    const a = await prisma.appointment.findFirst({ where: { id: input.appointment_id, workspaceId: ctx.workspaceId } });
    if (!a) throw new Error(`No appointment with id ${input.appointment_id}.`);
    const curDay = dayKey(a.startAt, ctx.tz);
    const curTime = T.localHM(a.startAt, ctx.tz);
    const startAt = (input.date || input.time) ? T.resolveWhen({ date: input.date || curDay, time: input.time || curTime }, ctx.tz) : null;
    const { appointment, prev, undo } = await fx.updateAppointment(ctx, a.id, { startAt, durationMin: input.duration_minutes || null });
    const when = U.fmtWhen(appointment.startAt, ctx.tz);
    return {
      ok: true, appointment_id: appointment.id, new_when_local: when, previous_when_local: U.fmtWhen(prev.startAt, ctx.tz),
      __card: { category: 'calendar', label: 'Calendar · moved', title: appointment.title, meta: `Now ${when.replace(' · ', ', ')} · was ${U.fmtWhen(prev.startAt, ctx.tz).replace(' · ', ', ')}`, open: { type: 'appointment', id: appointment.id }, undo },
    };
  },
});

def({
  name: 'cancel_appointment',
  description: 'Cancel an appointment (soft — it can be restored with Undo).',
  input_schema: { type: 'object', properties: { appointment_id: { type: 'string' }, reason: { type: 'string' } }, required: ['appointment_id'] },
  activity: () => 'Cancelling it…',
  async run(input, ctx) {
    const { appointment, undo } = await fx.updateAppointment(ctx, input.appointment_id, { status: 'cancelled', notes: input.reason ? `Cancelled: ${input.reason}` : null });
    return {
      ok: true, appointment_id: appointment.id,
      __card: { category: 'calendar', label: 'Calendar · cancelled', title: appointment.title, meta: `${U.fmtWhen(appointment.startAt, ctx.tz).replace(' · ', ', ')}${input.reason ? ` · ${U.clip(input.reason, 60)}` : ''}`, open: { type: 'appointment', id: appointment.id }, undo },
    };
  },
});

def({
  name: 'add_note',
  description: 'Save a note on a client\'s timeline ("log", "note", "remember about him that…"). Facts about the client belong here. Never record protected-class information (Fair Housing).',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, text: { type: 'string' } }, required: ['client_id', 'text'] },
  activity: (i, ctx) => `Saving a note to ${who(ctx, i.client_id, 'their')}${ctx.names.get(i.client_id) ? '’s' : ''} file…`,
  async run(input, ctx) {
    const c = await U.getClientLite(ctx.workspaceId, input.client_id);
    if (!c) throw new Error(`No client with id ${input.client_id}.`);
    const { note, undo } = await fx.addNote(ctx, { clientId: c.id, body: input.text });
    return { ok: true, note_id: note.id, __card: { category: 'note', label: 'Note · saved', title: U.nameOf(c), meta: `“${U.clip(note.body, 90)}”`, open: { type: 'client', id: c.id }, undo } };
  },
});

def({
  name: 'update_client',
  description: 'Update a client\'s record: rating (0-5 stars), whale flag, status (lead|active|past_client|sphere|inactive), type (buyer|seller|buyer_seller|investor|renter|landlord|developer|sphere), tags to add/remove, financing (cash_pof|preapproved|prequalified|contingent|unknown), pre-approval amount, lender, timeline (asap|30d|90d|6mo|12mo|someday), motivation, contact info, birthday (YYYY-MM-DD or MM-DD), neighborhood/city. Only send fields that change.',
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string' },
      rating: { type: 'integer' }, is_whale: { type: 'boolean' }, status: { type: 'string' }, type: { type: 'string' },
      add_tags: { type: 'array', items: { type: 'string' } }, remove_tags: { type: 'array', items: { type: 'string' } },
      financing: { type: 'string' }, pre_approval_amount: { type: 'integer' }, lender_name: { type: 'string' },
      timeline: { type: 'string' }, motivation: { type: 'string' },
      first_name: { type: 'string' }, last_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
      company: { type: 'string' }, job_title: { type: 'string' }, birthday: { type: 'string' }, neighborhood: { type: 'string' }, city: { type: 'string' },
      lead_source: { type: 'string' },
    },
    required: ['client_id'],
  },
  activity: (i, ctx) => `Updating ${who(ctx, i.client_id, 'the client')}…`,
  async run(input, ctx) {
    const c = await prisma.client.findFirst({ where: { id: input.client_id, workspaceId: ctx.workspaceId } });
    if (!c) throw new Error(`No client with id ${input.client_id}.`);
    const map = { rating: 'rating', is_whale: 'isWhale', status: 'status', type: 'type', financing: 'financing', pre_approval_amount: 'preApprovalAmount', lender_name: 'lenderName', timeline: 'timeline', motivation: 'motivation', first_name: 'firstName', last_name: 'lastName', phone: 'phone', email: 'email', company: 'company', job_title: 'jobTitle', birthday: 'birthday', neighborhood: 'neighborhood', city: 'city', lead_source: 'leadSource' };
    const patch = {};
    for (const [k, f] of Object.entries(map)) if (input[k] !== undefined && input[k] !== null) patch[f] = input[k];
    if (input.add_tags || input.remove_tags) {
      const set = new Set(c.tags || []);
      for (const t of input.add_tags || []) set.add(String(t).trim());
      for (const t of input.remove_tags || []) set.delete(String(t).trim());
      patch.tags = [...set].filter(Boolean);
    }
    const { client, changed, prev, undo } = await fx.updateClient(ctx, c.id, patch);
    if (!changed.length) return { ok: true, note: 'Nothing changed — those values were already set.' };
    const describe = (f) => {
      if (f === 'rating') return stars(client.rating);
      if (f === 'isWhale') return client.isWhale ? 'Whale' : 'Not a whale';
      if (f === 'tags') return `Tags: ${(client.tags || []).join(', ') || 'none'}`;
      if (f === 'preApprovalAmount') return `Pre-approved ${U.moneyCompact(client.preApprovalAmount)}`;
      return `${U.titleCase(f.replace(/([A-Z])/g, ' $1'))}: ${client[f]}`;
    };
    return {
      ok: true, changed, previous: prev,
      __card: { category: 'contact', label: changed.length === 1 && changed[0] === 'rating' ? 'Client · rated' : 'Client · updated', title: U.nameOf(client), meta: changed.map(describe).join(' · '), open: { type: 'client', id: client.id }, undo },
    };
  },
});

def({
  name: 'create_client',
  description: 'Add a new client/contact to the book (checks for an existing phone first). E.g. "add a new buyer, Diane Park, 415 555 0147".',
  input_schema: { type: 'object', properties: { first_name: { type: 'string' }, last_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, type: { type: 'string' }, lead_source: { type: 'string' }, notes: { type: 'string' }, kind: { type: 'string', enum: ['client', 'partner', 'vendor'] } } },
  activity: (i) => `Adding ${[i.first_name, i.last_name].filter(Boolean).join(' ') || 'the contact'} to your book…`,
  async run(input, ctx) {
    const { client, existing, undo } = await fx.createClient(ctx, { firstName: input.first_name, lastName: input.last_name, phone: input.phone, email: input.email, type: input.type || 'buyer', leadSource: input.lead_source || null, notes: input.notes || null, contactKind: input.kind || 'client' });
    ctx.names.set(client.id, U.nameOf(client));
    if (existing) return { ok: true, existing: true, client_id: client.id, note: `${U.nameOf(client)} is already in the book with that number.` };
    return { ok: true, client_id: client.id, __card: { category: 'contact', label: 'Client · added', title: U.nameOf(client), meta: [client.phone ? U.formatPhone(client.phone) : null, client.email, U.titleCase(client.type)].filter(Boolean).join(' · '), open: { type: 'client', id: client.id }, undo } };
  },
});

def({
  name: 'create_deal',
  description: 'Start a deal in the pipeline for a client. side: buyer | listing | dual | lease_tenant | lease_landlord | referral_out | referral_in. Optional starting stage key, price, property address or listing_id.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, side: { type: 'string' }, stage: { type: 'string' }, price: { type: 'integer' }, property_address: { type: 'string' }, listing_id: { type: 'string' }, title: { type: 'string' }, closing_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['client_id'] },
  activity: (i, ctx) => `Opening a deal for ${who(ctx, i.client_id)}…`,
  async run(input, ctx) {
    const { deal, client, undo } = await fx.createDeal(ctx, { clientId: input.client_id, side: input.side || 'buyer', stage: input.stage || null, price: input.price || null, propertyAddress: input.property_address || null, listingId: input.listing_id || null, title: input.title || null, closingDate: input.closing_date || null });
    const { stageLabel } = require('./read');
    return {
      ok: true, deal_id: deal.id, stage: deal.stage,
      __card: { category: 'pipeline', label: 'Pipeline · deal started', title: deal.title || U.nameOf(client), meta: [U.nameOf(client), stageLabel(deal.stage, deal.side), deal.price ? U.moneyCompact(deal.price) : null].filter(Boolean).join(' · '), open: { type: 'deal', id: deal.id }, undo },
    };
  },
});

def({
  name: 'move_deal_stage',
  description: 'Move a deal to another pipeline stage (buyer: new_lead → consultation → touring → offer_submitted → under_contract → closed; listing: seller_lead → listing_appt → active → offer_received → under_contract → closed; or lost). Sub-statuses like inspection/appraisal/financing are accepted and land under_contract. Moving to closed books GCI: ONLY do it when the agent explicitly confirmed the closing in this conversation — set confirm_close true; otherwise ask first.',
  input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, stage: { type: 'string' }, confirm_close: { type: 'boolean' } }, required: ['deal_id', 'stage'] },
  activity: () => 'Updating the pipeline…',
  async run(input, ctx) {
    const target = String(input.stage || '').toLowerCase().trim();
    if (['closed', 'won', 'sold', 'funded', 'recorded'].includes(target) && !input.confirm_close) {
      return { ok: false, needs_confirmation: true, message: 'Closing a deal books GCI. Ask the agent to confirm it actually closed (and the final price) before moving it to Closed.' };
    }
    const { deal, prev, unchanged, undo } = await fx.moveDeal(ctx, input.deal_id, target);
    if (unchanged) return { ok: true, note: `Already in ${deal.stage}.` };
    const { stageLabel } = require('./read');
    return {
      ok: true, deal_id: deal.id, stage: deal.stage, previous_stage: prev.stage,
      __card: { category: 'pipeline', label: deal.stage === 'closed' ? 'Pipeline · closed' : 'Pipeline · stage', title: deal.title || 'Deal', meta: `${stageLabel(deal.stage, deal.side)} · was ${stageLabel(prev.stage, deal.side)}`, open: { type: 'deal', id: deal.id }, undo },
    };
  },
});

def({
  name: 'add_buyer_search',
  description: 'Save buyer criteria (a wishlist / active search) on a client so the matchmaker scores listings against it. Only property attributes and explicitly named locations — never demographic or protected-class preferences (Fair Housing).',
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string' }, name: { type: 'string' }, bucket: { type: 'string', enum: ['active', 'dream'] },
      markets: { type: 'array', items: { type: 'string' }, description: 'Cities/markets' },
      neighborhoods: { type: 'array', items: { type: 'string' } }, buildings: { type: 'array', items: { type: 'string' } },
      property_types: { type: 'array', items: { type: 'string' }, description: 'single_family, condo, townhouse, estate, penthouse, villa, land' },
      price_min: { type: 'integer' }, price_max: { type: 'integer' }, beds_min: { type: 'integer' }, baths_min: { type: 'number' }, sqft_min: { type: 'integer' },
      waterfront: { type: 'array', items: { type: 'string' }, description: 'oceanfront, bayfront, intracoastal, canal, lake, any' },
      views: { type: 'array', items: { type: 'string' } },
      must_haves: { type: 'array', items: { type: 'string' }, description: 'pool, dock, gated, elevator, wine cellar…' },
      timeline: { type: 'string' }, financing: { type: 'string' }, notes: { type: 'string' },
    },
    required: ['client_id'],
  },
  activity: (i, ctx) => `Saving ${who(ctx, i.client_id, 'their')}${ctx.names.get(i.client_id) ? '’s' : ''} search…`,
  async run(input, ctx) {
    const { search, client, undo } = await fx.addBuyerSearch(ctx, input.client_id, {
      name: input.name, bucket: input.bucket, markets: input.markets, neighborhoods: input.neighborhoods, buildings: input.buildings, propertyTypes: input.property_types,
      priceMin: input.price_min, priceMax: input.price_max, bedsMin: input.beds_min, bathsMin: input.baths_min, sqftMin: input.sqft_min,
      waterfront: input.waterfront, views: input.views, mustHaves: input.must_haves, timeline: input.timeline, financing: input.financing, notes: input.notes,
    });
    const parts = [
      [...(search.neighborhoods || []), ...(search.markets || [])].slice(0, 3).join(', '),
      search.bedsMin ? `${search.bedsMin}+ bd` : null,
      search.priceMax ? `≤ ${U.moneyCompact(search.priceMax)}` : search.priceMin ? `${U.moneyCompact(search.priceMin)}+` : null,
      (input.must_haves || []).slice(0, 3).join(', '),
    ].filter(Boolean);
    return { ok: true, search_id: search.id, __card: { category: 'search', label: search.bucket === 'dream' ? 'Wishlist · dream added' : 'Wishlist · search added', title: U.nameOf(client), meta: parts.join(' · ') || 'New buyer search', open: { type: 'client', id: client.id }, undo } };
  },
});

def({
  name: 'add_portfolio_property',
  description: 'Add a property to a client\'s portfolio: what they own (owns), rent (rents), sold, are watching, or lease out (leased_out). Address, neighborhood, type, beds/baths/sqft, estimated value, purchase price/date, loan type/reset, lease end, thinking_of_selling.',
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string' }, relationship: { type: 'string', enum: ['owns', 'rents', 'sold', 'watching', 'leased_out'] },
      street: { type: 'string' }, unit: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, neighborhood: { type: 'string' }, building_name: { type: 'string' },
      property_type: { type: 'string' }, beds: { type: 'integer' }, baths: { type: 'number' }, sqft: { type: 'integer' }, year_built: { type: 'integer' },
      waterfront: { type: 'string' }, est_value: { type: 'integer' }, purchase_price: { type: 'integer' }, purchased_at: { type: 'string', description: 'YYYY-MM-DD' },
      loan_type: { type: 'string', enum: ['fixed', 'arm', 'interest_only', 'balloon', 'cash'] }, mortgage_rate: { type: 'number' }, loan_reset_at: { type: 'string' },
      lease_ends_at: { type: 'string' }, thinking_of_selling: { type: 'boolean' }, notes: { type: 'string' },
    },
    required: ['client_id'],
  },
  activity: (i, ctx) => `Adding it to ${who(ctx, i.client_id, 'their')}${ctx.names.get(i.client_id) ? '’s' : ''} portfolio…`,
  async run(input, ctx) {
    const { property, client, undo } = await fx.addPortfolioProperty(ctx, input.client_id, {
      relationship: input.relationship, street: input.street, unit: input.unit, city: input.city, state: input.state, neighborhood: input.neighborhood, buildingName: input.building_name,
      propertyType: input.property_type, beds: input.beds, baths: input.baths, sqft: input.sqft, yearBuilt: input.year_built, waterfront: input.waterfront,
      estValue: input.est_value, purchasePrice: input.purchase_price, purchasedAt: input.purchased_at, loanType: input.loan_type, mortgageRate: input.mortgage_rate,
      loanResetAt: input.loan_reset_at, leaseEndsAt: input.lease_ends_at, thinkingOfSelling: input.thinking_of_selling, notes: input.notes,
    });
    const label = { owns: 'owns', rents: 'rents', sold: 'sold', watching: 'watching', leased_out: 'leases out' }[property.relationship] || property.relationship;
    return { ok: true, property_id: property.id, __card: { category: 'portfolio', label: 'Portfolio · added', title: U.addressOf(property) || property.neighborhood || 'Property', meta: [`${U.nameOf(client)} ${label}`, property.neighborhood || property.city, property.estValue ? `est ${U.moneyCompact(property.estValue)}` : null].filter(Boolean).join(' · '), open: { type: 'client', id: client.id }, undo } };
  },
});

def({
  name: 'log_call_outcome',
  description: 'Log a phone call that happened outside KeyMatch (who, direction, how long, outcome, summary) onto the client\'s timeline.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, direction: { type: 'string', enum: ['outbound', 'inbound'] }, outcome: { type: 'string', description: 'connected | left_voicemail | no_answer | scheduled | not_interested | …' }, summary: { type: 'string' }, duration_minutes: { type: 'number' } }, required: ['client_id'] },
  activity: (i, ctx) => `Logging your call with ${who(ctx, i.client_id)}…`,
  async run(input, ctx) {
    const outcome = input.outcome || 'connected';
    const status = /voicemail/.test(outcome) ? 'voicemail' : /no.?answer/.test(outcome) ? 'no_answer' : 'completed';
    const { call, client, undo } = await fx.logCall(ctx, { clientId: input.client_id, direction: input.direction || 'outbound', status: input.direction === 'inbound' && status !== 'completed' ? 'missed' : status, durationSec: Math.round((input.duration_minutes || (status === 'completed' ? 5 : 0)) * 60), summary: input.summary || null, outcome });
    return { ok: true, call_id: call.id, __card: { category: 'call', label: 'Call · logged', title: U.nameOf(client), meta: [U.titleCase(outcome), call.durationSec ? `${Math.round(call.durationSec / 60)} min` : null, input.summary ? U.clip(input.summary, 60) : null].filter(Boolean).join(' · '), open: { type: 'client', id: client.id }, undo } };
  },
});

def({
  name: 'remember',
  description: 'Remember a durable fact or preference about the AGENT (how they like to work, goals, standing instructions) for future conversations. Client facts go on the client with add_note instead.',
  input_schema: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'goal', 'style'] } }, required: ['text'] },
  activity: () => 'Noting that for next time…',
  async run(input, ctx) {
    const { memory, existing, undo } = await fx.remember(ctx, { text: input.text, kind: input.kind || 'preference' });
    if (existing) return { ok: true, note: 'Already remembered.' };
    return { ok: true, memory_id: memory.id, __card: { category: 'memory', label: 'Memory · saved', title: U.clip(memory.text, 80), meta: 'I’ll keep this in mind', undo } };
  },
});

module.exports = { tools };
