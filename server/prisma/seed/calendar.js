// Appointments (past 3 weeks → next 2 weeks) and tasks (Your List, Serena
// Suggests, done today, dismissed). Locations use listing keys when natural.
const OFFICE = 'Harbor & Key Realty · 3150 Grand Bay Walk, Coconut Grove';
const BAYLINE = 'Bayline Title & Escrow · 40 Bayline Plaza, Suite 1200, Brickell';

module.exports = function buildCalendar(ctx, asks) {
  const o = ctx.off;
  // [day, 'HH:MM', minutes, type, title, {client, deal, listing, location, status, outcome, notes, attendees, briefing}]
  const A = (day, time, dur, type, title, x = {}) => ({ day, time, dur, type, title, ...x });

  const appts = [
    // ── Today
    A(0, '09:30', 60, 'buyer_consult', 'Buyer consult · Priya & Dev Raman', { client: 'priya', deal: 'raman', location: OFFICE, attendees: [{ name: 'Priya Raman' }, { name: 'Dev Raman' }],
      briefing: { headline: 'Relocating founders — schools first, two offices, walkable.', talkingPoints: ['Pre-approved $5.2M with Meridian Coast; SF sale funds the rest', 'Grove vs. Gables: walkability vs. lot size', 'Tomorrow 9am: 3270 Kumquat Hammock Lane'], personal: ['Anaya (9) and Rohan (6)', 'Mochi the Ragdoll cat', 'Priya is training for a triathlon'], risks: ['Timeline tied to the SF sale'] } }),
    A(0, '11:00', 60, 'private_tour', 'Private tour · Palmyra 5122 with Nadia Karimova', { client: 'nadia', deal: 'karimova', listing: 'mls_palmyra', notes: 'Meet at the island-side ferry landing. Lukas and Timur attending; gate list confirmed.', attendees: [{ name: 'Nadia Karimova' }, { name: 'Lukas Brenner' }] }),
    A(0, '13:00', 30, 'call', 'Offer review call · Whitakers ($17.2M from Reid Castellano)', { client: 'graham', deal: 'whitaker', listing: 'own_sunset', location: 'Phone', notes: 'Net sheet at $17.2M vs. counter at $18.3M. Graham + Sloane both on.' }),
    A(0, '14:00', 90, 'inspection', 'Home inspection · 8120 Banyan Ridge Lane (Cole)', { client: 'ethan', deal: 'cole', listing: 'mls_banyan', attendees: [{ name: 'Hank Morrow', role: 'inspector' }, { name: 'Ethan Cole' }], notes: 'Gate code 4471#. Roof (drone + ladder), pool fence, wind-mit form.' }),
    A(0, '16:00', 75, 'listing_presentation', 'Listing presentation · Charles & Margaret Lowell', { client: 'charles', deal: 'lowell', location: '11 Coral Isle Way, Coral Gables (Gables Estates)',
      briefing: { headline: 'Gables Estates bayfront estate — interviewing two other firms.', talkingPoints: ['Price range $21–22.5M; 8 Pelican Bight is the comp they watch', 'Privacy-first showings (Margaret)', 'Sell the sportfish separately'], personal: ['Golfs with Harold Brennan at Coral Bay', 'Prefers paper — bring the printed book'], risks: ['Will push on commission'] } }),
    A(0, '18:30', 120, 'meeting', 'Dinner · Victoria Ashcombe', { client: 'victoria', deal: 'ashcombe', location: 'Osteria Vela · 9700 Harbour Crest Way, Bal Harbour', notes: 'Bring two floor plans max: 455 Seagrape Shore + the quiet Golden Beach whisper. She orders grower Champagne.' }),

    // ── Tomorrow
    A(1, '09:00', 45, 'showing', 'Showing · 3270 Kumquat Hammock Lane (Raman)', { client: 'priya', deal: 'raman', listing: 'mls_grove3270' }),
    A(1, '10:15', 60, 'showing', 'Showings · Tessa Langford (Sabal Lane + Biscayne Point Isle)', { client: 'tessa', location: 'Sabal Lane, Miami Beach', notes: 'Rocco can come to the second (vacant) house.' }),
    A(1, '11:45', 45, 'private_tour', 'Private tour · 455 Seagrape Shore Drive (Ashcombe)', { client: 'victoria', deal: 'ashcombe', listing: 'mls_gb455' }),
    A(1, '16:30', 90, 'content', 'Film walkthrough reel · 128 Sunset Drive with Kai', { listing: 'own_sunset', client: 'graham', notes: 'Interiors first, then drone at golden hour.' }),
    A(1, '18:30', 45, 'video', 'Zoom · Casa Palmera Phase II floor plans (Ava Sinclair)', { client: 'ava', deal: 'sinclair', location: 'Zoom', notes: 'Lorenzo’s architect joins for the first 15 minutes.' }),

    // ── This Sunday + next two weeks
    A(o.sunday, '13:00', 180, 'open_house', 'Open house · 2741 Fairway Isle Drive (La Gorce)', { client: 'simone', deal: 'laurent', listing: 'own_lagorce', notes: 'Guard-gate list closes Saturday 6pm. Coco at Bark & Bubble 12:30–4:30.' }),
    A(o.nextWeekMon, '08:30', 45, 'team', 'Harbor & Key sales meeting', { location: OFFICE }),
    A(o.lucasBoard, '09:30', 30, 'video', 'Condo board interview (The Aria) · Lucas Moreau', { client: 'lucas', deal: 'moreau', location: 'Zoom', status: 'scheduled', notes: 'Tentative — confirmation text failed to deliver; confirm by email.' }),
    A(o.nextWeekMon, '12:00', 60, 'showing', 'Showings · Isabella Ferraro (Lumen Bay 2908 + Atelier 41 6C)', { client: 'isabella', deal: 'ferraro', listing: 'mls_aqua2908' }),
    A(o.nextWeekMon, '17:30', 60, 'showing', 'Rental tours · Chloe Park (Coconut Grove)', { client: 'chloe', deal: 'park', location: 'Shipwright Lane, Coconut Grove' }),
    A(o.brokerOpen, '11:30', 120, 'broker_open', 'Broker open · 128 Sunset Drive', { client: 'graham', deal: 'whitaker', listing: 'own_sunset', notes: 'Catering by Le Petit Quai; Lena refreshing flowers at 10.' }),
    A(o.brokerOpen, '15:00', 60, 'private_tour', 'Walk Aria 1402 with Harold & June Brennan', { client: 'harold', deal: 'brennan', listing: 'own_aria1402' }),
    A(o.elenaShow, '10:00', 45, 'showing', 'Second showing · Azurine PH 5201 (Elena Petrova)', { client: 'elena', listing: 'mls_oceanique5201' }),
    A(o.okWalk, '16:00', 45, 'final_walkthrough', 'Final walkthrough · One Harbor Point PH 4501 (Okafor)', { client: 'daniel', deal: 'okafor', listing: 'mls_harborpoint' }),
    A(o.okClose, '10:00', 90, 'closing', 'Closing · One Harbor Point PH 4501 (Okafor)', { client: 'daniel', deal: 'okafor', listing: 'mls_harborpoint', location: BAYLINE, attendees: [{ name: 'Daniel Okafor' }, { name: 'Jordan Pierce', role: 'co-agent' }, { name: 'Rachel Ostrowski', role: 'closing agent' }] }),
    A(o.coleAppraisal, '13:30', 60, 'appraisal', 'Appraisal · 8120 Banyan Ridge Lane (Cole)', { client: 'ethan', deal: 'cole', listing: 'mls_banyan' }),
    A(o.dxWalk, '16:00', 60, 'final_walkthrough', 'Final walkthrough · 41 Isola Verde Drive (Delacroix)', { client: 'julien', deal: 'delacroix', listing: 'mls_isola' }),
    A(o.dxClose, '11:00', 90, 'closing', 'Closing · 41 Isola Verde Drive (Delacroix)', { client: 'julien', deal: 'delacroix', listing: 'mls_isola', location: BAYLINE }),

    // ── Past three weeks
    A('close:duarte', '11:30', 60, 'closing', 'Closing · 1215 Alhambra Vista Court (Duarte)', { flex: true, client: 'sebastian', deal: 'duarte', location: BAYLINE, outcome: 'Closed and funded. Keys handed over at the house at 1:30.' }),
    A('close:vance', '14:00', 60, 'closing', 'Closing · The Aria 0905 (Vance)', { flex: true, client: 'meredith', deal: 'vance', location: BAYLINE, outcome: 'Closed. Movers from Boston arrive next week; building orientation booked.' }),
    A('close:feld', '15:30', 45, 'closing', 'Closing · 6940 Old Cutler Bend (Feld)', { flex: true, client: 'jonah', deal: 'feld', location: BAYLINE, outcome: 'Seller side closed; Jonah wants to start Jupiter Island right away.' }),
    A(-2, '10:00', 90, 'appraisal', 'Appraisal · 41 Isola Verde Drive (Delacroix)', { client: 'julien', deal: 'delacroix', listing: 'mls_isola', outcome: 'Appraiser on site 90 minutes, focused on dock and seawall. Gave him the comp package and the $35K credit. Report due in 3–5 business days.' }),
    A(-2, '12:00', 30, 'video', 'Intro video call · Noah Brandt', { flex: true, client: 'noah', location: 'Zoom', status: 'no_show', outcome: 'No-show; emailed to reschedule.' }),
    A(-2, '14:00', 60, 'showing', 'Co-op showings · 128 Sunset Drive', { client: 'graham', deal: 'whitaker', listing: 'own_sunset', outcome: 'Two agents. One buyer loved it but is stretched; the other went quiet — likely the stronger one.' }),
    A(-2, '17:00', 45, 'showing', 'Second showing · The Mariner PH 2 (Bianca Rossi)', { client: 'bianca', deal: 'rossi', listing: 'mls_mariner', outcome: 'Confirmed for her — writing $6.85M cash, 10-day inspection, 30-day close.' }),
    A(-3, '16:00', 45, 'showing', 'Showing · 6205 Old Banyan Road (Jamal Henderson)', { client: 'jamal', listing: 'mls_pinecrest6205', status: 'no_show', outcome: 'Daughter spiked a fever — needs to reschedule.' }),
    A(-4, '17:00', 75, 'showing', 'Rental tours · Chloe Park', { client: 'chloe', deal: 'park', location: 'Coconut Grove', outcome: 'Loved the Shipwright Lane townhouse ($12.5K / 13 months) but wants one more option first.' }),
    A(-5, '19:30', 60, 'showing', 'Second showing · 128 Sunset Drive (Reid Castellano’s buyer)', { client: 'graham', deal: 'whitaker', listing: 'own_sunset', outcome: 'Buyer stayed 90 minutes and brought a contractor. Offer likely.' }),
    A(-6, '11:00', 60, 'private_tour', 'Private preview · 128 Sunset Drive (Kenji Watanabe)', { client: 'kenji', listing: 'own_sunset', outcome: 'Dream tour. He’ll be a buyer here in 3–4 years — keep him close.' }),
    A(-6, '12:30', 45, 'private_tour', 'Private preview · 128 Sunset Drive (Malik Adeyemi)', { client: 'malik', listing: 'own_sunset', status: 'cancelled', outcome: 'Cancelled — Kemi vetoed Miami Beach.' }),
    A(-6, '15:00', 60, 'buyer_consult', 'Buyer consult · Tessa Langford', { client: 'tessa', location: OFFICE, outcome: 'Firm at $4.5M; dog-friendly yard; surfs every morning so close to the beach matters.' }),
    A(-8, '17:00', 45, 'showing', 'Showing · Lumen Bay 2908 (Isabella Ferraro)', { client: 'isabella', deal: 'ferraro', listing: 'mls_aqua2908', outcome: 'Loved the 40-ft gallery wall. Needs a lender intro before she can offer.' }),
    A(-10, '10:00', 180, 'private_tour', 'Private tours · Golden Beach oceanfront (Ashcombe)', { client: 'victoria', deal: 'ashcombe', listing: 'mls_gb455', outcome: 'Re-saw 455; loves the beach, not the house. Mentioned Indian Creek would be a dream if it ever traded.' }),
    A(-11, '17:30', 120, 'content', 'Photo + dusk drone shoot · 128 Sunset Drive', { listing: 'own_sunset', client: 'graham', outcome: 'Kai got the dusk pool shot — that’s the cover.' }),
    A(-12, '20:00', 30, 'video', 'Video call · Malik Adeyemi (Las Olas deep water)', { client: 'malik', location: 'FaceTime', outcome: 'Confirmed: 8 ft at low tide, no fixed bridges, 80+ ft dock. 48 Coral Key Isle is the one.' }),
    A(-13, '17:00', 75, 'meeting', 'Casa Palmera sales gallery · Rafael & Lucía Montoya', { client: 'rafael', deal: 'montoya', location: 'Casa Palmera Sales Gallery · 3100 Palmera Bay Lane, Coconut Grove', outcome: 'Reserved Penthouse B. Reservation deposit wired next morning.' }),
    A(-14, '10:00', 90, 'showing', 'Showings · Sunny Isles oceanfront (Elena Petrova)', { client: 'elena', listing: 'mls_oceanique5201', outcome: 'Azurine PH 5201 the clear favorite; seller firm at $5.995M — watch for a drop.' }),
    A(-16, '10:00', 90, 'inspection', 'Inspection · The Aria 1102 (Moreau)', { client: 'lucas', deal: 'moreau', listing: 'mls_aria1102', outcome: 'Very clean. One 9-year-old AC handler — budget, don’t negotiate.' }),
    A(-17, '09:00', 240, 'inspection', 'Inspection · 41 Isola Verde Drive (Delacroix)', { client: 'julien', deal: 'delacroix', listing: 'mls_isola', attendees: [{ name: 'Hank Morrow', role: 'inspector' }], outcome: 'Seawall cap cracks along ~30 ft; original lift motor. Recommend asking for a $35K credit.' }),
    A(-19, '10:00', 90, 'meeting', 'First walkthrough · Lowell estate', { client: 'charles', deal: 'lowell', location: '11 Coral Isle Way, Coral Gables (Gables Estates)', outcome: 'Boathouse, 245 ft of frontage, original 1997 kitchen. Margaret wants privacy during showings.' }),
    A(-21, '10:30', 90, 'broker_open', 'Broker open · 8 Pelican Bight Road (Gables Estates)', { listing: 'mls_gablesestates8', outcome: 'Two agents separately mentioned the Indian Creek compound may trade in the spring. Logged as a whisper.' }),
  ];

  // ── Tasks
  const T = (title, x = {}) => ({ title, ...x });
  const quote = (k, who = 'her') => (asks[k] ? `From ${who} text yesterday: “${asks[k].text}”` : null);
  const tasks = [
    // Your list
    T('Send the Whitakers a net sheet: $17.2M vs. an $18.3M counter', { client: 'graham', deal: 'whitaker', listing: 'own_sunset', kind: 'paperwork', dueDate: 0, dueAt: [0, '12:30'], priority: 2, source: 'user' }),
    T('Get the Isola Verde appraisal ETA from Marcus and update Camille & Julien', { client: 'julien', deal: 'delacroix', kind: 'follow_up', dueDate: 0, priority: 2, source: 'serena' }),
    T('Print the Lowell listing book + Gables Estates comps', { client: 'charles', deal: 'lowell', kind: 'paperwork', dueDate: 0, dueAt: [0, '15:00'], priority: 2, source: 'user', durationMin: 30 }),
    T('Verify Okafor’s wire call-back with Rachel at Bayline', { client: 'daniel', deal: 'okafor', kind: 'call', dueDate: 1, priority: 1, source: 'user' }),
    T('Order open house signs + send the La Gorce guard-gate list', { client: 'simone', deal: 'laurent', listing: 'own_lagorce', kind: 'other', dueDate: 1, priority: 1, source: 'user' }),
    T('Reschedule Jamal’s Pinecrest tour', { client: 'jamal', kind: 'call', dueDate: 0, rolledFrom: -2, priority: 1, source: 'user', notes: 'Zoe was sick on the day; he still wants Old Banyan Road (just reduced).' }),
    T('Send Chloe three more Coconut Grove rentals', { client: 'chloe', deal: 'park', kind: 'text', dueDate: 0, rolledFrom: -1, priority: 1, source: 'serena' }),
    T('Send Lydia the 60-day showing report for Aria 1402', { client: 'lydia', deal: 'fontaine', listing: 'own_aria1402', kind: 'email', dueDate: -1, priority: 0, source: 'user' }),
    T('Call Harold about ARM options before his birthday', { client: 'harold', deal: 'brennan', kind: 'call', dueDate: 3, priority: 1, source: 'serena', notes: 'Rate resets {date:haroldReset}; refinance vs. sell + Aria 1402.' }),
    T('Remind Rafael: $985K second deposit due {date:rafaelDeposit}', { client: 'rafael', deal: 'montoya', kind: 'text', dueDate: 7, priority: 0, source: 'user' }),
    T('Renew E&O insurance and finish CE hours', { kind: 'other', dueDate: 5, priority: 0, source: 'user' }),

    // Serena suggests (AI-captured from yesterday's texts)
    T('Introduce Camille to the art + wine movers', { client: 'camille', deal: 'delacroix', kind: 'email', status: 'suggested', source: 'ai_capture', notes: quote('camille_movers'), dueDate: 0 }),
    T('Confirm how the Golden Beach owner’s attorney wants Victoria’s proof of funds', { client: 'victoria', deal: 'ashcombe', kind: 'call', status: 'suggested', source: 'ai_capture', notes: quote('victoria_pof'), dueDate: 0 }),
    T('Ask Ricardo whether the pool-fence panels convey at Banyan Ridge', { client: 'ethan', deal: 'cole', listing: 'mls_banyan', kind: 'call', status: 'suggested', source: 'ai_capture', notes: quote('ethan_fence', 'his'), dueDate: 0 }),
    T('Send Harold the Aria 02-line sales history since 2019', { client: 'harold', deal: 'brennan', listing: 'own_aria1402', kind: 'email', status: 'suggested', source: 'ai_capture', notes: quote('harold_aria', 'his'), dueDate: 0 }),
    T('Intro Isabella to Marcus Bell for a pre-approval', { client: 'isabella', deal: 'ferraro', kind: 'email', status: 'suggested', source: 'ai_capture', notes: quote('isabella_lender'), dueDate: 0 }),
    T('Request the dock-depth survey for 48 Coral Key Isle from Grant Okimoto', { client: 'malik', listing: 'mls_lasolas48', kind: 'call', status: 'suggested', source: 'ai_capture', notes: quote('malik_survey', 'his'), dueDate: 0 }),
    T('Send Priya the Coconut Grove school-boundary map with 8am drive times', { client: 'priya', deal: 'raman', kind: 'email', status: 'suggested', source: 'ai_capture', notes: quote('priya_map'), dueDate: 0 }),

    // Done today
    T('Confirm Hank for the 2pm Banyan Ridge inspection', { client: 'ethan', deal: 'cole', kind: 'text', status: 'done', source: 'user', dueDate: 0, completedAt: [0, '07:51'] }),
    T('Post the 128 Sunset Drive reel teaser to Instagram', { listing: 'own_sunset', kind: 'other', status: 'done', source: 'user', dueDate: 0, completedAt: [0, '08:30'] }),
    T('Send Priya & Dev the consult agenda + school list', { client: 'priya', deal: 'raman', kind: 'email', status: 'done', source: 'serena', dueDate: 0, completedAt: [0, '08:44'] }),

    // Dismissed
    T('Check in with Gordon Pratt', { client: 'gordon', kind: 'text', status: 'dismissed', source: 'planner', dueDate: -3, dismissedAt: [-3, '09:12'], notes: 'Cold for 3 months; dismissed for now.' }),
    T('Text Stefan about listing Vela 2304', { client: 'stefan', kind: 'text', status: 'dismissed', source: 'ai_capture', dueDate: -6, dismissedAt: [-6, '10:05'], notes: 'He opted out of texts — call instead.' }),
  ];

  return { appts, tasks };
};
