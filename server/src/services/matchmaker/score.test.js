// node --test src/services/matchmaker/score.test.js
// Vectors that pin the matchmaker's behavior (spec 06 §8.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreListingForSearch, rankScored, MATCH_CONFIG } = require('./score');
const V = require('./vocab');

const balHarbourCondo = {
  id: 'l1', origin: 'feed', status: 'active', market: 'Miami', city: 'Bal Harbour', neighborhood: 'Bal Harbour',
  buildingName: 'Oceana Bal Harbour', propertyType: 'condo', listPrice: 9_500_000, beds: 4, bathsTotal: 5.5,
  livingAreaSqft: 4_800, yearBuilt: 2016, architecturalStyle: 'Contemporary', waterfront: 'oceanfront',
  views: ['ocean', 'bay'], amenities: ['Private elevator', 'Concierge', 'Pool', 'Gym', 'Spa'],
};
const search = {
  id: 's1', bucket: 'active', markets: ['Miami'], neighborhoods: ['Bal Harbour', 'Surfside'], propertyTypes: ['condo'],
  priceMin: 7_000_000, priceMax: 11_000_000, bedsMin: 4, bathsMin: 4, sqftMin: 4000, styles: ['Modern'],
  waterfront: ['oceanfront'], views: ['ocean'], mustHaves: [{ feature: 'private elevator', importance: 1 }],
};

test('perfect fit on an authoritative listing reaches 100 only when everything is verified', () => {
  const r = scoreListingForSearch(balHarbourCondo, search);
  assert.equal(r.gated, null);
  assert.ok(r.factors.every((f) => f.quality >= 0.999), JSON.stringify(r.factors.filter((f) => f.quality < 0.999)));
  assert.equal(r.mustHaves[0].status, 'met');
  assert.equal(r.score, 100);
  assert.equal(r.allConfirmed, true);
});

test('unverified must-have caps at 99 and sets verifyHold', () => {
  const whisper = { ...balHarbourCondo, origin: 'whisper', status: 'coming_soon' };
  const r = scoreListingForSearch(whisper, search);
  assert.equal(r.mustHaves[0].status, 'verify');
  assert.ok(r.score <= 99);
  assert.equal(r.verifyHold, true);
  assert.equal(r.confidence, 'needs verification');
});

test('a confirmed-missing must-have costs 24 points', () => {
  const noElevator = { ...balHarbourCondo, amenities: ['Concierge', 'Pool'] };
  const r = scoreListingForSearch(noElevator, search);
  assert.equal(r.mustHaves[0].status, 'missing');
  assert.ok(r.score <= 100 - 24 + 1, `score ${r.score}`);
});

test('amenity synonyms resolve to one canonical key', () => {
  assert.equal(V.normalizeAmenity('Deep-water dockage'), 'dock');
  assert.equal(V.normalizeAmenity('Boat lift'), 'boat_lift');
  assert.equal(V.normalizeAmenity('Guard-gated community'), 'gated');
  assert.equal(V.normalizeAmenity('Wine cellar'), 'wine_room');
  assert.equal(V.normalizeAmenity('Whole-house generator'), 'generator');
  assert.ok(V.amenityKeys(['Saltwater pool', 'Crestron automation']).has('smart_home'));
});

test('numeric must-haves evaluate against columns', () => {
  const p = V.parseMustHave('dock for a 70-ft boat');
  assert.deepEqual([p.key, p.min], ['dock_length', 70]);
  assert.deepEqual([V.parseMustHave('at least 1 acre').key, V.parseMustHave('at least 1 acre').min], ['lot', 43560]);
  assert.equal(V.parseMustHave('no HOA').max, 0);
  assert.equal(V.parseMustHave('4-car garage').min, 4);
  const estate = { origin: 'feed', status: 'active', market: 'Miami', neighborhood: 'Coral Gables', propertyType: 'single_family', listPrice: 12e6, dockLengthFt: 60, waterfront: 'bayfront', lotSqft: 50000, beds: 6 };
  const s = { markets: ['Miami'], mustHaves: [{ feature: 'dock for a 70-ft boat' }, { feature: 'at least 1 acre' }] };
  const r = scoreListingForSearch(estate, s);
  assert.equal(r.mustHaves.find((m) => m.key === 'dock_length').status, 'missing');
  assert.equal(r.mustHaves.find((m) => m.key === 'lot').status, 'met');
});

test('neighborhood name similarity: exact, abbreviations, containment, generic words', () => {
  assert.equal(V.nameSim('Bal Harbor', ['Bal Harbour']), 1);
  assert.equal(V.nameSim('Fisher Isl', ['Fisher Island']), 1);
  assert.ok(V.nameSim('Oceana Bal Harbour', ['Bal Harbour']) >= 0.9);
  assert.ok(V.nameSim('Star Island', ['Fisher Island']) < 0.5, 'shared generic word is not a match');
  assert.ok(V.nameSim('Miami Beach', ['Beach']) < 0.9, 'single generic token never counts as containment');
  assert.equal(V.nameSim('The Residences at Gables Estates', ['Gables Estates']), 1);
});

