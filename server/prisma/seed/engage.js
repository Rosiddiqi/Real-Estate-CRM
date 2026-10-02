// Campaigns, notifications, waitlists, Serena (thread + memory), AI insights,
// and the agent/workspace profile settings.
module.exports = function buildEngage(ctx) {
  const o = ctx.off;

  const campaigns = [
    {
      key: 'justlisted', name: 'Just Listed · 128 Sunset Drive', kind: 'blast', trigger: 'just_listed', status: 'completed', pacing: 'safe',
      audience: { types: ['buyer', 'investor', 'buyer_seller'], minRating: 3, tags: ['waterfront'], neighborhoods: ['Sunset Islands', 'Venetian Islands', 'La Gorce', 'Miami Beach'], minPurchasePower: 3000000, includePartners: false },
      brief: 'Announce 128 Sunset Drive to my waterfront buyers and a few past clients who talk. Lead with the 105 ft of open bay and the new 90-ft dock. Keep it short, no exclamation points, and offer private previews before the broker open.',
      steps: [{ dayOffset: 0, instructions: 'Personalize the first line; attach the dusk pool photo.', includePhoto: true }],
      lanes: {
        green: { label: 'Wants to see it', action: 'Book a private preview' },
        yellow: { label: 'Curious / has questions', action: 'Answer and send the floor plan' },
        red: { label: 'Not for them', action: 'Thank them; keep on the list unless they opt out' },
        aiReply: { mode: 'draft', instructions: 'Draft replies in my voice — short, warm, specific. Never discuss seller motivation or anything below list price.' },
        reminders: { enabled: false, noReplyAfterDays: 3 },
      },
      stats: { recipients: 18, sent: 18, delivered: 18, failed: 0, replied: 7, green: 2, yellow: 3, red: 2, optedOut: 1, previewsBooked: 2 },
      launchedAt: ctx.past(-8, 10, 15), completedAt: ctx.past(-8, 10, 44), createdAt: ctx.past(-9, 17, 30),
      recipients: [
        ['kenji', 'replied', 'green', [-8, '10:40']], ['malik', 'replied', 'green', [-8, '10:44']], ['tessa', 'replied', 'yellow', [-8, '10:49']],
        ['jonah', 'replied', 'yellow', [-8, '11:02']], ['leo', 'replied', 'yellow', [-8, '12:00']], ['victoria', 'replied', 'red', [-8, '10:58']], ['elena', 'replied', 'red', [-8, '10:57']],
        ['frederick', 'sent'], ['wes', 'sent'], ['daniel', 'sent'], ['lucas', 'sent'], ['rafael', 'sent'], ['nadia', 'sent'], ['bianca', 'sent'], ['ava', 'sent'], ['sebastian', 'sent'], ['adrian', 'sent'],
        ['stefan', 'opted_out', 'red', [-8, '10:44']],
      ],
    },
    {
      key: 'openhouse', name: 'Sunday Open House · La Gorce', kind: 'blast', trigger: 'open_house_invite', status: 'running', pacing: 'safe',
      audience: { types: ['buyer'], neighborhoods: ['La Gorce', 'Miami Beach', 'Sunset Islands', 'Venetian Islands'], priceBand: [6000000, 16000000], includeLeads: true },
      brief: 'Invite buyers to Sunday’s open house at 2741 Fairway Isle Drive. Mention the new price ($12.9M) and the loggia; ask them to reply YES so I can add them to the guard-gate list.',
      steps: [
        { dayOffset: 0, instructions: 'Invitation with the new price and the loggia photo.', includePhoto: true },
        { dayOffset: o.sunday, instructions: 'Saturday-evening reminder with gate instructions, only to people who said yes or did not reply.' },
      ],
      lanes: {
        green: { label: 'Coming', action: 'Add to the guard-gate list' },
        yellow: { label: 'Questions', action: 'Answer; offer a private showing instead' },
        red: { label: 'Not coming', action: 'No follow-up' },
        aiReply: { mode: 'draft', instructions: 'If they say yes, confirm the gate list and parking. If they ask about price, give the list price and offer a private showing.' },
      },
      event: { title: 'Open House · 2741 Fairway Isle Drive', address: '2741 Fairway Isle Drive, Miami Beach, FL 33140', startAt: ctx.at(o.sunday, 13, 0).toISOString(), endAt: ctx.at(o.sunday, 16, 0).toISOString(), rsvp: true, listingKey: 'own_lagorce' },
      stats: { recipients: 12, sent: 4, scheduled: 8, replied: 0, rsvps: 0 },
      launchedAt: ctx.past(-1, 11, 0), createdAt: ctx.past(-1, 9, 40),
      recipients: [
        ['preston', 'sent'], ['tessa', 'sent'], ['jamal', 'sent'], ['elena', 'sent'],
        ['ingrid', 'scheduled'], ['patrick', 'scheduled'], ['noah', 'scheduled'], ['sofia', 'scheduled'], ['kenji', 'scheduled'], ['isabella', 'scheduled'], ['chloe', 'scheduled'], ['owen', 'scheduled'],
      ],
    },
    {
      key: 'anniversary', name: 'Home Anniversary', kind: 'automation', trigger: 'home_anniversary', status: 'running', pacing: 'safe',
      audience: { rule: 'bought_with_me', relationship: 'owns', contactKind: 'client' },
      brief: 'On each client’s home anniversary, send a warm, personal note from me. Mention something specific about the house or their first year in it. Offer a fresh valuation only if it feels natural. No market stats, no links.',
      steps: [{ dayOffset: 0, instructions: 'Send at 10am local on the anniversary. One message, no photo.', includePhoto: false }],
      lanes: { aiReply: { mode: 'draft', instructions: 'If they reply, answer like a friend first; if they mention selling or refinancing, flag it for me.' } },
      stats: { sentThisYear: 9, repliedThisYear: 6, upcoming14d: 4 },
      launchedAt: ctx.past(-210, 9, 0), createdAt: ctx.past(-211, 16, 0),
      recipients: [
        ['sterling', 'scheduled', null, null, ctx.at(o.sterlingAnniv, 10)], ['celeste', 'scheduled', null, null, ctx.at(o.celesteAnniv, 10)],
        ['wes', 'scheduled', null, null, ctx.at(o.wesAnniv, 10)], ['joel', 'scheduled', null, null, ctx.at(o.joelAnniv, 10)],
        ['harold', 'pending', null, null, ctx.at(o.haroldReset, 10)],
      ],
    },
  ];

  const notifications = [
    { type: 'message', title: 'Camille Delacroix', body: 'Good morning Alex! Any word from the appraiser? Julien is pacing the kitchen 😅', at: [0, '08:02'], read: false, data: { conversationKey: 'c_delacroix', clientKey: 'camille' } },
    { type: 'message', title: 'Victoria Ashcombe', body: 'Confirmed for 6:30. Before tonight — is the Golden Beach owner actually motivated, or just fishing?', at: [0, '07:52'], read: false, data: { conversationKey: 'c_victoria', clientKey: 'victoria' } },
    { type: 'call_missed', title: 'Missed call · Simone Laurent', body: 'No voicemail. Open house is Sunday.', at: [0, '08:55'], read: false, data: { clientKey: 'simone' } },
    { type: 'voicemail', title: 'Voicemail · Victor Hartmann', body: '“…the lot next to the Seagrape Shore house may come up — call me before anyone else does.”', at: [0, '07:21'], read: false, data: { clientKey: 'victor' } },
    { type: 'ai', title: 'Serena: 4 home anniversaries in the next two weeks', body: 'Sterling Hayes ({date:sterlingAnniv}), Celeste Moreno ({date:celesteAnniv}), Wes Monroe ({date:wesAnniv}), Joel Ackerly ({date:joelAnniv}).', at: [0, '06:30'], read: false },
    { type: 'appointment', title: 'Today: 6 appointments', body: 'First up: Priya & Dev Raman at 9:30. Inspection at 2, Lowell presentation at 4, dinner at 6:30.', at: [0, '06:45'], read: false },
    { type: 'price_drop', title: 'Price drop · 48 Coral Key Isle', body: '$6.9M → $6.4M · matches Malik Adeyemi’s Las Olas deep-water search', at: [-1, '09:12'], read: false, data: { listingKey: 'mls_lasolas48', clientKey: 'malik' } },
    { type: 'deal', title: 'Offer received · 128 Sunset Drive', body: '$17.2M cash from Reid Castellano’s buyer · 14-day inspection · 45-day close', at: [-1, '20:31'], read: true, data: { dealKey: 'whitaker', listingKey: 'own_sunset' } },
    { type: 'voicemail', title: 'Voicemail · Owen Fitzgerald', body: '“Brooke in Aspen found a chalet in the West End that Hannah is obsessed with…”', at: [-1, '20:16'], read: true, data: { clientKey: 'owen' } },
    { type: 'price_drop', title: 'Price drop · Azurine PH 5201', body: '$5.995M → $5.65M · matches Elena Petrova', at: [-2, '08:05'], read: true, data: { listingKey: 'mls_oceanique5201', clientKey: 'elena' } },
    { type: 'match', title: 'New match · 455 Seagrape Shore Drive', body: 'Reduced to $29.5M — oceanfront, 13-ft ceilings · Victoria Ashcombe', at: [-3, '10:48'], read: true, data: { listingKey: 'mls_gb455', clientKey: 'victoria' } },
    { type: 'deal', title: 'Deposit received · Casa Palmera PH-B', body: 'Rafael Montoya’s $985,000 reservation deposit cleared escrow.', at: [-12, '08:50'], read: true, data: { dealKey: 'montoya' } },
  ];

  const waitlists = [
    {
      key: 'wl_aria', name: 'The Aria at Bal Harbour · re-sale', buildingName: 'The Aria at Bal Harbour', neighborhood: 'Bal Harbour', position: 0,
      description: 'Buyers waiting for 02- and 05-line resales, floors 9 and up. Most will pay cash.',
      entries: [
        ['harold', 'waiting', 1, 'One level, 02 line only, floor 12+. Would pay cash after selling Key Biscayne.'],
        ['meredith', 'got_one', 0, 'Got Residence 0905 before it hit the MLS.', 'close:vance'],
        ['sofia', 'waiting', 2, 'Any line under $4.5M; flexible on floor.'],
        ['elena', 'waiting', 3, 'Backup to Sunny Isles — only above the 30th floor.'],
      ],
    },
    {
      key: 'wl_casapalmera', name: 'Casa Palmera · Phase II release', buildingName: 'Casa Palmera Residences', neighborhood: 'Coconut Grove', position: 1,
      description: 'Priority list for Phase II. Release now expected in January; penthouses guided around $11.5M.',
      entries: [
        ['ava', 'waiting', 1, 'PH-A, bay side. Cash.'],
        ['rafael', 'waiting', 2, 'Already reserved PH-B in Phase I; wants a Phase II 3BR to flip at delivery.'],
        ['sterling', 'got_one', 0, 'Took Residence 2401 in the Phase I early release for his daughter.', -150],
        ['leo', 'waiting', 3, '2BR investor line; needs 30-day rentals allowed.'],
        ['daniel', 'waiting', 4, 'Someday — bay-facing, high floor.'],
      ],
    },
    {
      key: 'wl_goldenbeach', name: 'Golden Beach oceanfront lots', neighborhood: 'Golden Beach', position: 2,
      description: 'Buyers who would build on an oceanfront lot — watch for teardown estates and quiet family sales.',
      entries: [
        ['victor', 'waiting', 1, '75+ ft of frontage; ready to close in 30 days.'],
        ['sterling', 'waiting', 2, 'Would build for the family; no rush.'],
        ['victoria', 'waiting', 3, 'Would build if no house fits by Q1.'],
      ],
    },
  ];

  const serena = {
    title: 'Morning plan',
    messages: [
      ['user', [0, '06:58'], 'Morning Serena. What does today look like?'],
      ['assistant', [0, '06:58'], 'Six on the calendar and three things that can’t wait.\n\nBefore 9:\n• Camille will ask about the appraisal this morning — Marcus is calling the appraisal company at 9 and promised an answer by noon, so you can reassure her with a time.\n• Daniel is verified on Bayline’s wire; after that he has nothing to do until the walkthrough {dow:okWalk}.\n• Graham asked last night whether Reid’s buyer loves the house or is fishing. Reid’s own words: “the wife has already picked the kids’ rooms.”\n\nCalendar: 9:30 Priya & Dev consult · 11:00 Palmyra 5122 with Nadia · 1:00 Whitaker offer call · 2:00 Cole inspection with Hank · 4:00 Lowell presentation · 6:30 Victoria at Osteria Vela.\n\nQuick wins: Camila’s birthday is tomorrow, Mara’s is {dow:+3}, and Harold’s is {dow:+6} — he’s the reason you’re in the Lowells’ living room at 4.'],
      ['user', [0, '07:05'], 'What should I counter the Whitakers at?'],
      ['assistant', [0, '07:05'], '$18.3M, with the roof-deck furniture and gym equipment included and a 30-day lease-back offered as a sweetener.\n\nWhy: Reid said they’ll move but not to $18.75M; the closest comp, 1904 Sunset Isle Way, sits at $15.9M with a shorter dock; and Graham’s floor is $18M. Countering at $18.3M leaves room to land at $18.0–18.1M without crossing it. The furniture costs the Whitakers little and matters to the buyer’s wife.'],
      ['user', [0, '07:09'], 'Draft the text to Camille.'],
      ['assistant', [0, '07:09'], 'Here’s a draft for the group thread:\n\n“Good morning Camille! No report yet — Marcus is calling the appraisal company at 9 and will have an answer by noon. Everything I saw on site was positive: he spent his time on the dock and the seawall, which is exactly where our comps are strongest. I’ll text you both the minute I hear. Tell Julien to sit down 😊”',
        [{ id: 'act1', type: 'send_text', status: 'proposed', conversationKey: 'c_delacroix', clientKey: 'julien', body: 'Good morning Camille! No report yet — Marcus is calling the appraisal company at 9 and will have an answer by noon. Everything I saw on site was positive: he spent his time on the dock and the seawall, which is exactly where our comps are strongest. I’ll text you both the minute I hear. Tell Julien to sit down 😊' }]],
    ],
    memories: [
      ['goal', 'Close $2.4M in GCI this year across 20 sides — stay ahead of pace through Q4.', 'onboarding'],
      ['preference', 'No showings before 9:30 on school days — I do the school run.', 'chat'],
      ['style', 'Texts: warm, brief, specific. No exclamation-point pileups. Sign “— Alex” only on a first message to someone new.', 'chat'],
      ['preference', 'Protect Sunday evenings after 5 for family.', 'chat'],
      ['fact', 'My specialty is waterfront: dock lengths, bridge clearances, seawall condition and flood zones — know them cold for every listing I send.', 'onboarding'],
      ['goal', 'Build the off-market pipeline: two new whispers a month.', 'chat'],
      ['block', 'Content block Tuesday and Thursday 10:00–11:30 — film or write, no calls.', 'chat'],
    ],
  };

  const insights = [
    { type: 'reply_suggestion', conversation: 'c_delacroix', client: 'julien', deal: 'delacroix', title: 'Reply to Camille', body: 'Camille is asking whether the appraiser has reported.',
      data: { suggestions: ['No report yet — Marcus is chasing it at 9 and promised an update by noon. Everything on site went well.', 'Good morning! Still waiting on the written report; I’ll text you both the minute it lands.', 'Not yet, and that’s normal at this stage — three to five business days. Tell Julien the dock made a great impression.'] }, at: [0, '08:03'] },
    { type: 'reply_suggestion', conversation: 'c_victoria', client: 'victoria', deal: 'ashcombe', title: 'Reply to Victoria', body: 'She wants to know if the Golden Beach owner is genuinely motivated.',
      data: { suggestions: ['Motivated — he’s moving to Monaco and wants one quiet deal before January. More tonight.', 'Genuinely motivated, but on his timeline. I’ll walk you through how we get in first at 6:30.', 'Not fishing. He told me directly and hasn’t called another agent. See you at Osteria Vela.'] }, at: [0, '07:53'] },
    { type: 'thread_summary', conversation: 'c_graham', client: 'graham', deal: 'whitaker', title: 'Whitaker offer — where things stand',
      body: '$17.2M cash from Reid’s Greenwich buyer (14-day inspection, 45-day close). Sellers’ floor is $18M; Graham wants a read on the buyer. Suggested counter: $18.3M with the roof-deck furniture, gym equipment and an optional lease-back.', at: [-1, '20:55'] },
    { type: 'follow_up', conversation: 'c_sebastian', client: 'sebastian', title: 'RSVP to Sebastian’s housewarming', body: 'He invited you for Saturday at 7 this morning and hasn’t heard back. Bring a Rioja.', at: [0, '07:10'] },
    { type: 'follow_up', client: 'jamal', title: 'Reschedule Jamal’s Old Banyan Road tour', body: 'No-show {dow:-3} because his daughter was sick. The house dropped $300K this week — a good reason to call today.', at: [0, '06:40'] },
    { type: 'pipeline', client: 'ava', deal: 'sinclair', title: 'Ava Sinclair: 18 days on the priority list', body: 'Phase II moved to January. Tomorrow’s Zoom is the moment to get her PH-A preference in writing.', at: [0, '06:40'] },
  ];

  const profile = {
    user: {
      preferences: { theme: 'dark', dashboardPage: 'today', notifications: { push: true, email: false, quietHours: { start: '21:30', end: '07:00' } } },
      onboarding: { completed: true, steps: { profile: true, import: true, schedule: true, payPlan: true, bridge: false } },
      aiPreferences: {
        tone: 'warm, concise, specific', personality: 'calm closer', signoff: '— Alex', avoid: ['exclamation-point pileups', '“just checking in”'],
        voiceSamples: ['Good. I’d go 14.6 with a 10-day inspection — the seller wants certainty more than a top number.', 'Both out. One said “this is the one I’d buy if I had the money.” The other has the money and went quiet — which is often better.', 'Please leave — buyers talk more freely when owners aren’t there.'],
      },
    },
    workspaceSettings: {
      goals: { annualGci: 2400000, annualSides: 20, annualVolume: 85000000, monthlySides: 2 },
      whaleRule: { minPurchasePower: 10000000, orMinLifetimeVolume: 15000000 },
      specialtyTiers: ['waterfront', 'new_development', 'estates'],
      senderGuard: { dailyMax: 150, safePacingSec: 90 },
      features: { matchmaker: true, battlePlan: true, campaigns: true, calls: true },
      demo: true,
    },
    payPlanGoals: { annualGci: 2400000, annualSides: 20, annualVolume: 85000000, monthlySides: 2 },
  };

  return { campaigns, notifications, waitlists, serena, insights, profile };
};
