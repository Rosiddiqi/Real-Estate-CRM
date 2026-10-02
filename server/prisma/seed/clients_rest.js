// Supporting clients, past clients, sphere, partners and vendors.
module.exports = function restClients(ctx) {
  const bd = (off, year) => (year ? `${year}-${ctx.mmdd(off)}` : ctx.mmdd(off));
  const exp = (off) => ctx.at(off, 12, 0);
  const P = (o) => ({ preferredChannel: 'imessage', deviceMode: 'imessage', ...o });
  const S = (o) => ({ preferredChannel: 'sms', deviceMode: 'sms', deviceModeReason: 'Android — green bubbles', ...o });

  return [
    // ── Active buyers / sellers / renters
    P({
      key: 'lucas', firstName: 'Lucas', lastName: 'Moreau', phone: '305-555-0133', email: 'lucas@moreauhospitality.ca',
      company: 'Moreau Hospitality Group', jobTitle: 'CEO', type: 'buyer', status: 'active', rating: 4, leadSource: 'Website',
      tags: ['bal-harbour', 'cash', 'condo', 'under-contract', 'snowbird'], city: 'Montréal', state: 'QC', birthday: bd(95, 1971),
      personal: { spouse: { name: 'Élise' }, hobbies: ['Skiing in Tremblant', 'Hockey (season tickets)'], wine: 'Northern Rhône', travel: 'In Lyon and Milan most of this month' },
      financing: 'cash_pof', timeline: 'asap', purchasePower: 6500000, since: 47,
      motivation: 'Winters in Florida from November; wants turnkey oceanfront with full service.',
      aiSummary: 'Montreal hotelier buying Residence 1102 at The Aria at Bal Harbour for $5.2M cash. Condo-association approval is the last real item before closing {date:moClose}. He is traveling in Europe — your last text didn’t deliver, so call or email.',
    }),
    P({
      key: 'isabella', firstName: 'Isabella', lastName: 'Ferraro', phone: '786-555-0109', email: 'isabella@ferraroartadvisory.com',
      company: 'Ferraro Art Advisory', jobTitle: 'Art advisor', type: 'renter', status: 'active', rating: 3, leadSource: 'Instagram',
      tags: ['renter', 'first-purchase', 'edgewater', 'art'], street: '60 Vela Bay Walk', unit: '3204', neighborhood: 'Brickell', birthday: bd(58, 1990),
      personal: { pets: ['Lupo — Italian greyhound'], hobbies: ['Art fairs every December', 'Padel'], favoriteRestaurants: ['Mesa Cobalt', 'Nonna Rina'], art: 'Places emerging Latin American painters with collectors' },
      financing: 'prequalified', preApprovalAmount: 2400000, lenderName: 'Meridian Coast Private Bank', timeline: '90d', purchasePower: 3200000, since: 33,
      motivation: 'Lease at Vela Brickell ends {date:+38}; tired of paying $14.5k a month for someone else’s equity.',
      aiSummary: 'Renting at Vela Brickell for $14,500/mo with the lease ending {date:+38}; wants to buy her first place in Edgewater or the Design District at $2–3.2M with wall space for art. Asked yesterday for an intro to a lender — Marcus Bell is the obvious fit.',
    }),
    S({
      key: 'marco', firstName: 'Marco', lastName: 'Bellini', phone: '305-555-0168', email: 'marco@ventomare.com', company: 'Vento Mare', jobTitle: 'Chef-partner',
      type: 'renter', status: 'lead', rating: 2, leadSource: 'Sign call', tags: ['renter', 'south-beach', 'buy-vs-rent'], neighborhood: 'Miami Beach', birthday: bd(141, 1986),
      personal: { hobbies: ['Spearfishing', 'Vintage Vespas'] }, timeline: '6mo', since: 52,
      motivation: 'Lease ends {date:+64}; landlord wants a 9% increase.',
    }),
    P({
      key: 'chloe', firstName: 'Chloe', lastName: 'Park', phone: '646-555-0131', email: 'chloe.park@northlightstudio.design', company: 'Northlight Studio', jobTitle: 'Design director',
      type: 'renter', status: 'active', rating: 3, leadSource: 'Website', tags: ['renter', 'coconut-grove', 'relocation'], neighborhood: 'Coconut Grove', birthday: bd(186, 1991),
      personal: { pets: ['Miso — shiba inu'], hobbies: ['Bouldering', 'Ceramics'] }, timeline: '90d', since: 29,
      motivation: 'Townhouse lease ends {date:+82}; wants another year of renting before deciding whether to buy.',
    }),
    P({
      key: 'simone', firstName: 'Simone', lastName: 'Laurent', phone: '305-555-0145', email: 'simone@laurentparfums.com', company: 'Maison Laurent Parfums', jobTitle: 'Founder',
      type: 'seller', status: 'active', rating: 4, leadSource: 'Sphere', referredBy: 'camila', tags: ['listing', 'la-gorce', 'price-drop', 'open-house'],
      street: '2741 Fairway Isle Drive', neighborhood: 'La Gorce', birthday: bd(77, 1972),
      personal: { pets: ['Coco — French bulldog'], hobbies: ['Golf at the club', 'Perfume-making'], notes: ['Moving to Paris in January'] },
      timeline: '90d', since: 70,
      motivation: 'Moving the company to Paris in January; wants it sold before the holidays.',
      aiSummary: 'Listed 2741 Fairway Isle Drive in La Gorce with you; after 30 days of showings without an offer she agreed to cut the price from $13.9M to $12.9M (live since {dow:-4}). Open house this Sunday 1–4 — Coco the French bulldog goes to the groomer. Moving to Paris in January.',
    }),
    P({
      key: 'beatriz', firstName: 'Beatriz', lastName: 'Alvarez', phone: '305-555-0177', email: 'beatriz.alvarez@alvarezarq.es', company: 'Alvarez Arquitectura', jobTitle: 'Architect',
      type: 'seller', status: 'active', rating: 4, leadSource: 'Referral', referredBy: 'theo', tags: ['listing', 'coconut-grove', 'under-contract'],
      street: '3417 Mangrove Point Road', neighborhood: 'Coconut Grove', birthday: bd(260, 1979),
      personal: { spouse: { name: 'Tomás', note: 'Transferring to Madrid in January' }, kids: [{ name: 'Inés', age: 10 }], hobbies: ['Sailing dinghies at the Grove'] },
      timeline: '30d', since: 96,
    }),
    P({
      key: 'lydia', firstName: 'Lydia', lastName: 'Fontaine', phone: '305-555-0171', email: 'lydia@fontainecharleston.com', company: 'Fontaine Antiques', jobTitle: 'Owner',
      type: 'seller', status: 'active', rating: 3, leadSource: 'Website', tags: ['listing', 'bal-harbour', 'estate-sale', 'price-drop'],
      city: 'Charleston', state: 'SC', birthday: bd(305, 1966),
      personal: { notes: ['Inherited Residence 1402 from her mother', 'Lives in Charleston — prefers email for documents'] }, timeline: '90d', since: 88,
    }),
    P({
      key: 'bianca', firstName: 'Bianca', lastName: 'Rossi', phone: '305-555-0123', email: 'bianca@rossiatelier.it', company: 'Rossi Atelier', jobTitle: 'Creative director',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Instagram', tags: ['surfside', 'oceanfront', 'offer-out'], neighborhood: 'Miami Beach', birthday: bd(122, 1983),
      personal: { hobbies: ['Paddleboarding at sunrise', 'Vintage couture'], favoriteRestaurants: ['Nonna Rina'] },
      financing: 'cash_pof', timeline: '30d', purchasePower: 7500000, since: 44,
      aiSummary: 'Submitted $6.85M on Penthouse 2 at The Mariner Surfside (asking $7.1M) — cash, 10-day inspection, 30-day close. Listing agent promised a response by tonight. She loves the wraparound terrace and hates the lobby finishes.',
    }),
    P({
      key: 'ava', firstName: 'Ava', lastName: 'Sinclair', phone: '212-555-0183', email: 'ava@sinclairpartners.com', company: 'Sinclair Partners', jobTitle: 'Managing partner',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Developer', referredBy: 'lorenzo', tags: ['pre-construction', 'casa-palmera', 'penthouse'],
      city: 'New York', state: 'NY', birthday: bd(214, 1980), personal: { hobbies: ['Long-distance running', 'Sailing'], kids: [{ name: 'Theodora', age: 7 }] },
      financing: 'cash_pof', timeline: '12mo', purchasePower: 13000000, since: 61,
    }),
    P({
      key: 'leo', firstName: 'Leonardo', lastName: 'Ricci', displayName: 'Leo Ricci', phone: '305-555-0198', email: 'leo@riccicapital.co', company: 'Ricci Capital', jobTitle: 'VP Sales, Lumina Cloud',
      type: 'investor', status: 'active', rating: 3, leadSource: 'Referral', referredBy: 'kenji', tags: ['investor', 'rentals', 'brickell', 'edgewater'], neighborhood: 'Brickell', birthday: bd(37, 1988),
      personal: { hobbies: ['Padel', 'F1'] }, financing: 'preapproved', preApprovalAmount: 2600000, lenderName: 'Meridian Coast Private Bank', timeline: '6mo', purchasePower: 3500000, since: 24,
    }),
    P({
      key: 'tessa', firstName: 'Tessa', lastName: 'Langford', phone: '786-555-0140', email: 'tessa@corestudiomb.com', company: 'Core Studio MB', jobTitle: 'Owner',
      type: 'buyer', status: 'active', rating: 3, leadSource: 'Referral', referredBy: 'camila', tags: ['miami-beach', 'modern', 'first-luxury'], neighborhood: 'Miami Beach', birthday: bd(98, 1989),
      personal: { pets: ['Rocco — rescue pit mix'], hobbies: ['Pilates (owns a studio)', 'Surfing'] },
      financing: 'preapproved', preApprovalAmount: 3600000, lenderName: 'Coastal Federal Jumbo Lending', timeline: '90d', purchasePower: 4500000, since: 21,
    }),
    P({
      key: 'elena', firstName: 'Elena', lastName: 'Petrova', phone: '305-555-0189', email: 'elena@petrovadance.com', company: 'Petrova Dance Academy', jobTitle: 'Artistic director',
      type: 'buyer', status: 'active', rating: 3, leadSource: 'Zillow', tags: ['sunny-isles', 'oceanfront', 'condo'], neighborhood: 'Sunny Isles', birthday: bd(167, 1975),
      personal: { hobbies: ['Ballet (former principal dancer)', 'Sunrise beach walks'] }, financing: 'cash_pof', timeline: '90d', purchasePower: 6000000, since: 39,
    }),
    S({
      key: 'malik', firstName: 'Malik', lastName: 'Adeyemi', phone: '954-555-0116', email: 'malik@adeyemilogistics.com', company: 'Adeyemi Logistics', jobTitle: 'Founder',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Open house', tags: ['las-olas', 'deep-water', 'boater', 'sportfish'], city: 'Weston', state: 'FL', zip: '33327', birthday: bd(51, 1979),
      personal: { spouse: { name: 'Kemi' }, kids: [{ name: 'Tobi', age: 14 }, { name: 'Ada', age: 11 }], boats: [{ name: 'Reel Patience', lengthFt: 62, kind: 'sportfish', note: 'Needs 8 ft at low tide, no fixed bridges to the inlet' }], hobbies: ['Offshore tournaments'] },
      financing: 'preapproved', preApprovalAmount: 4200000, lenderName: 'Coastal Federal Jumbo Lending', timeline: '6mo', purchasePower: 7000000, since: 57,
      aiSummary: 'Weston owner who wants deep water off Las Olas for his 62-ft sportfish — no fixed bridges, 8 ft at low tide, 80+ ft of dock. Pre-approved for $4.2M; would sell Weston after buying. Asked yesterday for the dock-depth survey on the Las Olas Isles listing.',
    }),
    P({
      key: 'jonah', firstName: 'Jonah', lastName: 'Feld', phone: '305-555-0159', email: 'jonah@feldcapital.com', company: 'Feld Capital', jobTitle: 'Retired PE partner',
      type: 'buyer_seller', status: 'active', rating: 4, leadSource: 'Referral', referredBy: 'william', tags: ['past-client', 'jupiter-island', 'golf'], neighborhood: 'Pinecrest', birthday: bd(279, 1960),
      personal: { spouse: { name: 'Ruth' }, hobbies: ['Golf (8 handicap)', 'Birding'] }, financing: 'cash_pof', timeline: '6mo', purchasePower: 9000000, since: 160,
    }),
    P({
      key: 'victor', firstName: 'Victor', lastName: 'Hartmann', phone: '305-555-0155', email: 'victor@hartmannwerke.de', company: 'Hartmann Werke', jobTitle: 'Chairman',
      type: 'investor', status: 'active', rating: 4, leadSource: 'Sphere', tags: ['golden-beach', 'land', 'build', 'oceanfront'], neighborhood: 'Golden Beach', birthday: bd(330, 1962),
      personal: { spouse: { name: 'Ilse' }, hobbies: ['Classic Porsches', 'Kite surfing'] }, financing: 'cash_pof', timeline: '12mo', purchasePower: 28000000, since: 210,
    }),
    P({
      key: 'owen', firstName: 'Owen', lastName: 'Fitzgerald', phone: '305-555-0112', email: 'owen@fitzgeraldarch.com', company: 'Fitzgerald Architecture', jobTitle: 'Principal',
      type: 'buyer', status: 'sphere', rating: 3, leadSource: 'Sphere', tags: ['sphere', 'referral-out', 'aspen'], neighborhood: 'Coconut Grove', birthday: bd(150, 1976),
      personal: { spouse: { name: 'Hannah' }, hobbies: ['Skiing', 'Sketching'] }, timeline: '90d', since: 900,
    }),
    S({
      key: 'jamal', firstName: 'Jamal', lastName: 'Henderson', phone: '786-555-0165', email: 'jhenderson@hendersonortho.com', company: 'Henderson Orthodontics', jobTitle: 'Orthodontist',
      type: 'buyer', status: 'lead', rating: 2, leadSource: 'Zillow', tags: ['pinecrest', 'pool', 'family'], city: 'Kendall', state: 'FL', birthday: bd(199, 1985),
      personal: { kids: [{ name: 'Zoe', age: 6 }, { name: 'Miles', age: 3 }] }, financing: 'prequalified', preApprovalAmount: 3500000, timeline: '6mo', purchasePower: 4500000, since: 26,
    }),
    P({
      key: 'noah', firstName: 'Noah', lastName: 'Brandt', phone: '917-555-0179', email: 'nbrandt@brandtlitigation.com', company: 'Brandt Litigation', jobTitle: 'Partner',
      type: 'buyer', status: 'lead', rating: 2, leadSource: 'Website', tags: ['relocation', 'coral-gables'], city: 'New York', state: 'NY', birthday: bd(240, 1982),
      timeline: '6mo', purchasePower: 5000000, since: 6,
    }),
    P({
      key: 'sofia', firstName: 'Sofia', lastName: 'Castellanos', phone: '305-555-0178', email: 'sofia@castellanosgroup.com', type: 'buyer', status: 'lead', rating: 2, leadSource: 'Open house',
      tags: ['bal-harbour', 'sunny-isles', 'waitlist'], birthday: bd(318, 1969), timeline: '12mo', purchasePower: 4000000, since: 112,
    }),
    P({
      key: 'ingrid', firstName: 'Ingrid', lastName: 'Solberg', phone: '786-555-0113', email: 'ingrid@solbergshipping.no', company: 'Solberg Shipping', jobTitle: 'Board member',
      type: 'buyer', status: 'lead', rating: 3, leadSource: 'Open house', tags: ['open-house', 'la-gorce', 'international'], city: 'Oslo', state: null, birthday: bd(70, 1978),
      timeline: '6mo', purchasePower: 9000000, since: 5,
    }),
    P({
      key: 'patrick', firstName: 'Patrick', lastName: 'Doyle', phone: '786-555-0126', email: 'pdoyle@doylebuilds.com', company: 'Doyle Builders', jobTitle: 'Owner',
      type: 'buyer', status: 'lead', rating: 1, leadSource: 'Sign call', tags: ['sign-call', 'sunset-islands'], birthday: bd(110, 1973), timeline: 'someday', since: 7,
    }),

    // ── Past clients (deal history lives in deals.js)
    P({ key: 'adrian', firstName: 'Adrian', lastName: 'Kessler', phone: '917-555-0144', email: 'adrian@kesslerfamilytrust.com', company: 'Kessler Family Trust', jobTitle: 'Trustee', type: 'seller', status: 'past_client', rating: 4, leadSource: 'Website', tags: ['past-client', 'surfside', 'just-sold'], city: 'New York', state: 'NY', birthday: bd(267, 1964), personal: { spouse: { name: 'Naomi' }, hobbies: ['Opera', 'Squash'] }, since: 140 }),
    P({ key: 'sebastian', firstName: 'Sebastian', lastName: 'Duarte', phone: '305-555-0115', email: 'sebastian@duartestudio.com', company: 'Duarte Studio', jobTitle: 'Film producer', type: 'buyer', status: 'past_client', rating: 5, leadSource: 'Instagram', tags: ['past-client', 'coral-gables', 'just-closed'], street: '1215 Alhambra Vista Court', neighborhood: 'Coral Gables', birthday: bd(178, 1984), personal: { spouse: { name: 'Ana' }, kids: [{ name: 'Lucas', age: 2 }], pets: ['Taco — dachshund'], hobbies: ['Vinyl', 'Grilling'], notes: ['Housewarming Saturday'] }, since: 120 }),
    P({ key: 'meredith', firstName: 'Meredith', lastName: 'Vance', phone: '617-555-0129', email: 'meredith@vancefoundation.org', company: 'Vance Foundation', jobTitle: 'Executive director', type: 'buyer', status: 'past_client', rating: 4, leadSource: 'Website', tags: ['past-client', 'bal-harbour', 'the-aria', 'just-closed'], street: '10 Harbour Crest Way', unit: '905', neighborhood: 'Bal Harbour', birthday: bd(352, 1958), personal: { hobbies: ['Bridge', 'Watercolor'], notes: ['Boston → full-time Florida'] }, since: 210 }),
    P({ key: 'henrik', firstName: 'Henrik', lastName: 'Larsen', phone: '305-555-0191', email: 'henrik@larsenmarine.dk', company: 'Larsen Marine', jobTitle: 'CEO', type: 'buyer', status: 'past_client', rating: 5, leadSource: 'Sphere', tags: ['past-client', 'key-biscayne', 'referrer'], neighborhood: 'Key Biscayne', birthday: bd(13, 1970), personal: { spouse: { name: 'Freja' }, hobbies: ['Sailing', 'Aquavit'] }, lastTouch: 33, since: 400 }),
    P({ key: 'olivia', firstName: 'Olivia', lastName: 'Marlow', phone: '305-555-0136', email: 'olivia@marlowpr.com', company: 'Marlow PR', jobTitle: 'Founder', type: 'seller', status: 'past_client', rating: 4, leadSource: 'Website', tags: ['past-client', 'brickell'], city: 'Austin', state: 'TX', birthday: bd(90, 1981), lastTouch: 120, since: 330 }),
    P({ key: 'theo', firstName: 'Theo', lastName: 'Grant', phone: '786-555-0154', email: 'theo@grantandco.studio', company: 'Grant & Co.', jobTitle: 'Brand strategist', type: 'buyer', status: 'past_client', rating: 4, leadSource: 'Referral', referredBy: 'henrik', tags: ['past-client', 'coconut-grove', 'referrer'], neighborhood: 'Coconut Grove', birthday: bd(45, 1987), personal: { spouse: { name: 'Jess' }, pets: ['Banjo — beagle'] }, lastTouch: 96, since: 290 }),
    P({ key: 'amara', firstName: 'Amara', lastName: 'Reyes', phone: '786-555-0176', email: 'amara@reyesmed.com', company: 'Reyes Dermatology', jobTitle: 'Dermatologist', type: 'buyer', status: 'past_client', rating: 4, leadSource: 'Open house', tags: ['past-client', 'edgewater'], neighborhood: 'Edgewater', birthday: bd(204, 1986), lastTouch: 75, since: 250 }),
    P({ key: 'william', firstName: 'William', lastName: 'Thornton', displayName: 'Bill Thornton', phone: '305-555-0118', email: 'bill@thorntonholdings.com', company: 'Thornton Holdings', jobTitle: 'Chairman', type: 'seller', status: 'past_client', rating: 5, leadSource: 'Sphere', tags: ['past-client', 'gables-estates', 'referrer'], city: 'Palm Beach', state: 'FL', birthday: bd(190, 1952), personal: { spouse: { name: 'Patricia' }, hobbies: ['Bird hunting', 'Tennis'] }, lastTouch: 60, since: 420 }),
    S({ key: 'preston', firstName: 'Preston', lastName: 'Hale', phone: '561-555-0172', email: 'preston@halemotors.com', company: 'Hale Motor Group', jobTitle: 'Owner', type: 'seller', status: 'past_client', rating: 3, leadSource: 'Website', tags: ['past-client', 'palm-beach'], city: 'Jupiter', state: 'FL', birthday: bd(282, 1965), since: 300 }),
    P({ key: 'grace', firstName: 'Grace', lastName: 'Whitmore', phone: '954-555-0125', email: 'grace@whitmorevet.com', company: 'Whitmore Veterinary', jobTitle: 'Veterinarian', type: 'buyer', status: 'past_client', rating: 4, leadSource: 'Instagram', tags: ['past-client', 'las-olas'], neighborhood: 'Las Olas', birthday: bd(115, 1983), personal: { pets: ['Three rescue greyhounds'] }, lastTouch: 40, since: 190 }),
    P({ key: 'kenji', firstName: 'Kenji', lastName: 'Watanabe', phone: '310-555-0163', email: 'kenji@watanabe.design', company: 'Lumina Cloud', jobTitle: 'Head of Design', type: 'buyer', status: 'past_client', rating: 5, leadSource: 'Referral', referredBy: 'henrik', tags: ['past-client', 'brickell', 'referrer', 'move-up'], neighborhood: 'Brickell', birthday: bd(160, 1989), personal: { hobbies: ['Film photography', 'Omakase'], notes: ['Dreams of Sunset Islands in 3–4 years'] }, since: 150 }),
    P({ key: 'celeste', firstName: 'Celeste', lastName: 'Moreno', phone: '561-555-0157', email: 'celeste@morenodesign.co', type: 'buyer', status: 'past_client', rating: 4, leadSource: 'Zillow', tags: ['past-client', 'boca-raton', 'anniversary'], neighborhood: 'Boca Raton', birthday: bd(222, 1977), personal: { spouse: { name: 'Raúl' }, kids: [{ name: 'Mía', age: 13 }] }, lastTouch: 160, since: 470 }),
    P({ key: 'joel', firstName: 'Joel', lastName: 'Stein', phone: '305-555-0185', email: 'joel@steinortho.com', company: 'Stein Orthopedics', jobTitle: 'Surgeon', type: 'buyer', status: 'past_client', rating: 3, leadSource: 'Website', tags: ['past-client', 'pinecrest', 'anniversary'], neighborhood: 'Pinecrest', birthday: bd(71, 1979), personal: { spouse: { name: 'Hannah' }, kids: [{ name: 'Eli', age: 8 }, { name: 'Noa', age: 5 }] }, lastTouch: 210, since: 450 }),
    P({ key: 'dmitri', firstName: 'Dmitri', lastName: 'Volkov', phone: '305-555-0196', email: 'dmitri@volkovinvest.com', type: 'investor', status: 'past_client', rating: 3, leadSource: 'Zillow', tags: ['past-client', 'sunny-isles', 'investor'], birthday: bd(125, 1974), lastTouch: 300, since: 640 }),
    P({ key: 'frederick', firstName: 'Frederick', lastName: 'Ashby', phone: '305-555-0147', email: 'fred@ashbylaw.com', company: 'Ashby & Lane', jobTitle: 'Attorney (retired)', type: 'seller', status: 'past_client', rating: 3, leadSource: 'Sign call', tags: ['past-client', 'coral-gables'], city: 'Naples', state: 'FL', birthday: bd(343, 1950), since: 560 }),
    P({ key: 'sterling', firstName: 'Sterling', lastName: 'Hayes', phone: '305-555-0110', email: 'sterling@hayesbridge.com', company: 'Hayesbridge Capital', jobTitle: 'Managing partner', type: 'investor', status: 'past_client', rating: 5, isWhale: true, leadSource: 'Sphere', tags: ['past-client', 'whale', 'fisher-island', 'indian-creek', 'referrer'], neighborhood: 'Indian Creek', birthday: bd(12), personal: { spouse: { name: 'Celine' }, hobbies: ['Big-game fishing', 'Wine auctions'], wine: 'Old Barolo', boats: [{ name: 'Quiet Money', lengthFt: 110, kind: 'expedition yacht' }] }, financing: 'cash_pof', purchasePower: 60000000, lastTouch: 41, since: 1200 }),
    P({ key: 'wes', firstName: 'Wes', lastName: 'Monroe', phone: '786-555-0149', email: 'wes@monroebrewing.com', company: 'Monroe Brewing', jobTitle: 'Founder', type: 'buyer', status: 'past_client', rating: 3, leadSource: 'Open house', tags: ['past-client', 'coconut-grove', 'anniversary'], neighborhood: 'Coconut Grove', birthday: bd(236, 1984), personal: { spouse: { name: 'Talia' } }, since: 1500 }),

    // ── Sphere, landlords, developer, inactive
    P({ key: 'camila', firstName: 'Camila', lastName: 'Ortega', phone: '305-555-0103', email: 'camila@solyogagrove.com', company: 'Sol Yoga Grove', jobTitle: 'Owner', type: 'sphere', status: 'sphere', rating: 3, leadSource: 'Sphere', tags: ['sphere', 'referrer', 'birthday'], neighborhood: 'Coconut Grove', birthday: bd(1, 1985), personal: { hobbies: ['Teaches 7am vinyasa'], notes: ['Sent Simone and Tessa'] }, since: 1300 }),
    P({ key: 'james', firstName: 'James', lastName: 'Calloway', phone: '305-555-0105', email: 'james@callowayfit.com', company: 'Calloway Fitness', jobTitle: 'Owner', type: 'seller', status: 'sphere', rating: 3, leadSource: 'Sphere', tags: ['sphere', 'arm-reset', 'brickell', 'neighbor'], street: '1550 Brickell Shore Drive', unit: '2207', neighborhood: 'Brickell', birthday: bd(87), since: 1100 }),
    P({ key: 'maya', firstName: 'Maya', lastName: 'Goldstein', phone: '305-555-0107', email: 'maya@goldsteinventures.vc', company: 'Goldstein Ventures', jobTitle: 'Partner', type: 'sphere', status: 'sphere', rating: 4, leadSource: 'Sphere', tags: ['sphere', 'referrer', 'tech'], neighborhood: 'Coral Gables', birthday: bd(301), since: 1000 }),
    S({ key: 'stefan', firstName: 'Stefan', lastName: 'Novak', phone: '305-555-0194', email: 'stefan@novakproperties.com', company: 'Novak Properties', jobTitle: 'Owner', type: 'landlord', status: 'active', rating: 3, leadSource: 'Website', tags: ['landlord', 'brickell', 'arm-reset', 'call-only'], neighborhood: 'Brickell', birthday: bd(118), since: 700 }),
    P({ key: 'diane', firstName: 'Diane', lastName: 'Mercer', phone: '305-555-0137', email: 'diane@mercerrealtyholdings.com', type: 'landlord', status: 'active', rating: 3, leadSource: 'Referral', referredBy: 'owen', tags: ['landlord', 'coconut-grove'], neighborhood: 'Coconut Grove', birthday: bd(262), since: 500 }),
    P({ key: 'lorenzo', firstName: 'Lorenzo', lastName: 'Vidal', phone: '305-555-0111', email: 'lorenzo@vidalurban.com', company: 'Vidal Urban', jobTitle: 'Developer — Casa Palmera Residences', type: 'developer', status: 'active', rating: 4, leadSource: 'Developer', tags: ['developer', 'casa-palmera', 'allocations'], neighborhood: 'Coconut Grove', birthday: bd(183, 1969), since: 800 }),
    P({ key: 'gordon', firstName: 'Gordon', lastName: 'Pratt', phone: '305-555-0161', email: 'gpratt@prattmedia.com', type: 'buyer', status: 'inactive', rating: 1, leadSource: 'Zillow', tags: ['cold'], birthday: bd(147), since: 610, lastTouch: 95 }),
    P({ key: 'carter', firstName: 'Carter', lastName: 'Wells', phone: '305-555-0164', email: 'carter@wellsfitness.co', type: 'buyer', status: 'inactive', rating: 2, leadSource: 'Instagram', tags: ['lost', 'financing'], birthday: bd(54), since: 200, lastTouch: 60 }),
    P({ key: 'natalie', firstName: 'Natalie', lastName: 'Brooks', phone: '786-555-0139', email: 'natalie@brooksevents.com', type: 'buyer', status: 'inactive', rating: 2, leadSource: 'Website', tags: ['lost'], birthday: bd(274), since: 160, lastTouch: 45 }),
    P({ key: 'imogen', firstName: 'Imogen', lastName: 'Price', phone: '305-555-0146', email: 'imogen@priceandpartners.com', type: 'landlord', status: 'inactive', rating: 2, leadSource: 'Sign call', tags: ['lost', 'withdrawn', 'coconut-grove'], birthday: bd(338), since: 180, lastTouch: 38 }),

    // ── Partners (co-op agents, referral partners, lender, estate attorney)
    P({ key: 'jordan', contactKind: 'partner', vendorRole: 'agent', firstName: 'Jordan', lastName: 'Pierce', phone: '305-555-0102', email: 'jordan@harborkeyrealty.com', company: 'Harbor & Key Realty', jobTitle: 'Associate advisor (co-agent)', type: 'sphere', status: 'active', rating: 4, tags: ['team', 'co-agent'], since: 900 }),
    P({ key: 'nicole', contactKind: 'partner', vendorRole: 'agent', firstName: 'Nicole', lastName: 'Strand', phone: '305-555-0104', email: 'nicole@atlanticaestates.com', company: 'Atlantica Estates', jobTitle: 'Listing agent — 41 Isola Verde', type: 'sphere', status: 'active', rating: 4, tags: ['co-op', 'venetian-islands'], since: 300 }),
    P({ key: 'reid', contactKind: 'partner', vendorRole: 'agent', firstName: 'Reid', lastName: 'Castellano', phone: '305-555-0106', email: 'reid@bayshorecollective.com', company: 'Bayshore Collective Realty', jobTitle: 'Buyer’s agent', type: 'sphere', status: 'active', rating: 3, tags: ['co-op', 'offer-128-sunset'], since: 400 }),
    P({ key: 'brooke', contactKind: 'partner', vendorRole: 'agent', firstName: 'Brooke', lastName: 'Halvorsen', phone: '970-555-0122', email: 'brooke@summitpeakrealty.com', company: 'Summit Peak Realty (Aspen)', jobTitle: 'Referral partner', type: 'sphere', status: 'active', rating: 4, tags: ['referral-partner', 'aspen'], since: 650 }),
    P({ key: 'naomi', contactKind: 'partner', vendorRole: 'referral', firstName: 'Naomi', lastName: 'Achterberg', phone: '312-555-0117', email: 'naomi@northstarrelo.com', company: 'Northstar Relocation', jobTitle: 'Relocation director', type: 'sphere', status: 'active', rating: 4, tags: ['referral-partner', 'relocation'], since: 500 }),
    P({ key: 'marcus', contactKind: 'partner', vendorRole: 'lender', firstName: 'Marcus', lastName: 'Bell', phone: '305-555-0108', email: 'mbell@meridiancoastbank.com', company: 'Meridian Coast Private Bank', jobTitle: 'SVP, Private Mortgage', type: 'sphere', status: 'active', rating: 5, tags: ['lender', 'jumbo', 'referrer'], since: 1400 }),
    P({ key: 'eleanor', contactKind: 'partner', vendorRole: 'attorney', firstName: 'Eleanor', lastName: 'Rios', phone: '305-555-0114', email: 'erios@rioscalder.law', company: 'Rios & Calder Estate Law', jobTitle: 'Estate & trust attorney', type: 'sphere', status: 'active', rating: 4, tags: ['attorney', 'trusts', 'probate'], since: 1100 }),

    // ── Vendors
    S({ key: 'hank', contactKind: 'vendor', vendorRole: 'inspector', firstName: 'Hank', lastName: 'Morrow', phone: '786-555-0141', email: 'hank@morrowcoastal.com', company: 'Morrow Coastal Inspections', jobTitle: 'Lead inspector (seawalls, roofs, wind mitigation)', type: 'sphere', status: 'active', rating: 5, tags: ['inspector'], since: 1300 }),
    P({ key: 'lena', contactKind: 'vendor', vendorRole: 'stager', firstName: 'Lena', lastName: 'Marchetti', phone: '305-555-0124', email: 'lena@marchettistaging.com', company: 'Marchetti Staging & Design', jobTitle: 'Principal stager', type: 'sphere', status: 'active', rating: 5, tags: ['stager'], since: 1000 }),
    P({ key: 'kai', contactKind: 'vendor', vendorRole: 'photographer', firstName: 'Kai', lastName: 'Nakamura', phone: '786-555-0153', email: 'kai@lumenestatesmedia.com', company: 'Lumen Estates Media', jobTitle: 'Photo, drone & film', type: 'sphere', status: 'active', rating: 5, tags: ['photographer', 'drone'], since: 950 }),
    P({ key: 'rachel', contactKind: 'vendor', vendorRole: 'title', firstName: 'Rachel', lastName: 'Ostrowski', phone: '305-555-0128', email: 'rachel@baylinetitle.com', company: 'Bayline Title & Escrow', jobTitle: 'Senior closing agent', type: 'sphere', status: 'active', rating: 5, tags: ['title', 'escrow'], since: 1200 }),
    P({ key: 'daniela', contactKind: 'vendor', vendorRole: 'private_banker', firstName: 'Daniela', lastName: 'Ruiz', phone: '305-555-0132', email: 'druiz@brightwaterprivate.com', company: 'Brightwater Private Bank', jobTitle: 'Private banker', type: 'sphere', status: 'active', rating: 4, tags: ['private-banker', 'pof-letters'], since: 800 }),
  ];
};