test('proportional price soft window', () => {
  const s = { priceMax: 10_000_000 };
  const at = (p, ctx) => scoreListingForSearch({ status: 'active', listPrice: p }, s, ctx).factors.find((f) => f.key === 'priceRange').quality;
  assert.equal(at(9_900_000), 1);
  // 15% of $10M = $1.5M soft window: $10.75M is half way out → 0.5
  assert.equal(at(10_750_000), 0.5);
  assert.equal(at(12_000_000, { hardPrice: false }), 0);
});

test('price beyond the soft window is gated (both directions), guides get a wider window', () => {
  const strong = { markets: ['Miami Beach'], neighborhoods: ['Sunset Islands'], propertyTypes: ['single_family'], bedsMin: 4 };
  const home = { status: 'active', origin: 'feed', market: 'Miami Beach', neighborhood: 'Sunset Islands', propertyType: 'single_family', beds: 6 };
  // $4.5M buyer vs an $18.75M estate on their favorite island: location can't buy it
  const over = scoreListingForSearch({ ...home, listPrice: 18_750_000 }, { ...strong, priceMin: 3e6, priceMax: 4.5e6 });
  assert.equal(over.gated, 'price');
  assert.equal(over.score, 0);
  // a $12–20M buyer is not shopping a $3M condo-priced home
  const under = scoreListingForSearch({ ...home, listPrice: 3e6 }, { ...strong, priceMin: 12e6, priceMax: 20e6 });
  assert.equal(under.gated, 'price');
  // inside the window it is a scored stretch, not a gate
  const stretch = scoreListingForSearch({ ...home, listPrice: 5e6 }, { ...strong, priceMax: 4.5e6 });
  assert.equal(stretch.gated, null);
  assert.ok(stretch.score >= 80 && stretch.score < 100);
  // whisper guide ~$5.5M vs ≤$4.5M: 1.5× window (≈$1.01M) keeps it in play
  const guide = scoreListingForSearch({ ...home, origin: 'whisper', status: 'off_market', priceGuide: 5.5e6 }, { ...strong, priceMax: 4.5e6 });
  assert.equal(guide.gated, null);
  assert.equal(scoreListingForSearch({ ...home, listPrice: 18_750_000 }, { ...strong, priceMax: 4.5e6 }, { hardPrice: false }).gated, null);
});

test('factors the buyer never expressed are excluded from the denominator', () => {
  const r = scoreListingForSearch(balHarbourCondo, { markets: ['Miami'], priceMax: 11e6 });
  assert.deepEqual(r.factors.map((f) => f.key).sort(), ['market', 'priceRange']);
  assert.equal(r.score, 100);
});

test('condo-vs-house hard gate (configurable)', () => {
  const s = { markets: ['Miami'], propertyTypes: ['single_family'], priceMax: 11e6 };
  const r = scoreListingForSearch(balHarbourCondo, s);
  assert.equal(r.gated, 'type');
  assert.equal(r.score, 0);
  const soft = scoreListingForSearch(balHarbourCondo, s, { hardTypes: false });
  assert.equal(soft.gated, null);
  assert.equal(soft.factors.find((f) => f.key === 'propertyType').quality, 0);
});

test('market hard gate: a different metro never matches; a near-miss market only scores 0', () => {
  const aspen = { markets: ['Aspen'], propertyTypes: ['single_family'], priceMax: 25e6, bedsMin: 5 };
  const r = scoreListingForSearch({ status: 'active', market: 'Miami', city: 'Miami Beach', neighborhood: 'Sunset Islands', propertyType: 'single_family', listPrice: 13e6, beds: 6 }, aspen);
  assert.equal(r.gated, 'market');
  const near = scoreListingForSearch({ status: 'active', market: 'Miami', city: 'Miami', neighborhood: 'Brickell' }, { markets: ['Miami Beach'] });
  assert.equal(near.gated, null);
  assert.equal(near.factors.find((f) => f.key === 'market').quality, 0);
  const noMarket = scoreListingForSearch({ status: 'active', neighborhood: 'Sunset Islands' }, { markets: ['Miami Beach'], priceMax: 1e7 });
  assert.equal(noMarket.gated, null, 'unknown market is never gated');
});

test('status gates: sold never matches, pending only with includePending', () => {
  assert.equal(scoreListingForSearch({ ...balHarbourCondo, status: 'sold' }, search).score, 0);
  assert.equal(scoreListingForSearch({ ...balHarbourCondo, status: 'pending' }, search).gated, 'status:pending');
  assert.ok(scoreListingForSearch({ ...balHarbourCondo, status: 'pending' }, search, { includePending: true }).score > 80);
});

