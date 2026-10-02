// Hero + key clients. Each entry carries an internal `key` (stripped before
// insert) and `since` (days ago the contact was created). Birthdays and other
// dates are relative to the seed run so the demo always looks live.
module.exports = function coreClients(ctx) {
  const bd = (off, year) => (year ? `${year}-${ctx.mmdd(off)}` : ctx.mmdd(off));
  const exp = (off) => ctx.at(off, 12, 0);

  return [
    // ── 1. The Delacroix family (group chat, under contract on the Venetian Islands)
    {
      key: 'julien', firstName: 'Julien', lastName: 'Delacroix', phone: '305-555-0142', email: 'julien@delacroixmaritime.com',
      company: 'Delacroix Maritime Logistics', jobTitle: 'Founder & CEO',
      type: 'buyer', status: 'active', rating: 5, isWhale: true, leadSource: 'Referral', referredBy: 'marcus',
      tags: ['waterfront', 'boater', 'relocation', 'under-contract'],
      street: '2900 Bayshore Villas Court', unit: '4', neighborhood: 'Coconut Grove', birthday: bd(118, 1980),
      personal: {
        spouse: { name: 'Camille', birthday: ctx.mmdd(201) },
        pets: ['Otis — Bernese mountain dog'],
        hobbies: ['Offshore sailing', 'Saturday rides over the Rickenbacker', 'Cooking for friends'],
        clubs: ['Grove Harbour Yacht Club'],
        favoriteRestaurants: ['Le Petit Quai (Coconut Grove)', 'Osteria Vela'],
        wine: 'Burgundy — white Meursault, keeps ~600 bottles in storage until they have a cellar',
        boats: [{ name: 'Belle Rive', lengthFt: 82, kind: 'motor yacht', note: 'Back from the Med in November; needs 90 ft of dock with room for the tender' }],
        art: 'Camille shoots large-format black-and-white seascapes',
        origin: 'Lyon, France', languages: ['French', 'English'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', deviceModeReason: 'Blue bubbles in group chat',
      financing: 'preapproved', preApprovalAmount: 10000000, preApprovalExpires: exp(48), lenderName: 'Meridian Coast Private Bank',
      timeline: 'asap', motivation: 'Boat returns from the Mediterranean in November and needs a 90-ft dock; the kids are settled at Biscayne Prep.',
      purchasePower: 16000000, since: 74,
      aiSummary: 'Under contract on 41 Isola Verde Drive ($14.9M) — the 92-ft dock was the deal-maker for Belle Rive. Inspection is cleared; the appraisal is the open item, and Camille is the one asking for updates. Closing is set for {date:dxClose}.',
      aiFacts: {
        mustHaves: ['90+ ft dock, no fixed bridges', 'Bayfront, east or south exposure', 'Wine room', 'Home office for Julien'],
        touchPoints: ['Léa’s Biscayne Prep application', 'Otis needs a fenced yard', 'Belle Rive arrives mid-November'],
        style: 'Julien wants numbers; Camille wants reassurance and timelines.',
      },
    },
    {
      key: 'camille', firstName: 'Camille', lastName: 'Delacroix', phone: '305-555-0143', email: 'camille@camilledelacroix.studio',
      company: 'Camille Delacroix Studio', jobTitle: 'Photographer',
      type: 'buyer', status: 'active', rating: 5, leadSource: 'Referral', referredBy: 'marcus',
      tags: ['waterfront', 'under-contract'], neighborhood: 'Coconut Grove', birthday: bd(201),
      personal: {
        spouse: { name: 'Julien' },
        hobbies: ['Large-format photography', 'Morning swims at Matheson Hammock', 'Farmers market Saturdays'],
        favoriteRestaurants: ['Le Petit Quai'], coffee: 'Cortado, oat milk',
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', timeline: 'asap', since: 74,
    },

    // ── 2. Victoria Ashcombe — whale relocating from Manhattan
    {
      key: 'victoria', firstName: 'Victoria', lastName: 'Ashcombe', phone: '212-555-0119', email: 'victoria@ashcombecap.com',
      company: 'Ashcombe Capital Partners', jobTitle: 'Founder & CIO',
      type: 'buyer', status: 'active', rating: 5, isWhale: true, leadSource: 'Referral', referredBy: 'sterling',
      tags: ['whale', 'oceanfront', 'relocation', 'cash', 'privacy'],
      city: 'New York', state: 'NY', zip: '10013', birthday: bd(156, 1974),
      personal: {
        pets: ['Pip & Juno — whippets'],
        hobbies: ['Open-water swimming', 'Reformer pilates at 6am', 'Mid-century Italian design'],
        favoriteRestaurants: ['Osteria Vela (Bal Harbour)', 'Casa Lumen'],
        wine: 'Grower Champagne; never orders red with fish',
        art: 'Post-war abstraction — needs one 20-ft uninterrupted wall for a large canvas',
        assistant: { name: 'Margot Lyle', role: 'Executive assistant', note: 'Schedules everything; copy her on logistics, never on price' },
        notes: ['Establishing Florida domicile before year-end', 'Hates being sold to — lead with what is wrong with a house'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage',
      financing: 'cash_pof', timeline: '90d', purchasePower: 45000000,
      motivation: 'Moving her family office to Florida and wants domicile established before year-end; oceanfront or nothing.',
      since: 41,
      aiSummary: 'Cash buyer at $25–45M relocating her fund from Manhattan; oceanfront only, with privacy and staff quarters. She passed on three Golden Beach houses for ceiling heights and setbacks, but the owner-quiet Golden Beach whisper and the {date:-3} price cut at 455 Seagrape Shore Drive (now $29.5M) are live. Dinner tonight at Osteria Vela.',
      aiFacts: {
        mustHaves: ['Oceanfront with private beach', 'Gated + staff quarters', '12-ft+ ceilings', 'Gym + spa'],
        dealBreakers: ['Busy A1A frontage', 'Visible from neighbors’ terraces'],
        touchPoints: ['Clementine visits for Thanksgiving', 'Swims at 6am — never call before 8'],
      },
    },

    // ── 3. The Whitakers — selling 128 Sunset Drive
    {
      key: 'graham', firstName: 'Graham', lastName: 'Whitaker', phone: '305-555-0151', email: 'graham@whitakerventures.com',
      company: 'Whitaker Ventures', jobTitle: 'Investor (sold Tidewire Software)',
      type: 'buyer_seller', status: 'active', rating: 5, isWhale: true, leadSource: 'Referral', referredBy: 'william',
      tags: ['listing', 'sunset-islands', 'palm-beach-next', 'boater'],
      street: '128 Sunset Drive', neighborhood: 'Sunset Islands', birthday: bd(87, 1968),
      personal: {
        spouse: { name: 'Sloane' },
        pets: ['Biscuit — golden retriever'],
        hobbies: ['Tennis (4.0, plays doubles Tuesdays)', 'Inshore fishing'],
        boats: [{ name: 'Second Wind', lengthFt: 39, kind: 'center console' }],
        clubs: ['Lake Trail Tennis Club (Palm Beach, joining)'],
        wine: 'Napa Cabernet', favoriteRestaurants: ['Marlowe’s Fish Bar'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', timeline: '90d',
      motivation: 'Twins are off at college; trading the Sunset Islands house for an in-town Palm Beach place with less to manage.',
      purchasePower: 14000000, since: 63,
      aiSummary: 'Selling 128 Sunset Drive at $18.75M; the first offer ($17.2M, Reid Castellano’s Greenwich buyer) landed last night. Graham says they won’t go below $18M and wants your read on the buyer. Next they buy in-town Palm Beach.',
      aiFacts: { touchPoints: ['Biscuit goes to daycare during showings', 'Graham plays tennis Tuesday nights'], style: 'Decisive; wants a recommendation, not options.' },
    },
    {
      key: 'sloane', firstName: 'Sloane', lastName: 'Whitaker', phone: '305-555-0152', email: 'sloane@sloanewhitakerinteriors.com',
      company: 'Sloane Whitaker Interiors', jobTitle: 'Interior designer',
      type: 'buyer_seller', status: 'active', rating: 5, leadSource: 'Referral', referredBy: 'william',
      tags: ['listing', 'sunset-islands', 'design'], neighborhood: 'Sunset Islands', birthday: bd(244),
      personal: { spouse: { name: 'Graham' }, hobbies: ['Ceramics', 'Orchids', 'Estate sales'], favoriteRestaurants: ['Marlowe’s Fish Bar'] },
      preferredChannel: 'imessage', deviceMode: 'imessage', since: 63,
    },

    // ── 4. Charles & Margaret Lowell — listing presentation today
    {
      key: 'charles', firstName: 'Charles', lastName: 'Lowell', phone: '305-555-0160', email: 'clowell@lowellfamilyoffice.com',
      company: 'Lowell Family Office', jobTitle: 'Retired — former CEO, Atlantic Hull Underwriters',
      type: 'seller', status: 'active', rating: 4, isWhale: true, leadSource: 'Referral', referredBy: 'harold',
      tags: ['estate', 'waterfront', 'downsizing', 'listing-appt', 'gables-estates'],
      street: '11 Coral Isle Way', neighborhood: 'Gables Estates', birthday: bd(301, 1959),
      personal: {
        spouse: { name: 'Margaret', note: 'Chairs the gala committee at Bayview Heart Institute' },
        hobbies: ['Golf with Harold Brennan', 'Summers in Highlands, NC'],
        clubs: ['Coral Bay Golf Club'],
        boats: [{ name: 'Margaret Rose', lengthFt: 64, kind: 'sportfish', note: 'Selling with the house' }],
        wine: 'Bordeaux; ask about the 1982s', favoriteRestaurants: ['The Grove Room'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', timeline: '6mo',
      motivation: 'Kids and grandkids are spread out; the estate is too much house and the boat hasn’t left the dock since spring.',
      since: 22,
      aiSummary: 'Gables Estates estate on 1.4 acres with 245 ft of bay frontage — pricing conversation is $21–22.5M. Referred by Harold Brennan; interviewing two other firms. Listing presentation today at 4:00 at the house; Margaret cares most about privacy during showings.',
      aiFacts: {
        sellSignals: ['“The boat hasn’t left the dock since spring.”', '“Margaret wants one floor, no stairs.”'],
        competing: ['Atlantica Estates', 'Gilded Key Real Estate'],
        style: 'Old-school; prefers a call to a text, a printed book to a PDF.',
      },
    },

    // ── 5. Harold & June Brennan — ARM reset + downsizing
    {
      key: 'harold', firstName: 'Harold', lastName: 'Brennan', phone: '305-555-0127', email: 'harold.brennan@brennanbourbon.com',
      company: 'Retired', jobTitle: 'Former regional bank president',
      type: 'buyer_seller', status: 'past_client', rating: 4, leadSource: 'Open house',
      tags: ['past-client', 'arm-reset', 'downsizing', 'referrer', 'key-biscayne'],
      street: '260 Harbor Palm Lane', neighborhood: 'Key Biscayne', birthday: bd(6, 1955),
      personal: {
        spouse: { name: 'June', note: 'Knee replacement in August — stairs are the issue' },
        hobbies: ['Golf (Coral Bay, with Charles Lowell)', 'Small-batch bourbon', 'Summers in Highlands, NC'],
        clubs: ['Coral Bay Golf Club'], favoriteRestaurants: ['Rusty Anchor Grill (Key Biscayne)'],
        wine: 'Bourbon over wine — loves a wheated bourbon',
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', timeline: '6mo',
      motivation: 'The 5/1 ARM resets {date:+74} and June can’t do stairs after her knee surgery; thinking one-level oceanfront condo.',
      since: 2200, lastTouch: 4,
      aiSummary: 'Bought 260 Harbor Palm Lane with you in 2021; the 5/1 ARM at 3.125% resets around {date:+74} and June can’t manage stairs. He’s watching The Aria at Bal Harbour (Residence 1402 just dropped to $6.45M). He also referred Charles Lowell — birthday is {date:+6}.',
      aiFacts: { sellSignals: ['“We don’t need six bedrooms for two people and a golden retriever’s ghost.”'], touchPoints: ['Birthday {date:+6}', 'Grandkids visit at Thanksgiving'] },
    },

    // ── 6. Priya Raman — relocating founder, consult today
    {
      key: 'priya', firstName: 'Priya', lastName: 'Raman', phone: '415-555-0138', email: 'priya@ledgerline.io',
      company: 'Ledgerline', jobTitle: 'Co-founder & CEO',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Referral', referredBy: 'maya',
      tags: ['relocation', 'tech', 'coconut-grove', 'coral-gables'],
      city: 'San Francisco', state: 'CA', zip: '94123', birthday: bd(173, 1987),
      personal: {
        spouse: { name: 'Dev', note: 'ML researcher, works remote; wants a real office with a door' },
        pets: ['Mochi — Ragdoll cat'],
        hobbies: ['Triathlon (training for Escape the Cape)', 'Tennis', 'Vegetarian cooking'],
        schools: ['Biscayne Prep (applied)', 'Gables Montessori Academy'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage',
      financing: 'preapproved', preApprovalAmount: 5200000, preApprovalExpires: exp(75), lenderName: 'Meridian Coast Private Bank',
      timeline: '90d', motivation: 'Moving the company’s HQ to Miami; wants the kids enrolled by January.', purchasePower: 7500000, since: 19,
      aiSummary: 'Relocating Ledgerline from San Francisco with husband Dev. Pre-approved for $5.2M with SF sale proceeds behind it; schools drive the search — Coconut Grove or the Gables, walkable, with a real office for Dev. Buyer consult today at 9:30.',
      aiFacts: { mustHaves: ['Top school zone', 'Home office x2', 'Pool with fence', 'Walkable'], touchPoints: ['Training for a triathlon', 'Vegetarian'] },
    },

    // ── 7. Ethan & Mara Cole — inspection today in Pinecrest
    {
      key: 'ethan', firstName: 'Ethan', lastName: 'Cole', phone: '786-555-0187', email: 'ethan@banyanspirits.com',
      company: 'Banyan Spirits', jobTitle: 'Co-founder',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Zillow',
      tags: ['pool', 'pinecrest', 'under-contract'],
      street: '7420 Sunrise Hammock Lane', city: 'South Miami', state: 'FL', zip: '33143', birthday: bd(212, 1982),
      personal: {
        spouse: { name: 'Mara' },
        pets: ['Pepper — labradoodle'],
        hobbies: ['Smoking brisket', 'Youth baseball coach', 'Bourbon (makes it)'],
      },
      preferredChannel: 'sms', deviceMode: 'sms', deviceModeReason: 'Android — texts arrive green',
      financing: 'preapproved', preApprovalAmount: 4800000, preApprovalExpires: exp(40), lenderName: 'Coastal Federal Jumbo Lending',
      timeline: 'asap', motivation: 'Outgrew the South Miami house; want Jack and Sadie at Pinecrest Day before spring.', purchasePower: 7000000, since: 380,
      aiSummary: 'Under contract on 8120 Banyan Ridge Lane in Pinecrest at $6.85M. Inspection is today at 2:00 with Hank Morrow; Ethan is focused on the roof and a pool fence for four-year-old Wren. Financing through Coastal Federal is still open.',
    },
    {
      key: 'mara', firstName: 'Mara', lastName: 'Cole', phone: '786-555-0188', email: 'dr.mara@colepediatricdental.com',
      company: 'Cole Pediatric Dental', jobTitle: 'Pediatric dentist',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Zillow', tags: ['pinecrest'], birthday: bd(3, 1984),
      personal: { spouse: { name: 'Ethan' }, hobbies: ['Peloton', 'Book club (first Thursday)'], favoriteRestaurants: ['Trattoria Sole'] },
      preferredChannel: 'imessage', deviceMode: 'imessage', since: 380,
    },

    // ── 8. Rafael Montoya — pre-construction penthouse
    {
      key: 'rafael', firstName: 'Rafael', lastName: 'Montoya', phone: '305-555-0181', email: 'rafael@montoyaholdings.co',
      company: 'Montoya Holdings', jobTitle: 'Principal',
      type: 'investor', status: 'active', rating: 5, isWhale: true, leadSource: 'Developer', referredBy: 'lorenzo',
      tags: ['pre-construction', 'investor', 'whale', 'spanish', 'casa-palmera'],
      street: '1520 Alcazar Vista Way', neighborhood: 'Coral Gables', birthday: bd(64, 1977),
      personal: {
        spouse: { name: 'Lucía' },
        hobbies: ['Polo (Wellington in season)', 'Cigars', 'Salsa'],
        favoriteRestaurants: ['Brasa Norte'], languages: ['Spanish', 'English'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', financing: 'cash_pof', timeline: '12mo', purchasePower: 25000000, since: 520,
      motivation: 'Builds a portfolio of pre-construction units and flips about half at delivery.',
      aiSummary: 'Reserved Penthouse B at Casa Palmera Residences ($9.85M) through the Phase I early release; the second 10% deposit is due {date:rafaelDeposit}. Owns two rented condos in Edgewater and Brickell and is first in line for Phase II. Communicates in quick Spanish-English bursts.',
    },

    // ── 9. Nadia Karimova — Fisher Island, tour today
    {
      key: 'nadia', firstName: 'Nadia', lastName: 'Karimova', phone: '305-555-0174', email: 'nadia@atelierkara.com',
      company: 'Atelier Kara', jobTitle: 'Founder',
      type: 'buyer', status: 'active', rating: 5, isWhale: true, leadSource: 'Concierge',
      tags: ['international', 'cash', 'fisher-island', 'whale'],
      city: 'London', state: null, birthday: bd(229, 1985),
      personal: {
        hobbies: ['Tennis', 'Sound baths', 'Yacht charters in the Grenadines'],
        assistant: { name: 'Lukas Brenner', role: 'Chief of staff', note: 'Handles gate lists, POF and lawyers' },
        languages: ['Russian', 'English', 'French'], wine: 'Rosé Champagne',
      },
      preferredChannel: 'imessage', deviceMode: 'imessage', financing: 'cash_pof', timeline: '90d', purchasePower: 18000000, since: 27,
      motivation: 'Wants a winter base with a school for Timur and real tennis; splits time between London and Dubai.',
      aiSummary: 'All-cash buyer splitting time between London and Dubai, looking for a Fisher Island winter base with a tennis program and a school for her son Timur. Her chief of staff Lukas handles logistics. Private tour of Palmyra Residence 5122 today at 11:00.',
    },

    // ── 10. Daniel Okafor — closing next week
    {
      key: 'daniel', firstName: 'Daniel', lastName: 'Okafor', phone: '786-555-0121', email: 'dokafor@bayviewheart.org',
      company: 'Bayview Heart Institute', jobTitle: 'Chief of Cardiac Surgery',
      type: 'buyer', status: 'active', rating: 4, leadSource: 'Referral', referredBy: 'naomi',
      tags: ['relocation', 'penthouse', 'closing-soon', 'edgewater'], neighborhood: 'Edgewater', birthday: bd(133, 1981),
      personal: {
        spouse: { name: 'Andre', note: 'Architect — cares about light and ceiling heights' },
        hobbies: ['Jazz piano (needs a spot for the Steinway)', 'Road cycling'],
        favoriteRestaurants: ['Mesa Cobalt'],
      },
      preferredChannel: 'imessage', deviceMode: 'imessage',
      financing: 'preapproved', preApprovalAmount: 7000000, preApprovalExpires: exp(30), lenderName: 'Meridian Coast Private Bank',
      timeline: 'asap', motivation: 'Started as chief of cardiac surgery in August; living in corporate housing until closing.', purchasePower: 10000000, since: 58,
      aiSummary: 'Buying Penthouse 4501 at One Harbor Point for $8.95M, co-represented with Jordan Pierce. Clear-to-close is the only open item; final walkthrough {dow:okWalk} and closing {dow:okClose} at Bayline Title. He verified wire instructions by phone, exactly as you asked.',
    },
  ];
};
