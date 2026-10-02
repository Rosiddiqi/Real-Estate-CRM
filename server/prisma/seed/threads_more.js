// Supporting conversation scripts + campaign messages injected into threads.
// Same tuple format as threads_hero.js.
const JL = [
  (n) => `${n} — just listed: 128 Sunset Drive on Sunset Islands. 105 ft of open bay, a new 90-ft dock and a roof deck aimed at the skyline. $18.75M. Private previews this week if you’d like a slot.`,
  (n) => `Just listed, ${n}: 128 Sunset Drive — the widest open-water lot on Sunset Islands, rebuilt in 2018 with a 90-ft dock and lift. Asking $18.75M. Happy to walk you through before the broker open.`,
  (n) => `${n}, a new one before it hits the portals: 128 Sunset Drive on Sunset Islands. Modern, bayfront, 90-ft dock, $18.75M. Want the floor plan?`,
];
const OH = [
  (n) => `${n}, open house this Sunday 1–4 at 2741 Fairway Isle Drive in La Gorce — the 1928 Mediterranean, newly priced at $12.9M. Reply YES and I’ll put you on the guard list.`,
  (n) => `Hi ${n} — I’m opening 2741 Fairway Isle Drive in La Gorce this Sunday from 1 to 4. New price, $12.9M, and the loggia is at its best in the afternoon light. Want me on the gate list for you?`,
];

// Just Listed blast order (safe pacing: one every ~2 minutes from 10:15, 8 days ago).
const BLAST = [
  ['c_kenji', 'Kenji'], ['c_malik', 'Malik'], ['c_tessa', 'Tessa'], ['c_jonah', 'Jonah'], ['c_leo', 'Leo'], ['c_elena', 'Elena'],
  ['c_frederick', 'Fred'], ['c_wes', 'Wes'], ['c_lucas', 'Lucas'], ['c_rafael', 'Rafael'], ['c_bianca', 'Bianca'], ['c_ava', 'Ava'],
  ['c_sebastian', 'Sebastian'], ['c_adrian', 'Adrian'], ['c_stefan', 'Stefan'],
];
const OPEN_HOUSE = [['c_preston', 'Preston'], ['c_tessa', 'Tessa'], ['c_jamal', 'Jamal'], ['c_elena', 'Elena']];

function injections() {
  const out = {};
  const add = (k, m) => { (out[k] = out[k] || []).push(m); };
  BLAST.forEach(([k, n], i) => {
    const mins = 15 + i * 2;
    add(k, [-8, `10:${String(mins).padStart(2, '0')}`, 'me', JL[i % 3](n), { campaign: 'justlisted', aiGenerated: true }]);
  });
  OPEN_HOUSE.forEach(([k, n], i) => add(k, [-1, `11:0${i * 2}`, 'me', OH[i % 2](n), { campaign: 'openhouse', aiGenerated: true }]));
  return out;
}