test('style family credit 0.6, miss 0.22', () => {
  const q = (style) => scoreListingForSearch({ status: 'active', architecturalStyle: style }, { styles: ['Contemporary'] }).factors[0].quality;
  assert.equal(q('Contemporary'), 1);
  assert.equal(q('Mid-Century Modern'), MATCH_CONFIG.styleFamilyCredit);
  assert.equal(q('Mediterranean Revival'), MATCH_CONFIG.styleMissCredit);
});

test('deal-breakers are negated must-haves', () => {
  const r = scoreListingForSearch({ ...balHarbourCondo, hoaFee: 6200 }, { ...search, dealBreakers: ['HOA'] });
  const db = r.mustHaves.find((m) => m.dealBreaker);
  assert.ok(db, 'deal-breaker recorded');
  assert.equal(db.status, 'missing');
  assert.ok(r.score < 80);
});

test('summary names the strongest and softest factors', () => {
  const r = scoreListingForSearch({ ...balHarbourCondo, views: ['city'] }, search);
  assert.match(r.summary, /^Strong on location/);
  assert.match(r.summary, /soft on view/);
});

test('price drop crossing into budget is flagged', () => {
  const dropped = { ...balHarbourCondo, listPrice: 10_900_000, previousPrice: 11_900_000 };
  const r = scoreListingForSearch(dropped, search);
  assert.equal(r.crossedBudget, true);
  assert.match(r.summary, /budget/);
});

test('rankScored falls back to 70 only when asked and nobody clears 80', () => {
  const mk = (score) => ({ result: { score } });
  const a = rankScored([mk(75), mk(72), mk(40)], { fallback: true });
  assert.equal(a.threshold, 70);
  assert.equal(a.shown.length, 2);
  const b = rankScored([mk(75), mk(72)], {});
  assert.equal(b.shown.length, 0);
});

test('structured must-haves: {feature:"dock", min:90} is a dock-length threshold with a readable label', () => {
  const p = V.parseMustHave({ feature: 'dock', importance: 1, source: 'call', min: 90 });
  assert.deepEqual([p.key, p.min], ['dock_length', 90]);
  assert.equal(V.mustHaveLabel(p), '90+ ft dock');
  assert.equal(V.mustHaveLabel(V.parseMustHave({ feature: 'high_floor', min: 26 })), 'Floor 26+');
  assert.equal(V.mustHaveLabel(V.parseMustHave({ feature: 'guard_gated' })), 'Gated');
  assert.equal(V.parseMustHave({ feature: 'pool_fence' }).key, null, '"pool fence" is not "pool"');
});

test('compound free-text must-haves split; Fair Housing proxies are never scored', () => {
  const l = { status: 'active', origin: 'feed', amenities: ['gated', 'staff_quarters', 'pool'] };
  const r = scoreListingForSearch(l, { mustHaves: ['Gated + staff quarters', 'Top school zone'] });
  assert.deepEqual(r.mustHaves.map((m) => [m.key, m.status]), [['gated', 'met'], ['staff_quarters', 'met']]);
});

test('un-canonical must-haves never count as missing, even on authoritative listings', () => {
  const l = { status: 'active', origin: 'own', isOwnListing: true, hasFeatureSheet: true, amenities: ['pool'] };
  const r = scoreListingForSearch(l, { mustHaves: [{ feature: 'no_fixed_bridges', importance: 1 }, { feature: 'home_office', importance: 0.7 }] });
  assert.equal(r.mustHaves[0].status, 'verify');
  assert.equal(r.mustHaves[1].status, 'missing', 'feature sheet makes office absence provable');
  const mls = scoreListingForSearch({ ...l, origin: 'feed', isOwnListing: false, hasFeatureSheet: false }, { mustHaves: [{ feature: 'home_office' }, { feature: 'pool' }, { feature: 'dock' }] });
  assert.deepEqual(mls.mustHaves.map((m) => m.status), ['verify', 'met', 'missing']);
});

test('numeric deal-breaker "Dock under 85 ft" fires only on a known short dock', () => {
  const s = { dealBreakers: ['Dock under 85 ft', 'Shared driveway'] };
  assert.ok(scoreListingForSearch({ status: 'active', dockLengthFt: 60, amenities: ['dock'] }, s).mustHaves.some((m) => m.dealBreaker));
  assert.ok(!scoreListingForSearch({ status: 'active', dockLengthFt: 95, amenities: ['dock'] }, s).mustHaves.some((m) => m.dealBreaker));
  assert.ok(!scoreListingForSearch({ status: 'active', amenities: ['dock'] }, s).mustHaves.some((m) => m.dealBreaker));
});
