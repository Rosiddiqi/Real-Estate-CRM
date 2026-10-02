// Campaign templates → a ready draft: the brief (filled from the attached
// listing), sensible reply lanes (parsed into timed steps), and a starting
// audience. Everything stays editable in the builder.
const { TEMPLATES } = require('./constants');
const { parseSequence } = require('./sequence');
const { listingFacts } = require('./drafter');

function fillBrief(key, listing) {
  const t = TEMPLATES[key];
  if (!t || !t.brief) return '';
  const L = listingFacts(listing);
  const v = {
    address: L ? (L.offMarket ? `a home${L.neighborhood ? ` in ${L.neighborhood}` : ''}` : L.address) : 'my new listing',
    area: L && L.neighborhood && !(L.offMarket && key !== 'coming_soon') && L.address.indexOf(L.neighborhood) === -1 ? ` in ${L.neighborhood}` : '',
    specsParen: L && L.specs ? ` (${L.specs})` : '',
    atPrice: L && L.price ? ` at ${L.price}` : '',
    forPrice: L && (L.closePrice || L.price) ? ` for ${L.closePrice || L.price}` : '',
    toPrice: L && L.price ? ` to ${L.price}` : '',
  };
  if (key === 'coming_soon') v.area = L && L.neighborhood ? ` in ${L.neighborhood}` : '';
  return t.brief.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : v[k])).replace(/\s+/g, ' ').trim();
}

function lane(text, laneKey, hasEvent) {
  if (!text) return { enabled: true, text: '', steps: [] };
  return { enabled: true, text, steps: parseSequence(text, laneKey, { hasEvent }).steps };
}

function defaultLanes(key, { hasEvent = false } = {}) {
  const event = hasEvent || (TEMPLATES[key] && TEMPLATES[key].needsEvent);
  let green = ''; let yellow = ''; let red = ''; let gray = ''; let reminders = null; let ai = '';
  if (key === 'open_house_invite') {
    green = 'Remind them the evening before at 6 with the address';
    yellow = 'Give them space, check back the day before';
    red = 'Thank them and offer a private showing another day, right away';
    gray = 'One easy nudge, did they see the invite';
    reminders = { enabled: true, text: 'Remind everyone who said yes the morning of with the address', audience: 'green' };
    ai = 'Answer questions about the open house using the details. If anyone asks about price, offers or terms, tell them I will call them personally. Keep it short and warm.';
  } else if (['just_listed', 'price_improvement', 'coming_soon'].includes(key)) {
    green = 'Offer two private showing times in the next few days, right away';
    yellow = 'Check back in 2 days with one standout detail about the home';
    red = 'Thank them and say I will keep an eye out for the right one, right away';
    gray = 'One light nudge, did they see it';
    ai = 'Answer questions using the listing details only. If they ask about offers, price flexibility or terms, tell them I will call them personally.';
  } else if (['just_sold', 'market_update', 'home_anniversary'].includes(key)) {
    green = 'Offer a complimentary valuation call this week, right away';
    yellow = 'Check back in a few days, no pressure';
    red = 'Thank them, right away';
    gray = '';
    ai = 'Answer simple questions. Anything about what their home is worth: tell them I will put together a private valuation and call them.';
  }
  return {
    green: lane(green, 'green', event),
    yellow: lane(yellow, 'yellow', event),
    red: lane(red, 'red', event),
    gray: { enabled: !!gray, timerText: '2 DAYS', timerHours: 48, text: gray },
    aiReply: { mode: ai ? 'draft' : 'off', instructions: ai },
    reminders: reminders ? { ...reminders, steps: parseSequence(reminders.text, 'green', { hasEvent: true }).steps } : { enabled: false, text: '', steps: [], audience: 'green' },
  };
}

function band(price) {
  if (!price) return { priceMin: null, priceMax: null };
  return { priceMin: Math.round((price * 0.7) / 100000) * 100000, priceMax: Math.round((price * 1.3) / 100000) * 100000 };
}

function defaultAudience(key, listing) {
  const hood = listing && listing.neighborhood;
  switch (key) {
    case 'just_listed':
    case 'price_improvement':
      return listing ? { buyersIn: { enabled: true, neighborhoods: hood ? [hood] : [], ...band(listing.listPrice) } } : { groups: ['buyers'] };
    case 'coming_soon':
      return { groups: ['whales', 'buyers'] };
    case 'just_sold':
    case 'market_update':
      return hood ? { ownersIn: { enabled: true, neighborhoods: [hood] } } : { groups: ['owners'] };
    case 'open_house_invite':
      return hood ? { groups: ['sphere', 'buyers'], neighborhoods: [hood] } : { groups: ['sphere', 'buyers'] };
    case 'home_anniversary':
      return { groups: ['past_clients'] };
    default:
      return {};
  }
}

function catalog() {
  return Object.values(TEMPLATES).map((t) => ({
    key: t.key, label: t.label, icon: t.icon, sub: t.sub, accent: t.accent,
    needsListing: !!t.needsListing, needsEvent: !!t.needsEvent, brief: t.brief || '', audienceHint: t.audienceHint || '',
  }));
}

module.exports = { fillBrief, defaultLanes, defaultAudience, catalog };
