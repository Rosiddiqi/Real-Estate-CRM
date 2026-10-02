#!/usr/bin/env node
// KeyMatch demo seed — idempotent. Finds the demo workspace by the demo user's
// email, deletes every row scoped to it, and rebuilds a live-looking book for
// Alex Morgan (luxury Miami). All dates are relative to the moment it runs
// (America/New_York); randomness is seeded so runs are reproducible.
//
//   cd server && npm run seed
const T0 = Date.now();
const prisma = require('../../src/lib/prisma');
const { hashPassword } = require('../../src/lib/auth');
const { bootstrapWorkspace } = require('../../src/services/workspaceBootstrap');
const { uid, makeRng, createCtx } = require('./util');
const A = require('./build_a');
const B = require('./build_b');
const { buildActivities, applyClientStats } = require('./derive');

const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'demo@keymatch.app').toLowerCase();
const DEMO_PASSWORD = 'keymatch';
const WS = uid('workspace:demo');
const USER = uid('user:demo');

async function wipe(wsIds) {
  const where = { workspaceId: { in: wsIds } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const staleUserIds = users.map((u) => u.id).filter((id) => id !== USER);
  await prisma.$transaction([
    prisma.reaction.deleteMany({ where }), prisma.attachment.deleteMany({ where }), prisma.message.deleteMany({ where }),
    prisma.outboundQueue.deleteMany({ where }), prisma.conversation.deleteMany({ where }),
    prisma.dealEvent.deleteMany({ where }), prisma.deal.deleteMany({ where }),
    prisma.match.deleteMany({ where }), prisma.matchFeedback.deleteMany({ where }),
    prisma.listingPriceEvent.deleteMany({ where: { listing: { workspaceId: { in: wsIds } } } }),
    prisma.listing.deleteMany({ where }), prisma.listingSource.deleteMany({ where }),
    prisma.waitlistEntry.deleteMany({ where: { waitlist: { workspaceId: { in: wsIds } } } }), prisma.waitlist.deleteMany({ where }),
    prisma.campaignRecipient.deleteMany({ where }), prisma.campaign.deleteMany({ where }),
    prisma.planMove.deleteMany({ where }), prisma.planDay.deleteMany({ where }), prisma.planSuppression.deleteMany({ where }),
    prisma.planHandled.deleteMany({ where }), prisma.planBlockOverride.deleteMany({ where }), prisma.selfRule.deleteMany({ where }),
    prisma.aiFeedback.deleteMany({ where }), prisma.serenaMessage.deleteMany({ where }), prisma.serenaThread.deleteMany({ where }),
    prisma.serenaMemory.deleteMany({ where }), prisma.aiInsight.deleteMany({ where }), prisma.aiUsage.deleteMany({ where }),
    prisma.phoneCall.deleteMany({ where }), prisma.note.deleteMany({ where }), prisma.task.deleteMany({ where }),
    prisma.appointment.deleteMany({ where }), prisma.activity.deleteMany({ where }),
    prisma.portfolioProperty.deleteMany({ where }), prisma.buyerSearch.deleteMany({ where }), prisma.clientLink.deleteMany({ where }),
    prisma.client.deleteMany({ where }), prisma.notification.deleteMany({ where }), prisma.mediaFile.deleteMany({ where }),
    prisma.importJob.deleteMany({ where }), prisma.bridge.deleteMany({ where }), prisma.payPlan.deleteMany({ where }),
    prisma.workSchedule.deleteMany({ where }), prisma.pushSubscription.deleteMany({ where: { userId: { in: staleUserIds } } }),
    prisma.user.deleteMany({ where }), prisma.workspace.deleteMany({ where: { id: { in: wsIds } } }),
  ]);
}

async function main() {
  // SEED_NOW (ISO) lets you preview the demo as of another moment; default is now.
  const ctx = createCtx(process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date());
  const rng = makeRng(20261002);
  const S = { ctx, rng, WS, USER };

  // ── Data modules (deals first: they register the named date offsets)
  const dealDefs = require('./deals')(ctx);
  S.closedPlan = Object.fromEntries(dealDefs.filter((d) => d.closed).map((d) => [d.key, { at: d.closedAt, salePrice: d.salePrice }]));
  const clientDefs = [...require('./clients_core')(ctx), ...require('./clients_rest')(ctx)];
  const listingDefs = [...require('./listings_own')(), ...require('./listings_mls')()];
  const { props: propDefs, searches: searchDefs } = require('./portfolio')(ctx);
  const { moreThreads, injections } = require('./threads_more');
  const threadDefs = [...require('./threads_hero')(), ...moreThreads()];
  const { calls: callDefs, notes: noteDefs } = require('./calls')();
  const engage = require('./engage')(ctx);

  // ── Wipe the previous demo workspace (and only it)
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { workspaceId: true } });
  const wsIds = [...new Set([WS, existing && existing.workspaceId].filter(Boolean))];
  await wipe(wsIds);

  // ── Workspace, user, defaults
  await prisma.workspace.create({ data: { id: WS, name: 'Alex Morgan · Luxury Homes', brokerageName: 'Harbor & Key Realty', officeName: 'Coconut Grove', market: 'Miami · South Florida', timezone: ctx.TZ, settings: engage.profile.workspaceSettings } });
  await prisma.user.create({
    data: {
      id: USER, workspaceId: WS, email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD), firstName: 'Alex', lastName: 'Morgan', phone: '3055550100',
      title: 'Luxury Real Estate Advisor', licenseNumber: 'SL3497126', role: 'owner', timezone: ctx.TZ, lastLoginAt: ctx.minsAgo(95),
      preferences: engage.profile.user.preferences, onboarding: engage.profile.user.onboarding, aiPreferences: engage.profile.user.aiPreferences,
      createdAt: ctx.daysAgo(420),
    },
  });
  await bootstrapWorkspace(WS, USER);
  await prisma.payPlan.updateMany({ where: { workspaceId: WS }, data: { goals: engage.profile.payPlanGoals, effectiveFrom: ctx.yearStart } });
  await prisma.workSchedule.update({
    where: { userId: USER },
    data: { routine: [
      { id: 'school-run', title: 'School run', start: '07:30', durationMin: 60, days: [1, 2, 3, 4, 5], kind: 'personal' },
      { id: 'inbox-zero', title: 'Inbox + replies', start: '08:30', durationMin: 30, days: [1, 2, 3, 4, 5, 6], kind: 'work' },
    ] },
  });
  const srcRows = await prisma.listingSource.findMany({ where: { workspaceId: WS } });
  S.sources = Object.fromEntries(srcRows.map((s) => [s.kind, s.id]));
  
  // ── Build every row in memory
  const clients = A.buildClients(S, clientDefs);
  const { rows: listings, events: priceEvents } = A.buildListings(S, listingDefs);
  const props = A.buildPortfolio(S, propDefs);
  const searches = A.buildSearches(S, searchDefs);
  const { rows: deals, events: dealEvents } = A.buildDeals(S, dealDefs);
  const { conv, msgs, atts, reacts } = B.buildThreads(S, threadDefs, injections());
  const calls = B.buildCalls(S, callDefs);
  const notes = B.buildNotes(S, noteDefs);
  const cal = require('./calendar')(ctx, S.asks);
  const tasks = B.buildTasks(S, cal.tasks);
  const appts = B.buildAppointments(S, cal.appts);
  const { rows: campaigns, recips } = B.buildCampaigns(S, engage.campaigns);
  const { rows: waitlists, entries } = B.buildWaitlists(S, engage.waitlists);
  const notifications = B.buildNotifications(S, engage.notifications);
  const serena = B.buildSerena(S, engage.serena);
  const insights = B.buildInsights(S, engage.insights);
  applyClientStats(S, clients, { calls, appts });
  await prisma.listingSource.updateMany({ where: { workspaceId: WS, kind: 'mls' }, data: { lastSyncedAt: ctx.minsAgo(18), lastSyncOkAt: ctx.minsAgo(18), meta: { feed: 'Miami MLS (demo)', listings: listings.filter((l) => l.sourceId === S.sources.mls).length } } });
  const activities = buildActivities(S, { campaigns, calls, notes, appts, props, searches, tasks });

  const links = [
    ['julien', 'camille', 'Married; Camille drives timing questions, Julien drives price.'],
    ['graham', 'sloane', 'Married; Graham handles numbers, Sloane handles the house.'],
    ['ethan', 'mara', 'Married; three kids — Jack, Sadie, Wren.'],
  ].map(([a, b, n]) => ({ id: uid(`link:${a}:${b}`), workspaceId: WS, clientId: S.clientId[a], relatedClientId: S.clientId[b], relation: 'spouse', notes: n, createdAt: ctx.daysAgo(30) }));

  // ── Insert (parents before children)
  const strip = (rows) => rows.map(({ fullAddress, ...r }) => r);
  await prisma.client.createMany({ data: clients });
  await prisma.$transaction(clientDefs.filter((d) => d.referredBy).map((d) => prisma.client.update({ where: { id: S.clientId[d.key] }, data: { referredById: S.clientId[d.referredBy] } })));
  await prisma.clientLink.createMany({ data: links });
  await prisma.listing.createMany({ data: strip(listings) });
  await prisma.listingPriceEvent.createMany({ data: priceEvents });
  await prisma.portfolioProperty.createMany({ data: props });
  await prisma.buyerSearch.createMany({ data: searches });
  await prisma.deal.createMany({ data: deals });
  await prisma.dealEvent.createMany({ data: dealEvents });
  await prisma.conversation.createMany({ data: conv });
  await prisma.message.createMany({ data: msgs });
  await prisma.attachment.createMany({ data: atts });
  await prisma.reaction.createMany({ data: reacts });
  await prisma.phoneCall.createMany({ data: calls });
  await prisma.note.createMany({ data: notes });
  await prisma.task.createMany({ data: tasks });
  await prisma.appointment.createMany({ data: appts });
  await prisma.campaign.createMany({ data: campaigns });
  await prisma.campaignRecipient.createMany({ data: recips });
  await prisma.waitlist.createMany({ data: waitlists });
  await prisma.waitlistEntry.createMany({ data: entries });
  await prisma.notification.createMany({ data: notifications });
  await prisma.serenaThread.create({ data: serena.thread });
  await prisma.serenaMessage.createMany({ data: serena.messages });
  await prisma.serenaMemory.createMany({ data: serena.memories });
  await prisma.aiInsight.createMany({ data: insights });
  await prisma.activity.createMany({ data: activities });

  // ── Report
  const w = { workspaceId: WS };
  const counts = {
    Workspace: await prisma.workspace.count({ where: { id: WS } }), User: await prisma.user.count({ where: w }),
    PayPlan: await prisma.payPlan.count({ where: w }), WorkSchedule: await prisma.workSchedule.count({ where: w }), ListingSource: await prisma.listingSource.count({ where: w }),
    Client: await prisma.client.count({ where: w }), ClientLink: await prisma.clientLink.count({ where: w }),
    PortfolioProperty: await prisma.portfolioProperty.count({ where: w }), BuyerSearch: await prisma.buyerSearch.count({ where: w }),
    Listing: await prisma.listing.count({ where: w }), ListingPriceEvent: await prisma.listingPriceEvent.count({ where: { listing: w } }),
    Deal: await prisma.deal.count({ where: w }), DealEvent: await prisma.dealEvent.count({ where: w }),
    Conversation: await prisma.conversation.count({ where: w }), Message: await prisma.message.count({ where: w }),
    Attachment: await prisma.attachment.count({ where: w }), Reaction: await prisma.reaction.count({ where: w }),
    PhoneCall: await prisma.phoneCall.count({ where: w }), Note: await prisma.note.count({ where: w }), Task: await prisma.task.count({ where: w }),
    Appointment: await prisma.appointment.count({ where: w }), Campaign: await prisma.campaign.count({ where: w }), CampaignRecipient: await prisma.campaignRecipient.count({ where: w }),
    Waitlist: await prisma.waitlist.count({ where: w }), WaitlistEntry: await prisma.waitlistEntry.count({ where: { waitlist: w } }),
    Notification: await prisma.notification.count({ where: w }), SerenaThread: await prisma.serenaThread.count({ where: w }),
    SerenaMessage: await prisma.serenaMessage.count({ where: w }), SerenaMemory: await prisma.serenaMemory.count({ where: w }),
    AiInsight: await prisma.aiInsight.count({ where: w }), Activity: await prisma.activity.count({ where: w }),
  };
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n[seed] KeyMatch demo workspace ready — ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`[seed] anchored to ${ctx.today} (${ctx.TZ}) · workspace ${WS}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${pad(k, 20)} ${v}`);
  console.log(`[seed] done in ${((Date.now() - T0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((err) => { console.error('[seed] failed:', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