function moreThreads() {
  return [
    {
      key: 'c_lucas', client: 'lucas',
      msgs: [
        [-46, '15:00', 'c', 'Bonjour Alex, I saw The Aria 1102 on your website. Is it still available? I am in Miami next week.'],
        [-46, '15:20', 'me', 'Bonjour Lucas! It is. It’s sold furnished, and the ocean terrace is as good as the photos. I can show it {dow:-40} — morning or afternoon?'],
        [-46, '15:25', 'c', 'Afternoon. And show me two others so I can compare.'],
        [-40, '18:00', 'me', 'Thanks for today. 1102 is the best value of the three; Seaview 1801 is cheaper but the kitchen needs work. The Aria’s beach service is the best on the strip.'],
        [-20, '09:00', 'c', 'Let’s offer 5.1 on 1102. Cash. Quick close.'],
        [-20, '09:15', 'me', 'Smart. 5.1 with a 7-day inspection — the seller wants out before season. Drafting now.'],
        [-18, '14:00', 'me', 'Accepted at $5.2M ✅ You’re under contract. Condo association approval is next — they’ll want a short video interview.'],
        [-18, '14:20', 'c', 'Parfait. Élise is very happy.'],
        [-16, '16:30', 'me', 'Inspection was very clean. One AC handler is nine years old — budget to replace it in the next year or two, but nothing to negotiate.'],
        [-8, '11:00', 'c', 'I am in Lyon and Milan until the end of the month. Email is best for documents — my company does not allow WhatsApp 🙃'],
        [-8, '11:10', 'me', 'No problem — email for documents, texts only for anything urgent.'],
        [-2, '10:30', 'me', 'The association wants your board interview by video. Could you do {dow:3} at 9:30am Miami time (3:30pm in Milan)?', { status: 'failed', error: 'Not delivered — recipient unreachable (international roaming)' }],
      ],
    },
    {
      key: 'c_isabella', client: 'isabella',
      msgs: [
        [-33, '20:00', 'c', 'Hi! Found you on Instagram (the Edgewater reel 🙌). My lease at Vela ends in a couple of months and I’m wondering if buying makes sense for me. Can I ask you some dumb questions?'],
        [-33, '20:12', 'me', 'No dumb questions here. Short answer: at $14,500 a month, very possibly. Long answer over coffee? I’m in Brickell {dow:-31}.'],
        [-33, '20:15', 'c', 'Perfect. 10am at Nonna Rina?'],
        [-31, '12:00', 'me', 'Lovely to meet you. As promised, three things to figure out first: your real budget with a lender, which neighborhoods feel like home, and how much wall you need for art 😉'],
        [-31, '12:30', 'c', 'At least 20 feet of uninterrupted wall. I’m serious.'],
        [-16, '18:00', 'c', 'Ok I’ve decided. I want to buy. Edgewater or near the Design District. $2–3M?'],
        [-16, '18:10', 'me', 'Love it. I’ll set up the search — and let’s get your lender conversation going so you know your number.'],
        [-8, '17:30', 'me', 'This one has a 40-ft gallery wall, and the lighting is already wired.', { listing: 'mls_aqua2908' }],
        [-8, '17:50', 'c', 'WAIT. This is the one I saw today right?? The light was unreal.'],
        [-8, '17:52', 'me', 'That’s the one.'],
        [-1, '12:05', 'c', 'Who’s the lender you mentioned? I want to know my real number before I fall in love with anything. (Too late for 2908 tbh)', { ask: 'isabella_lender' }],
        [-1, '12:20', 'me', 'Marcus Bell at Meridian Coast — he’s great with self-employed buyers. I’ll do an intro email today.'],
      ],
    },
    {
      key: 'c_marco', client: 'marco', channel: 'sms',
      msgs: [
        [-30, '13:00', 'c', 'Hi, I called about the sign at the La Gorce house. Too expensive for me lol. But I rent in South Beach and my lease is up soon. Do you do rentals?'],
        [-30, '13:20', 'me', 'Hi Marco — I do, and I also help renters figure out whether buying makes more sense. When is your lease up?'],
        [-30, '13:31', 'c', 'Lease ends {date:+64}. Landlord wants 9% more 😤'],
        [-30, '13:40', 'me', 'Ugh. Let’s look at both — a renewal counter, and what $18K a month buys you as a mortgage. It might surprise you.'],
        [-21, '19:00', 'c', 'Still thinking. Restaurant is crazy right now'],
        [-21, '19:05', 'me', 'Totally understand. I’ll check back once season is rolling.'],
        [-2, '11:00', 'me', 'Hi Marco — ran the numbers: at $18K a month, a $2.4M condo with 25% down costs about the same monthly, and you keep the equity. Want to see two in SoFi next week?'],
        [-2, '14:45', 'c', 'Interesting… maybe. What days are you free?'],
        [-2, '15:00', 'me', 'Tuesday or Wednesday afternoon both work. Pick one and I’ll line them up.'],
      ],
    },
    {
      key: 'c_chloe', client: 'chloe',
      msgs: [
        [-29, '10:00', 'c', 'Hi Alex, I relocated from NYC and I’m renting a townhouse in the Grove. My lease ends in a few months and I’d like help finding the next place — renting for now, maybe buying later.'],
        [-29, '10:15', 'me', 'Welcome to the Grove! Happy to help with both. What do you love and hate about where you are now?'],
        [-29, '10:30', 'c', 'Love: walking to everything. Hate: tiny kitchen and no space for Miso to run.'],
        [-15, '16:00', 'me', 'Three rentals I think you’ll like — all under $13K and all with a yard for Miso.', { att: ['int:2', 'ext:13', 'int:7'] }],
        [-15, '16:30', 'c', 'The second one!!!'],
        [-4, '18:20', 'me', 'Today was fun. The owner of the Shipwright Lane townhouse will do $12,500 for 13 months. Want me to send the application?'],
        [-4, '18:40', 'c', 'Yes, but can I see one more option first? I want to be sure.'],
        [-4, '18:44', 'me', 'Of course. I’ll send you three more this week.'],
        [-2, '19:00', 'c', 'Random question — what would the townhouse I’m renting now sell for? Just curious 👀'],
        [-2, '19:10', 'me', 'Not random at all — about $2.1–2.3M. Happy to show you what owning would cost versus renting.'],
      ],
    },
    {
      key: 'c_simone', client: 'simone',
      msgs: [
        [-70, '10:00', 'c', 'Camila says you are the only agent she trusts. I am moving to Paris in January and must sell my house in La Gorce. Can you come and see it?'],
        [-70, '10:20', 'me', 'Camila is too kind. I’d be honored. Tomorrow at 4?'],
        [-52, '15:00', 'me', 'Listing agreement signed — thank you! Next: Lena stages {dow:-48} and Kai photographs {dow:-47}.'],
        [-34, '08:30', 'me', 'We’re live at $13.9M. The photos of the loggia are stunning.', { att: ['listing:own_lagorce:2'] }],
        [-34, '08:40', 'c', 'Merveilleux !'],
        [-20, '18:00', 'me', 'Week three: eleven showings, lots of love for the loggia, and two buyers nervous about 1928 bones — even after I showed them the 2021 renovation file.'],
        [-20, '18:15', 'c', 'People are ridiculous. The house will outlive all of us.'],
        [-8, '17:00', 'me', 'I’d like to talk price. We’re 30 days in without an offer, and the reductions at 8 Pelican Bight are resetting expectations. My recommendation: $12.9M, plus an open house to reintroduce it.'],
        [-8, '17:30', 'c', 'I hate this. But I trust you. Let me sleep on it.'],
        [-7, '09:00', 'c', 'Ok. $12.9M. And yes to the open house.'],
        [-4, '09:00', 'me', 'Price change is live at $12.9M. I’ve emailed every agent who showed it. Open house this Sunday, 1–4.'],
        [-4, '09:15', 'c', 'Ok. Fingers crossed 🤞'],
        [-1, '18:00', 'c', 'Should I leave during the open house, or is it ok if Coco stays in her crate in the garage?'],
        [-1, '18:10', 'me', 'Please leave — buyers talk more freely when owners aren’t there. Coco gets a spa day: she’s booked at Bark & Bubble from 12:30 to 4:30, on me.'],
        [-1, '18:12', 'c', 'You are spoiling her 😂', { react: [{ type: 'love', fromMe: true }] }],
      ],
    },
    {
      key: 'c_beatriz', client: 'beatriz',
      msgs: [
        [-41, '09:00', 'me', '3417 Mangrove Point is live at $7.65M! Your photo of the oak at sunrise made the cut.'],
        [-41, '09:20', 'c', 'Tomás says it’s the best thing I’ve ever designed. Other than Inés 😄'],
        [-30, '17:00', 'me', 'Showings are steady — nine so far. The roof terrace is the moment everyone goes quiet.'],
        [-14, '20:00', 'me', 'We have an offer: $7.25M from a family relocating from Chicago, 20% down, Coastal Federal financing. I recommend countering at $7.5M.'],
        [-14, '20:30', 'c', 'Counter at 7.5. Tomás agrees.'],
        [-12, '12:00', 'me', 'We settled at $7.4M with a 7-day inspection and a 30-day close. You’re under contract! Champagne is on me.'],
        [-12, '12:05', 'c', '🥂 Thank you Alex!'],
        [-2, '10:00', 'me', 'Inspection and appraisal are both cleared. The buyer’s loan commitment is due {date:+5}; then it’s just closing on {date:alvClose}.'],
        [-2, '10:30', 'c', 'Perfect. Our container to Madrid is booked for the week after.'],
        [-2, '10:34', 'me', 'The buyers asked whether the outdoor dining set might stay, if you’re not shipping it.'],
        [-2, '11:00', 'c', 'Done, it’s theirs. Tell them to enjoy it under the oak.'],
      ],
    },
    {
      key: 'c_adrian', client: 'adrian',
      msgs: [
        ['close:kessler-36', '12:00', 'me', 'Two offers on Solace 803 — $3.85M and $3.95M, both cash. I’d counter both at $4.05M and see who blinks.'],
        ['close:kessler-36', '12:30', 'c', 'Go for it.'],
        ['close:kessler-35', '10:00', 'me', 'The $3.95M buyer held firm and the other walked. I recommend accepting — clean cash, 30-day close.'],
        ['close:kessler-35', '10:10', 'c', 'Accept. Naomi and I want to be done with Florida paperwork before the holidays.'],
        ['close:kessler', '13:00', 'me', 'It’s officially closed! Bayline has wired the proceeds to your account. Thank you for trusting me with it.'],
        ['close:kessler', '13:30', 'c', 'Celebrating with the view one last time. Thank you, Alex.', { att: ['int:9'], react: [{ type: 'love', fromMe: true }] }],
        ['close:kessler', '13:40', 'me', 'If you ever have a minute, a short review would mean a lot. And if friends in New York ask about Surfside, you know where to send them.'],
        ['close:kessler', '14:02', 'c', 'Already wrote it. Five stars, obviously.'],
      ],
    },
    {
      key: 'c_sebastian', client: 'sebastian',
      msgs: [
        ['close:duarte-35', '19:00', 'c', 'WE GOT IT?!'],
        ['close:duarte-35', '19:02', 'me', 'You got it. Under contract at $4.85M. Ana can start picking paint colors.'],
        ['close:duarte-35', '19:05', 'c', 'She started three weeks ago 😂', { react: [{ type: 'laugh', fromMe: true }] }],
        ['close:duarte-6', '11:00', 'me', 'Final walkthrough is booked for the morning of closing. Bring Lucas — he should see his new backyard first.'],
        ['close:duarte', '13:30', 'me', 'Keys are yours! Welcome home, Duartes 🔑'],
        ['close:duarte', '13:40', 'c', 'Lucas already claimed the backyard', { att: ['ext:4'], react: [{ type: 'love', fromMe: true }] }],
        [0, '07:05', 'c', 'Housewarming Saturday at 7. You’re coming, right? Bring nothing. Maybe a bottle 😉'],
      ],
    },
    {
      key: 'c_jonah', client: 'jonah',
      msgs: [
        ['close:feld-40', '18:00', 'me', 'Feedback from the second showing: they love the tennis court and the cabana. I think an offer is coming.'],
        ['close:feld-38', '10:00', 'me', 'Offer: $5.45M, conventional, 30-day close. I’d counter at $5.7M.'],
        ['close:feld-38', '10:30', 'c', 'Ruth says split the difference if they’re nice people.'],
        ['close:feld-36', '12:00', 'me', 'They’re very nice people, and they came up to $5.6M. I recommend accepting.'],
        ['close:feld-36', '12:10', 'c', 'Accept.'],
        [-8, '11:02', 'c', 'Beautiful. How deep is the water at the dock? Asking for a friend with a boat.'],
        [-8, '11:20', 'me', 'About 9 ft at low tide off the end of the dock. Is the friend you? 😄'],
        [-8, '11:25', 'c', 'The friend is my brother-in-law. I’ll forward it.'],
        ['close:feld', '16:15', 'me', 'Closed and funded. Congratulations, Jonah — fifteen years of memories, and a lovely family to take it from here.'],
        ['close:feld', '16:40', 'c', 'Thanks, Alex. Now find me Jupiter Island. Ruth wants birds and I want golf.'],
        [0, '07:30', 'me', 'First look: 9 Plover Point Lane — 1.6 acres on the Intracoastal, a 100-ft dock, ten minutes to the island club course. Birds included.', { listing: 'mls_jupiter9' }],
      ],
    },
    {
      key: 'c_kenji', client: 'kenji',
      msgs: [
        ['close:watanabe-2', '10:00', 'c', 'Final walkthrough tomorrow at 9 still good?'],
        ['close:watanabe-2', '10:05', 'me', 'Yes, 9am. Bring the movers’ insurance certificate if you have it — the building is strict.'],
        ['close:watanabe', '15:00', 'me', 'Congratulations, homeowner! Vela 3306 is officially yours.'],
        ['close:watanabe', '15:10', 'c', 'Unreal. Thank you for putting up with my 40 spreadsheets.'],
        [-24, '18:30', 'c', 'My friend Leo Ricci is looking to buy rental condos — ok if I give him your number?'],
        [-24, '18:41', 'me', 'Of course! Thank you, Kenji. I owe you an omakase.'],
        [-8, '10:40', 'c', 'Ok this one is dangerous. Can I see it this weekend? Just to dream.'],
        [-8, '10:52', 'me', 'Always. {dow:-6} at 11 — I’ll show you what you’re buying in four years.'],
        [-3, '18:40', 'c', 'Terrace is finally done. Thank you again 🙏', { att: ['int:8'], react: [{ type: 'love', fromMe: true }] }],
        [-3, '18:45', 'me', 'That’s a magazine shot. Send me another when the plants grow in.'],
      ],
    },
    {
      key: 'c_ava', client: 'ava',
      msgs: [
        [-61, '17:00', 'c', 'Hi Alex — Lorenzo Vidal suggested I reach out. I’m interested in Casa Palmera, ideally a penthouse. Phase I looks sold out at the top?'],
        [-61, '17:15', 'me', 'Hi Ava — it is, but Phase II will have two penthouses, and I can put you on the priority list today.'],
        [-61, '17:20', 'c', 'Please do.'],
        [-40, '10:00', 'me', 'Lorenzo shared preliminary Phase II pricing with the priority list: penthouses guided around $11.5M. You’re first on my list for PH-A.'],
        [-40, '10:20', 'c', 'Good. I want PH-A — the one facing the bay.'],
        [-18, '12:00', 'me', 'Quick update: Lorenzo has pushed the Phase II release to January. You’re still first in line.'],
        [-18, '12:30', 'c', 'Ok. Can we do a call to go over floorplans?'],
        [-18, '12:35', 'me', 'Of course.'],
        [-1, '09:00', 'me', 'Zoom tomorrow at 5 for the Phase II floor plans? Lorenzo’s architect can join for the first 15 minutes.'],
        [-1, '09:20', 'c', 'Perfect, 5pm works.'],
      ],
    },
    {
      key: 'c_leo', client: 'leo', unread: 1,
      msgs: [
        [-24, '19:00', 'c', 'Hi Alex, Leo here — Kenji’s friend. Looking to buy one or two rental condos in Brickell or Edgewater. Cash flow matters more than views.'],
        [-24, '19:20', 'me', 'Hi Leo — I love a numbers buyer. Two filters first: buildings that allow 30-day rentals, and a target cap rate. What’s yours?'],
        [-24, '19:30', 'c', '4.5% or better. Pre-approved for $2.6M.'],
        [-8, '12:00', 'c', 'Not my lane at that price, but what’s the seasonal rental comp on something like that?'],
        [-8, '12:15', 'me', '$85–110K a month in season for the right family. Investors do it, but the math is thin at $18.75M.'],
        [-6, '11:00', 'me', 'Solenne 7B allows 30-day rentals and comes with a deeded boat slip — pre-construction, delivering next year.', { listing: 'dev_solenne7b' }],
        [-6, '11:20', 'c', 'Interesting. What’s the HOA going to be?'],
        [-6, '11:25', 'me', 'Estimated $2,600 a month. I’ll get the developer’s pro forma.'],
        [-1, '21:30', 'c', 'What are 2BR rents doing at Vela Brickell right now? Trying to decide between that and Solenne.'],
      ],
    },
    {
      key: 'c_tessa', client: 'tessa',
      msgs: [
        [-21, '11:00', 'c', 'Hi! Camila from Sol Yoga gave me your number. I’m looking for a modern house in Miami Beach under $4.5M — with a yard for my dog Rocco.'],
        [-21, '11:20', 'me', 'Hi Tessa! Camila’s the best. I love a dog-first search. Is walking to the beach important?'],
        [-21, '11:25', 'c', 'Very. I surf most mornings.'],
        [-8, '10:49', 'c', 'Love it but way out of my league 😅 anything similar under 5?'],
        [-8, '11:05', 'me', 'Similar vibe, smaller footprint — yes. I’ll send two tomorrow.'],
        [-6, '12:00', 'me', 'Great meeting today. I’ll send everything that fits — and a couple that stretch.'],
        [-1, '16:00', 'me', 'Tomorrow: 10:30 at the Sabal Lane house, then 11:30 on Biscayne Point Isle. Coffee’s on me.'],
        [-1, '16:20', 'c', 'Can Rocco come? 🐶'],
        [-1, '16:25', 'me', 'To the second one, yes — it’s vacant. The first one has cats.'],
      ],
    },
    {
      key: 'c_jamal', client: 'jamal', channel: 'sms',
      msgs: [
        [-25, '20:00', 'c', 'Hi, I saw a Pinecrest listing on Zillow and your name came up. Looking for a pool home on an acre, 3–5M.'],
        [-25, '20:10', 'me', 'Hi Jamal! Happy to help. Kids? Commute? Any dealbreakers?'],
        [-25, '20:20', 'c', 'Two little ones. Office in Kendall. Pool fence is a must.'],
        [-5, '10:00', 'me', 'Booked: {dow:-3} at 4pm, 6205 Old Banyan Road. It’s vacant and was just reduced.'],
        [-3, '16:25', 'me', 'I’m at Old Banyan Road — running late?'],
        [-3, '17:10', 'c', 'So sorry Alex — Zoe spiked a fever and we ended up at urgent care. Can we reschedule?'],
        [-3, '17:15', 'me', 'Of course — hope she feels better soon. Let’s find a time next week.'],
      ],
    },
    {
      key: 'c_elena', client: 'elena',
      msgs: [
        [-38, '09:00', 'c', 'Hello, I am interested in Sunny Isles oceanfront, high floor, around $5M. I am a cash buyer.'],
        [-38, '09:30', 'me', 'Hello Elena — good timing, there are a few. High floor meaning 30 and up?'],
        [-38, '09:35', 'c', '40 and up. I want to see the horizon, not the beach.'],
        [-14, '18:00', 'me', 'Thank you for today. Oceanique 5201 was the clear favorite — let’s watch it. The seller has been firm at $5.995M.'],
        [-8, '10:57', 'c', 'Not for me, too much house. But beautiful.'],
        [-2, '08:30', 'me', 'News: Oceanique PH 5201 just dropped to $5.65M.', { listing: 'mls_oceanique5201' }],
        [-2, '09:10', 'c', 'Now it is interesting. Can I see it again this week?'],
        [-2, '09:15', 'me', 'How about {dow:5} at 10? I’ll confirm with the listing agent.'],
      ],
    },
    {
      key: 'c_bianca', client: 'bianca',
      msgs: [
        [-44, '13:00', 'c', 'Ciao Alex! I follow your page. I’m looking for a penthouse with a big terrace in Surfside or Bal Harbour. Cash.'],
        [-44, '13:20', 'me', 'Ciao Bianca! A terrace person after my own heart. Budget?'],
        [-44, '13:30', 'c', 'Up to 7.5'],
        [-29, '19:00', 'me', 'Today’s ranking: Mariner PH 2 by a mile — that terrace. The lobby is dated, but the association has already funded the refresh.'],
        [-29, '19:30', 'c', 'The lobby made me sad. The terrace made me happy. Happy wins.'],
        [-9, '15:00', 'me', 'Sorry I missed your call — I was in a listing appointment. Calling you back in ten.'],
        [-2, '17:30', 'me', 'The second visit confirmed it for me too. If you want it, I’d offer $6.85M cash, 10-day inspection, 30-day close.'],
        [-2, '17:45', 'c', 'Do it.'],
        [-1, '17:10', 'me', 'Offer submitted at $6.85M. Marcel promised a response by {dow:0} at 9pm.'],
        [-1, '17:20', 'c', '🤞🤞🤞'],
        [0, '09:20', 'c', 'Any news from Marcel?'],
        [0, '09:31', 'me', 'Not yet — he presents it to the seller at noon. I’ll call you the minute I hear.'],
      ],
    },
    {
      key: 'c_malik', client: 'malik', channel: 'sms',
      msgs: [
        [-57, '18:00', 'c', 'Alex — Malik Adeyemi, we met at the Las Olas open house. I need deep water for my 62-foot sportfish. No fixed bridges. Budget 4 to 7.'],
        [-57, '18:10', 'me', 'Malik! I remember — Reel Patience. Deep water, no fixed bridges, 80+ ft of dock. I’m on it.'],
        [-12, '20:00', 'me', 'Good call tonight. Two candidates so far: 48 Coral Key Isle (100-ft dock) and one on Isle Harbor Court with a fixed bridge between it and the inlet — so really one.'],
        [-8, '10:44', 'c', 'Wait. 90 ft of dock and open bay? Kemi says no to Miami Beach but I want to see it.'],
        [-8, '10:50', 'me', 'Ha — you’re on {dow:-6}’s private preview list. 12:30.'],
        [-1, '15:40', 'me', '48 Coral Key Isle just dropped to $6.4M.', { listing: 'mls_lasolas48' }],
        [-1, '16:05', 'c', 'Can you get the dock-depth survey for 48 Coral Key Isle? Need 8 ft at low tide or it’s a no.', { ask: 'malik_survey' }],
        [-1, '16:10', 'me', 'Asking Grant Okimoto for it now.'],
      ],
    },
    {
      key: 'c_stefan', client: 'stefan', channel: 'sms',
      msgs: [
        [-60, '10:00', 'c', 'Alex, the tenant at 2304 wants to renew but asked for a 5% reduction. Market?'],
        [-60, '10:20', 'me', 'Vela rents are flat to up 3%. I’d renew at the same rent with a fresh coat of paint — you keep a good tenant without leaving money on the table.'],
        [-60, '10:25', 'c', 'Good advice. Done.'],
        [-45, '09:10', 'c', 'Tenant at 1905 is moving out in the spring. Any chance you can find me someone for May?'],
        [-45, '09:25', 'me', 'Absolutely — spring is a good time to lease in Brickell. I’ll start lining up relocation clients in February.'],
        [-30, '09:00', 'me', 'FYI: the ARM on 1905 resets in about three months. Want me to connect you with Marcus Bell to look at a refi?'],
        [-30, '11:00', 'c', 'Call me about it next week.'],
        [-8, '10:44', 'c', 'STOP. Nothing personal Alex — call me for business, no mass texts.'],
      ],
    },
    {
      key: 'c_marcus', client: 'marcus',
      msgs: [
        [-75, '14:00', 'c', 'Sending you a great family — Julien and Camille Delacroix. Pre-approved at $10M, looking bayfront with a big dock. Treat them like gold.'],
        [-75, '14:10', 'me', 'Always. Thank you, Marcus — lunch is on me next week.'],
        [-21, '16:00', 'me', 'The Delacroixs are under contract at $14.9M on Isola Verde, closing {date:dxClose}. Appraisal is the next hurdle.'],
        [-21, '16:10', 'c', 'Great news. Ordering the appraisal today and pushing for our senior appraiser — waterfront needs someone who understands docks.'],
        [-2, '15:00', 'me', 'Appraiser was at Isola Verde this morning. He has the comp package and the seawall credit history.'],
        [-2, '15:20', 'c', 'Perfect. I’ll chase the report — usually three to five days.'],
        [0, '07:40', 'me', 'Morning — any ETA on the Isola Verde appraisal? The Delacroixs are anxious.'],
        [0, '08:15', 'c', 'Calling the AMC at 9. I’ll text you by noon either way.'],
      ],
    },
    {
      key: 'c_hank', client: 'hank', channel: 'sms',
      msgs: [
        [-17, '07:30', 'me', 'Hank — confirming 9am at 41 Isola Verde Drive. Owners request shoe covers; dock access is through the side gate.'],
        [-17, '07:45', 'c', 'Got it. Bringing the seawall camera.'],
        [-17, '14:10', 'c', 'Report uploading now. Seawall cap is the only real item. House is solid.'],
        [-3, '17:00', 'me', 'New one for you: 8120 Banyan Ridge Lane, Pinecrest, {dow:0} at 2pm. The buyers are the Coles — Ethan will ask about the roof.'],
        [-3, '17:20', 'c', 'I’ll bring the drone and the ladder. Tell him both 😄'],
        [0, '07:50', 'me', 'See you at 2 at Banyan Ridge. Gate code is 4471#.'],
        [0, '08:02', 'c', '👍 on it'],
        [0, '08:03', 'c', 'Running the wind-mit form too so they can send it to insurance.'],
      ],
    },
    {
      key: 'c_unknown_sign', client: null, handle: '786-555-0158', channel: 'sms', displayName: '(786) 555-0158', unread: 2,
      msgs: [
        [0, '07:12', 'x', 'Hi, saw your sign on Sunset Drive. Is the house still available? What’s the price?'],
        [0, '07:14', 'x', 'Also is there a dock? It’s for my boss.'],
      ],
    },
    {
      key: 'c_unknown_agent', client: null, handle: '954-555-0134', channel: 'imessage', displayName: 'Marisol Vega (Sandbar Realty?)',
      msgs: [
        [-3, '14:00', 'x', 'Hi Alex, Marisol Vega with Sandbar Realty. Reid Castellano gave me your number. I have a buyer for Golden Beach oceanfront, $25–30M, cash. Anything quiet?'],
        [-3, '14:20', 'me', 'Hi Marisol — thanks for reaching out. Possibly. Can your buyer share proof of funds before a private showing?'],
        [-3, '14:30', 'x', 'Yes, POF from her family office within 24h.'],
        [-3, '14:36', 'x', 'She’s particular — oceanfront only, privacy above everything. Is what you have in mind gated?'],
        [-3, '14:41', 'me', 'Gated, with staff quarters. Send the proof of funds when you have it and I’ll see what I can arrange.'],
        [-2, '10:00', 'x', 'Sent the POF to your email. Let me know!'],
        [-2, '10:30', 'me', 'Received, thank you. I’ll be in touch next week.'],
        [-2, '10:34', 'x', 'Thanks Alex 🙏 She’s in town the week after next if that helps.'],
      ],
    },
    { key: 'c_frederick', client: 'frederick', lane: 'automations', msgs: [] },
    { key: 'c_wes', client: 'wes', lane: 'automations', msgs: [] },
    { key: 'c_preston', client: 'preston', lane: 'automations', channel: 'sms', msgs: [] },
  ];
}

module.exports = { moreThreads, injections };
