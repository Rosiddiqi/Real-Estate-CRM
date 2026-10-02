// Deals: open pipeline, under contract, lost, and closed history (this month,
// earlier this year, last year, older). `path` = [[stage, Date], …] drives
// stage/stageChangedAt/createdAt and the DealEvent history.
const { DAY } = require('./util');

module.exports = function buildDeals(ctx) {
  const o = ctx.off;
  o.dxClose = ctx.bizOff(12); o.dxWalk = o.dxClose - 1; o.dxAppraisal = ctx.bizOff(3); o.dxFinancing = ctx.bizOff(7);
  o.okClose = ctx.nextMondayOff + 3; o.okWalk = o.okClose - 1;
  o.coleClose = ctx.bizOff(28); o.coleAppraisal = ctx.bizOff(6); o.coleInspEnd = ctx.bizOff(7);
  o.alvClose = ctx.bizOff(19); o.moClose = ctx.bizOff(16); o.sunday = ctx.sundayOff;
  o.brokerOpen = ctx.nextMondayOff + 1; o.rafaelDeposit = ctx.bizOff(9);

  const d = (off, h = 10, m = 0) => (off <= 0 ? ctx.past(off, h, m) : ctx.at(off, h, m));
  const before = (base, days) => new Date(base.getTime() - days * DAY);
  const lastNight = ctx.past(-1, 20, 41);

  const buyerPath = (end, last = 'closed', span = [92, 86, 70, 41, 35]) => [
    ['new_lead', before(end, span[0])], ['consultation', before(end, span[1])], ['touring', before(end, span[2])],
    ['offer_submitted', before(end, span[3])], ['under_contract', before(end, span[4])], [last, end],
  ];
  const listPath = (end, last = 'closed', span = [125, 112, 96, 42, 36]) => [
    ['seller_lead', before(end, span[0])], ['listing_appt', before(end, span[1])], ['active', before(end, span[2])],
    ['offer_received', before(end, span[3])], ['under_contract', before(end, span[4])], [last, end],
  ];

  const deals = [
    // ── Under contract
    {
      key: 'delacroix', client: 'julien', title: 'Delacroix · 41 Isola Verde Dr', side: 'buyer', listing: 'mls_isola',
      price: 14900000, listPrice: 15500000, contractPrice: 14900000, sideRate: 0.025, probability: 0.9,
      contractDate: d(-21), closingDate: ctx.at(o.dxClose, 11), inspectionDeadline: d(-6, 17), appraisalDeadline: ctx.at(o.dxAppraisal, 17), financingDeadline: ctx.at(o.dxFinancing, 17),
      contingencies: { inspection: 'cleared', appraisal: 'open', financing: 'open', clear_to_close: 'open' },
      lenderName: 'Meridian Coast Private Bank', titleCompany: 'Bayline Title & Escrow', leadSource: 'Referral',
      extras: { listAgent: 'Nicole Strand · Atlantica Estates', earnestMoney: 1490000, inspectionCredit: 35000, dockLengthFt: 92, appraisalVisit: 'Completed — report due', boat: 'Belle Rive (82 ft)' },
      notes: 'Inspection credit of $35K for seawall cap repair. Appraisal visit done; lender needs the report before final approval.',
      path: [['new_lead', d(-74)], ['consultation', d(-70)], ['touring', d(-61)], ['offer_submitted', d(-25, 19)], ['under_contract', d(-21, 15)]],
    },
    {
      key: 'okafor', client: 'daniel', title: 'Okafor · One Harbor Point PH 4501', side: 'buyer', listing: 'mls_harborpoint',
      price: 8950000, listPrice: 9250000, contractPrice: 8950000, sideRate: 0.025, splitShare: 0.5, probability: 0.95,
      coAgentName: 'Jordan Pierce', coAgentBrokerage: 'Harbor & Key Realty',
      contractDate: d(-33), closingDate: ctx.at(o.okClose, 10), inspectionDeadline: d(-23, 17), appraisalDeadline: d(-16, 17), financingDeadline: d(-5, 17),
      contingencies: { inspection: 'cleared', appraisal: 'cleared', financing: 'cleared', clear_to_close: 'open' },
      lenderName: 'Meridian Coast Private Bank', titleCompany: 'Bayline Title & Escrow', leadSource: 'Referral',
      extras: { finalWalkthrough: 'Scheduled', wireVerified: true, closingLocation: 'Bayline Title & Escrow, 1450 Brickell Bay Drive, Suite 1200' },
      path: [['new_lead', d(-58)], ['consultation', d(-55)], ['touring', d(-50)], ['offer_submitted', d(-36)], ['under_contract', d(-33)]],
    },
    {
      key: 'cole', client: 'ethan', title: 'Cole · 8120 Banyan Ridge Ln', side: 'buyer', listing: 'mls_banyan',
      price: 6850000, listPrice: 6995000, contractPrice: 6850000, sideRate: 0.025, probability: 0.75,
      contractDate: d(-3, 16), closingDate: ctx.at(o.coleClose, 11), inspectionDeadline: ctx.at(o.coleInspEnd, 17), appraisalDeadline: ctx.at(ctx.bizOff(12), 17), financingDeadline: ctx.at(ctx.bizOff(21), 17),
      contingencies: { inspection: 'open', appraisal: 'open', financing: 'open', clear_to_close: 'open' },
      lenderName: 'Coastal Federal Jumbo Lending', titleCompany: 'Bayline Title & Escrow', leadSource: 'Zillow',
      extras: { listAgent: 'Ricardo Salinas · Palmetto & Pine Realty', inspector: 'Hank Morrow', concerns: ['Roof flashing', 'Pool fence for Wren'] },
      path: [['new_lead', d(-46)], ['consultation', d(-44)], ['touring', d(-31)], ['offer_submitted', d(-6, 18)], ['under_contract', d(-3, 16)]],
    },
    {
      key: 'alvarez', client: 'beatriz', title: 'Alvarez · 3417 Mangrove Point Rd', side: 'listing', listing: 'own_mangrove', property: 'pp_alvarez_grove',
      price: 7400000, listPrice: 7650000, contractPrice: 7400000, sideRate: 0.03, listRate: 0.03, probability: 0.85,
      contractDate: d(-12), closingDate: ctx.at(o.alvClose, 14), inspectionDeadline: d(-2, 17), appraisalDeadline: d(-1, 17), financingDeadline: ctx.at(ctx.bizOff(5), 17),
      contingencies: { inspection: 'cleared', appraisal: 'cleared', financing: 'open', clear_to_close: 'open' },
      titleCompany: 'Bayline Title & Escrow', leadSource: 'Referral',
      extras: { buyerAgent: 'Celia Montrose · Montrose & Wilde', buyerLender: 'Coastal Federal Jumbo Lending' },
      path: [['seller_lead', d(-96)], ['listing_appt', d(-88)], ['active', d(-41)], ['offer_received', d(-14)], ['under_contract', d(-12)]],
    },
    {
      key: 'moreau', client: 'lucas', title: 'Moreau · The Aria 1102', side: 'buyer', listing: 'mls_aria1102',
      price: 5200000, listPrice: 5450000, contractPrice: 5200000, sideRate: 0.025, probability: 0.85,
      contractDate: d(-18), closingDate: ctx.at(o.moClose, 10), inspectionDeadline: d(-8, 17),
      contingencies: { inspection: 'cleared', appraisal: 'cleared', financing: 'cleared', clear_to_close: 'open' },
      titleCompany: 'Bayline Title & Escrow', leadSource: 'Website',
      extras: { cash: true, condoApproval: 'Board interview by video — date pending', listAgent: 'Lucia Ferrante · Vista Mar Realty Group' },
      path: [['new_lead', d(-47)], ['consultation', d(-45)], ['touring', d(-40)], ['offer_submitted', d(-20)], ['under_contract', d(-18)]],
    },

    // ── Open pipeline
    {
      key: 'ashcombe', client: 'victoria', title: 'Ashcombe · Golden Beach / Indian Creek oceanfront', side: 'buyer', propertyLabel: 'Oceanfront estate · Golden Beach or Indian Creek',
      price: 38000000, sideRate: 0.025, probability: 0.45, leadSource: 'Referral', listing: null,
      shortlist: [
        { listingKey: 'mls_gb455', label: '455 Seagrape Shore Dr · reduced to $29.5M', price: 29500000 },
        { listingKey: 'wh_goldenbeach', label: 'Golden Beach whisper · owner-quiet', price: 34000000 },
        { listingKey: 'wh_indiancreek', label: 'Indian Creek compound · spring', price: 58000000 },
      ],
      path: [['new_lead', d(-41)], ['consultation', d(-38)], ['touring', d(-24)]],
    },
    { key: 'raman', client: 'priya', title: 'Raman · Coconut Grove / Gables family home', side: 'buyer', propertyLabel: 'Grove or Gables · top schools', price: 6500000, sideRate: 0.025, probability: 0.3, leadSource: 'Referral', path: [['new_lead', d(-19)], ['consultation', d(-8)]] },
    {
      key: 'karimova', client: 'nadia', title: 'Karimova · Fisher Island', side: 'buyer', propertyLabel: 'Fisher Island winter residence', price: 12000000, sideRate: 0.025, probability: 0.5, leadSource: 'Concierge',
      shortlist: [{ listingKey: 'mls_palmyra', label: 'The Palmyra 5122', price: 11750000 }, { listingKey: 'wh_fisher', label: 'Fisher Island villa · estate sale', price: 14000000 }],
      path: [['new_lead', d(-27)], ['consultation', d(-20)], ['touring', d(-6)]],
    },
    { key: 'ferraro', client: 'isabella', title: 'Ferraro · first purchase', side: 'buyer', propertyLabel: 'Edgewater / Design District condo', price: 2800000, sideRate: 0.025, probability: 0.35, leadSource: 'Instagram', path: [['new_lead', d(-16)]] },
    {
      key: 'rossi', client: 'bianca', title: 'Rossi · The Mariner Surfside PH 2', side: 'buyer', listing: 'mls_mariner', price: 6850000, listPrice: 7100000, sideRate: 0.025, probability: 0.55, leadSource: 'Instagram',
      extras: { offerAmount: 6850000, offerTerms: 'Cash · 10-day inspection · 30-day close', responseDue: 'Tonight 9pm', listAgent: 'Marcel Dupré · Lumière International Realty' },
      path: [['new_lead', d(-44)], ['consultation', d(-40)], ['touring', d(-29)], ['offer_submitted', d(-1, 17)]],
    },
    {
      key: 'whitaker', client: 'graham', title: 'Whitaker · 128 Sunset Drive', side: 'listing', listing: 'own_sunset', property: 'pp_whitaker_sunset',
      price: 18750000, listPrice: 18750000, sideRate: 0.03, listRate: 0.03, probability: 0.6, leadSource: 'Referral',
      extras: { offers: [{ from: 'Reid Castellano · Bayshore Collective Realty', buyer: 'Relocating from Greenwich, CT', amount: 17200000, terms: 'Cash · 14-day inspection · 45-day close', receivedAt: lastNight.toISOString() }], showings: 14, secondShowings: 3 },
      path: [['seller_lead', d(-63)], ['listing_appt', d(-47)], ['active', d(-9)], ['offer_received', lastNight]],
    },
    { key: 'laurent', client: 'simone', title: 'Laurent · 2741 Fairway Isle Dr', side: 'listing', listing: 'own_lagorce', property: 'pp_laurent_lagorce', price: 12900000, listPrice: 12900000, sideRate: 0.03, listRate: 0.03, probability: 0.5, leadSource: 'Sphere', extras: { originalListPrice: 13900000, priceReducedOn: d(-4).toISOString() }, path: [['seller_lead', d(-70)], ['listing_appt', d(-52)], ['active', d(-34)]] },
    { key: 'fontaine', client: 'lydia', title: 'Fontaine · The Aria 1402', side: 'listing', listing: 'own_aria1402', price: 6450000, listPrice: 6450000, sideRate: 0.03, listRate: 0.03, probability: 0.45, leadSource: 'Website', path: [['seller_lead', d(-88)], ['listing_appt', d(-76)], ['active', d(-63)]] },
    {
      key: 'lowell', client: 'charles', title: 'Lowell · 11 Coral Isle Way', side: 'listing', property: 'pp_lowell_estate', propertyAddress: '11 Coral Isle Way, Coral Gables, FL 33156', propertyLabel: 'Gables Estates bayfront estate',
      price: 21500000, sideRate: 0.03, listRate: 0.03, probability: 0.5, leadSource: 'Referral',
      extras: { competing: ['Atlantica Estates', 'Gilded Key Real Estate'], suggestedListRange: [21000000, 22500000], presentation: 'Today 4:00 PM at the house' },
      path: [['seller_lead', d(-22)], ['listing_appt', d(-5)]],
    },
    { key: 'brennan', client: 'harold', title: 'Brennan · 260 Harbor Palm Ln', side: 'listing', property: 'pp_brennan_kb', propertyAddress: '260 Harbor Palm Lane, Key Biscayne, FL 33149', price: 7800000, sideRate: 0.03, listRate: 0.03, probability: 0.25, leadSource: 'Past client', extras: { trigger: 'ARM reset + one-level living' }, path: [['seller_lead', d(-14)]] },
    {
      key: 'montoya', client: 'rafael', title: 'Montoya · Casa Palmera PH-B', side: 'buyer', track: 'new_dev', inventoryType: 'pre_construction', propertyLabel: 'Casa Palmera Residences · Penthouse B',
      price: 9850000, sideRate: 0.03, probability: 0.8, leadSource: 'Developer', finishSelectionDue: ctx.at(150, 12), estCompletion: ctx.at(820, 12),
      depositSchedule: [
        { label: 'Reservation deposit', pct: 0.1, amount: 985000, dueAt: d(-13).toISOString(), paidAt: d(-12).toISOString() },
        { label: 'Second deposit (contract)', pct: 0.1, amount: 985000, dueAt: ctx.at(o.rafaelDeposit, 17).toISOString(), paidAt: null },
        { label: 'Groundbreaking', pct: 0.1, amount: 985000, dueAt: ctx.at(180, 12).toISOString(), paidAt: null },
        { label: 'Top-off', pct: 0.1, amount: 985000, dueAt: ctx.at(540, 12).toISOString(), paidAt: null },
        { label: 'Balance at closing', pct: 0.6, amount: 5910000, dueAt: ctx.at(820, 12).toISOString(), paidAt: null },
      ],
      path: [['unit_selection', d(-40)], ['pricing_received', d(-31)], ['priority_list', d(-24)], ['reserved', d(-13)]],
    },
    { key: 'sinclair', client: 'ava', title: 'Sinclair · Casa Palmera Phase II', side: 'buyer', track: 'new_dev', inventoryType: 'pre_construction', listing: 'wh_cpphase2', propertyLabel: 'Casa Palmera Phase II · penthouse or 26+ floor', price: 11500000, sideRate: 0.03, probability: 0.4, leadSource: 'Developer', path: [['unit_selection', d(-61)], ['pricing_received', d(-40)], ['priority_list', d(-18)]] },
    { key: 'park', client: 'chloe', title: 'Park · Coconut Grove lease', side: 'lease_tenant', propertyLabel: 'Coconut Grove rental · 3BR townhouse, $11–13K', price: 150000, monthlyRent: 12500, commissionFlat: 6250, probability: 0.6, leadSource: 'Website', path: [['new_lead', d(-29)], ['touring', d(-4)]] },
    { key: 'fitzgerald', client: 'owen', title: 'Fitzgerald · Aspen referral', side: 'referral_out', propertyLabel: 'Aspen · West End chalet search', price: 9200000, sideRate: 0.025, referralOutPct: 0.25, coAgentName: 'Brooke Halvorsen', coAgentBrokerage: 'Summit Peak Realty', probability: 0.5, leadSource: 'Sphere', path: [['new_lead', d(-35)], ['touring', d(-13)]] },

    // ── Lost
    { key: 'brooks', client: 'natalie', title: 'Brooks · Miami Beach condo', side: 'buyer', propertyLabel: 'Miami Beach 3BR condo', price: 3600000, sideRate: 0.025, leadSource: 'Website', lostReason: 'Went with another agent', lostNote: 'Her college roommate got licensed in the spring. No hard feelings — keep her on the market update list.', path: [['new_lead', d(-160)], ['consultation', d(-151)], ['touring', d(-122)], ['lost', d(-45)]] },
    { key: 'wells', client: 'carter', title: 'Wells · Aqua Lumen 1806', side: 'buyer', propertyAddress: 'Aqua Lumen Edgewater, Residence 1806', price: 2950000, contractPrice: 2950000, sideRate: 0.025, leadSource: 'Instagram', lostReason: 'Financing fell through', lostNote: 'Appraisal came in $310K short and the jumbo lender would not bridge it; he would not bring more cash.', path: [['new_lead', d(-200)], ['consultation', d(-191)], ['touring', d(-150)], ['offer_submitted', d(-95)], ['under_contract', d(-90)], ['lost', d(-60)]] },
    { key: 'price', client: 'imogen', title: 'Price · 4 Sabal Cay', side: 'listing', listing: 'own_sabal', price: 5950000, listPrice: 5950000, sideRate: 0.03, listRate: 0.03, leadSource: 'Sign call', lostReason: 'Seller withdrew — leasing instead', lostNote: 'Two offers at $5.1M. She leased it for a year at $28K/month. Check back next summer.', path: [['seller_lead', d(-180)], ['listing_appt', d(-152)], ['active', d(-140)], ['lost', d(-38)]] },
  ];

  // ── Closed history
  const [m1, m2, m3, m4] = ctx.mtdSlots(4);
  const ytd = ctx.ytdSlots(8);
  const ly1 = ctx.yearsBack(5, 1); const ly2 = ctx.yearsBack(11, 1);
  o.celesteAnniv = ly1.off; o.joelAnniv = ly2.off;
  const harold = ctx.yearsBack(74, 5); const wes = ctx.yearsBack(8, 4); const sterling = ctx.yearsBack(2, 3);
  o.haroldReset = harold.off; o.wesAnniv = wes.off; o.sterlingAnniv = sterling.off;

  const closed = [
    { key: 'kessler', client: 'adrian', title: 'Kessler · Solace Surfside 803', side: 'listing', listing: 'own_solace', property: 'pp_kessler_solace', salePrice: 3950000, listPrice: 4150000, sideRate: 0.03, at: m1, leadSource: 'Website', buyerAgent: 'Grant Okimoto · Okimoto Waterfront Group' },
    { key: 'duarte', client: 'sebastian', title: 'Duarte · 1215 Alhambra Vista Ct', side: 'buyer', property: 'pp_duarte_gables', propertyAddress: '1215 Alhambra Vista Court, Coral Gables, FL 33134', salePrice: 4850000, listPrice: 4995000, sideRate: 0.025, at: m2, leadSource: 'Instagram', lenderName: 'Meridian Coast Private Bank' },
    { key: 'vance', client: 'meredith', title: 'Vance · The Aria 0905', side: 'buyer', property: 'pp_vance_aria', propertyAddress: 'The Aria at Bal Harbour, Residence 0905', salePrice: 6200000, listPrice: 6495000, sideRate: 0.025, at: m3, leadSource: 'Website' },
    { key: 'feld', client: 'jonah', title: 'Feld · 6940 Old Cutler Bend', side: 'listing', listing: 'own_oldcutler', property: 'pp_feld_pinecrest', salePrice: 5600000, listPrice: 5850000, sideRate: 0.03, at: m4, leadSource: 'Referral' },
    { key: 'larsen', client: 'henrik', title: 'Larsen · 18 Mashta Cove Ln', side: 'buyer', property: 'pp_larsen_kb', propertyAddress: '18 Mashta Cove Lane, Key Biscayne, FL 33149', salePrice: 3400000, listPrice: 3595000, sideRate: 0.025, at: ytd[0], leadSource: 'Sphere' },
    { key: 'marlow', client: 'olivia', title: 'Marlow · Aurelia Brickell PH5', side: 'listing', listing: 'own_aurelia', property: 'pp_marlow_aurelia', salePrice: 4100000, listPrice: 4350000, sideRate: 0.03, at: ytd[1], leadSource: 'Website' },
    { key: 'grant', client: 'theo', title: 'Grant · 3611 Avocado Grove Ln', side: 'buyer', property: 'pp_grant_grove', propertyAddress: '3611 Avocado Grove Lane, Miami, FL 33133', salePrice: 3200000, listPrice: 3350000, sideRate: 0.025, at: ytd[2], leadSource: 'Referral' },
    { key: 'reyes', client: 'amara', title: 'Reyes · Bayside Lofts 1204 (dual)', side: 'dual', property: 'pp_reyes_edgewater', propertyAddress: 'Bayside Lofts Edgewater, Residence 1204', salePrice: 2900000, listPrice: 2995000, sideRate: 0.05, listRate: 0.03, buyRate: 0.02, at: ytd[3], leadSource: 'Open house', extras: { sellerName: 'Estate of R. Delmonte', dual: true } },
    { key: 'thornton', client: 'william', title: 'Thornton · 3 Heron Point Rd', side: 'listing', property: 'pp_thornton_ge', propertyAddress: '3 Heron Point Road, Gables Estates', salePrice: 11800000, listPrice: 12500000, sideRate: 0.03, at: ytd[4], leadSource: 'Sphere' },
    { key: 'hale', client: 'preston', title: 'Hale · 118 El Mirasol Way', side: 'listing', property: 'pp_hale_pb', propertyAddress: '118 El Mirasol Way, Palm Beach, FL 33480', salePrice: 8400000, listPrice: 8950000, sideRate: 0.03, at: ytd[5], leadSource: 'Website' },
    { key: 'whitmore', client: 'grace', title: 'Whitmore · 612 Royal Plaza Isle', side: 'buyer', property: 'pp_whitmore_lasolas', propertyAddress: '612 Royal Plaza Isle, Fort Lauderdale, FL 33301', salePrice: 4400000, listPrice: 4650000, sideRate: 0.025, at: ytd[6], leadSource: 'Instagram' },
    { key: 'watanabe', client: 'kenji', title: 'Watanabe · Vela Brickell 3306', side: 'buyer', property: 'pp_watanabe_vela', propertyAddress: 'Vela Brickell, Residence 3306', salePrice: 2600000, listPrice: 2695000, sideRate: 0.025, at: ytd[7], leadSource: 'Referral' },
    { key: 'moreno', client: 'celeste', title: 'Moreno · 2240 Royal Palm Way', side: 'buyer', property: 'pp_moreno_boca', propertyAddress: '2240 Royal Palm Way, Boca Raton, FL 33432', salePrice: 3650000, listPrice: 3800000, sideRate: 0.025, at: ly1.date, leadSource: 'Zillow' },
    { key: 'stein', client: 'joel', title: 'Stein · 7311 Kendall Oaks Dr', side: 'buyer', property: 'pp_stein_pinecrest', propertyAddress: '7311 Kendall Oaks Drive, Pinecrest, FL 33156', salePrice: 4150000, listPrice: 4295000, sideRate: 0.025, at: ly2.date, leadSource: 'Website' },
    { key: 'volkov', client: 'dmitri', title: 'Volkov · Oceanique 2108', side: 'buyer', property: 'pp_volkov_sunny', propertyAddress: 'Oceanique Sunny Isles, Residence 2108', salePrice: 2350000, listPrice: 2450000, sideRate: 0.025, at: ctx.lastYearAt(0.21), leadSource: 'Zillow' },
    { key: 'ashby', client: 'frederick', title: 'Ashby · 925 Sevilla Arch Ave', side: 'listing', property: 'pp_ashby_gables', propertyAddress: '925 Sevilla Arch Avenue, Coral Gables, FL 33134', salePrice: 3900000, listPrice: 4100000, sideRate: 0.03, at: ctx.lastYearAt(0.46), leadSource: 'Sign call' },
    { key: 'brennan2021', client: 'harold', title: 'Brennan · 260 Harbor Palm Ln (purchase)', side: 'buyer', property: 'pp_brennan_kb', propertyAddress: '260 Harbor Palm Lane, Key Biscayne, FL 33149', salePrice: 4200000, listPrice: 4400000, sideRate: 0.025, at: harold.date, leadSource: 'Open house', lenderName: 'Meridian Coast Private Bank' },
    { key: 'monroe2022', client: 'wes', title: 'Monroe · 2985 Coral Shade Ln', side: 'buyer', property: 'pp_monroe_grove', propertyAddress: '2985 Coral Shade Lane, Miami, FL 33133', salePrice: 2750000, listPrice: 2850000, sideRate: 0.025, at: wes.date, leadSource: 'Open house' },
    { key: 'hayes2023', client: 'sterling', title: 'Hayes · The Palmyra 4421', side: 'buyer', property: 'pp_hayes_fisher', propertyAddress: 'The Palmyra at Fisher Island, Residence 4421', salePrice: 9800000, listPrice: 10400000, sideRate: 0.025, at: sterling.date, leadSource: 'Sphere' },
  ];

  for (const c of closed) {
    const path = c.side === 'listing' ? listPath(c.at) : buyerPath(c.at);
    deals.push({
      key: c.key, client: c.client, title: c.title, side: c.side, listing: c.listing || null, property: c.property, propertyAddress: c.propertyAddress,
      price: c.salePrice, listPrice: c.listPrice, contractPrice: c.salePrice, salePrice: c.salePrice, sideRate: c.sideRate,
      listRate: c.listRate ?? (c.side === 'listing' ? c.sideRate : null), buyRate: c.buyRate ?? (c.side === 'buyer' ? c.sideRate : null),
      contractDate: before(c.at, 35), closingDate: c.at, closedAt: c.at, closeProcessedAt: new Date(c.at.getTime() + 3 * 3600e3),
      contingencies: { inspection: 'cleared', appraisal: 'cleared', financing: 'cleared', clear_to_close: 'cleared' },
      titleCompany: 'Bayline Title & Escrow', lenderName: c.lenderName || null, leadSource: c.leadSource, probability: 1,
      extras: { ...(c.extras || {}), ...(c.buyerAgent ? { buyerAgent: c.buyerAgent } : {}) },
      path, closed: true,
    });
  }
  return deals;
};
