// The Battle Plan hero: a quote of the day (rotates without repeating until
// the pool is exhausted) and, in the morning and evening windows, an
// affirmation to say out loud. Every attributed quote below is sourced to a
// published work or a documented speech/interview; anything we couldn't pin to
// its author is left out. Affirmations are unattributed by design.

export const QUOTES = [
  { text: 'We shape our buildings and afterwards our buildings shape us.', author: 'Winston Churchill' },
  { text: 'Form ever follows function.', author: 'Louis Sullivan' },
  { text: 'Well building hath three conditions: firmness, commodity, and delight.', author: 'Sir Henry Wotton' },
  { text: 'A house is a machine for living in.', author: 'Le Corbusier' },
  { text: 'The details are not the details. They make the design.', author: 'Charles Eames' },
  { text: 'Good design is as little design as possible.', author: 'Dieter Rams' },
  { text: 'Design is not just what it looks like and feels like. Design is how it works.', author: 'Steve Jobs' },
  { text: 'Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'The reward of a thing well done is to have done it.', author: 'Ralph Waldo Emerson' },
  { text: 'It is not enough to be industrious; so are the ants. What are you industrious about?', author: 'Henry David Thoreau' },
  { text: 'There is only one valid definition of business purpose: to create a customer.', author: 'Peter Drucker' },
  { text: 'Efficiency is doing things right; effectiveness is doing the right things.', author: 'Peter Drucker' },
  { text: 'You can make more friends in two months by becoming interested in other people than you can in two years by trying to get other people interested in you.', author: 'Dale Carnegie' },
  { text: "Remember that a person's name is to that person the sweetest and most important sound in any language.", author: 'Dale Carnegie' },
  { text: 'You can have everything in life you want, if you will just help enough other people get what they want.', author: 'Zig Ziglar' },
  { text: 'People do not buy goods and services. They buy relations, stories and magic.', author: 'Seth Godin' },
  { text: 'Price is what you pay. Value is what you get.', author: 'Warren Buffett' },
  { text: "You miss 100% of the shots you don't take.", author: 'Wayne Gretzky' },
  { text: 'Luck is the residue of design.', author: 'Branch Rickey' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu' },
  { text: 'Whatever the mind of man can conceive and believe, it can achieve.', author: 'Napoleon Hill' },
];

export const AFFIRMATIONS = [
  'I protect my clients’ biggest decisions as if they were my own.',
  'Every call I make today moves someone closer to home.',
  'I am the most prepared agent in every room I walk into.',
  'I follow up when others forget. That is why they come back.',
  'I earn trust in the details: the dock depth, the HOA, the light at five o’clock.',
  'I build a book of clients who would never think of calling anyone else.',
  'Today I add value before I ask for anything.',
  'I don’t chase listings. I build relationships that bring them to me.',
  'My sphere hears from me because I care, not because I need something.',
  'I know my market better than anyone, and I prove it every day.',
  'I close because I listen.',
  'I stay calm under pressure; my clients borrow my confidence.',
  'Small touches, every day, become a career.',
  'My calendar reflects my priorities: clients first, content second, everything else after.',
];

const STATE_KEY = 'km_quoteState';

function localDayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function daySeed(d) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5);
}

// One quote per local day, drawn at random from the not-yet-seen ones; a new
// cycle starts once every quote has been shown.
export function dailyQuote(now = new Date()) {
  const key = localDayKey(now);
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const st = raw ? JSON.parse(raw) : null;
    if (st && st.dayKey === key && Number.isInteger(st.idx) && QUOTES[st.idx]) return QUOTES[st.idx];
    let seen = st && Array.isArray(st.seen) ? st.seen.filter((i) => Number.isInteger(i) && i < QUOTES.length) : [];
    if (seen.length >= QUOTES.length) seen = [];
    const pool = QUOTES.map((_, i) => i).filter((i) => !seen.includes(i));
    const idx = pool[Math.floor(Math.random() * pool.length)];
    localStorage.setItem(STATE_KEY, JSON.stringify({ dayKey: key, idx, seen: [...seen, idx] }));
    return QUOTES[idx];
  } catch {
    return QUOTES[daySeed(now) % QUOTES.length];
  }
}

export function dailyAffirmation(now = new Date()) {
  return AFFIRMATIONS[daySeed(now) % AFFIRMATIONS.length];
}

// 5:00–8:00 AM and 7:00–10:00 PM local → the affirmation windows.
export function inAffirmationWindow(now = new Date()) {
  const h = now.getHours();
  return (h >= 5 && h < 8) || (h >= 19 && h < 22);
}
