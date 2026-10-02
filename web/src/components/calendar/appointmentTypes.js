// Appointment type catalog — the single source of truth for type labels,
// icons, default durations and KIND colors (tokens.css --kind-*). The server
// validates the same ids (services/calendar.js TYPES).
//
// KIND color = signal: showing/tour → showing · open house/broker open →
// openhouse · closing → closing · listing presentation → listing ·
// inspection/appraisal/final walkthrough → prep · call/video → call ·
// content → content · personal/lunch → personal.

export const KIND_COLOR = {
  call: 'var(--kind-call)',
  text: 'var(--kind-text)',
  email: 'var(--kind-email)',
  match: 'var(--kind-match)',
  prep: 'var(--kind-prep)',
  personal: 'var(--kind-personal)',
  content: 'var(--kind-content)',
  showing: 'var(--kind-showing)',
  openhouse: 'var(--kind-openhouse)',
  closing: 'var(--kind-closing)',
  listing: 'var(--kind-listing)',
  ai: 'var(--violet)',
  neutral: 'var(--bp-neutral)',
};

export const APPT_TYPES = [
  { id: 'showing', label: 'Showing', icon: 'house', kind: 'showing', duration: 60, desc: 'Client touring a property' },
  { id: 'private_tour', label: 'Private tour', icon: 'door', kind: 'showing', duration: 60, desc: 'Off-hours or VIP walkthrough' },
  { id: 'open_house', label: 'Open house', icon: 'sign', kind: 'openhouse', duration: 180, desc: 'Public open house' },
  { id: 'broker_open', label: 'Broker open', icon: 'building', kind: 'openhouse', duration: 120, desc: 'Caravan / broker preview' },
  { id: 'listing_presentation', label: 'Listing pitch', icon: 'briefcase', kind: 'listing', duration: 90, desc: 'Listing presentation with a seller' },
  { id: 'buyer_consult', label: 'Buyer consult', icon: 'handshake', kind: 'match', duration: 60, desc: 'Needs analysis with a buyer' },
  { id: 'inspection', label: 'Inspection', icon: 'search', kind: 'prep', duration: 180, desc: 'Contingency milestone' },
  { id: 'appraisal', label: 'Appraisal', icon: 'clipboard', kind: 'prep', duration: 60, desc: 'Lender appraisal' },
  { id: 'final_walkthrough', label: 'Walkthrough', icon: 'checkCircle', kind: 'prep', duration: 45, desc: 'Final walkthrough before closing' },
  { id: 'closing', label: 'Closing', icon: 'key', kind: 'closing', duration: 60, desc: 'Signing & key handover' },
  { id: 'call', label: 'Call', icon: 'phone', kind: 'call', duration: 15, desc: 'Scheduled phone call' },
  { id: 'video', label: 'Video', icon: 'video', kind: 'call', duration: 30, desc: 'Video call' },
  { id: 'meeting', label: 'Meeting', icon: 'userCheck', kind: 'email', duration: 45, desc: 'In-person meeting' },
  { id: 'content', label: 'Content', icon: 'camera', kind: 'content', duration: 90, desc: 'Listing media / social shoot' },
  { id: 'personal', label: 'Personal', icon: 'heart', kind: 'personal', duration: 60, desc: 'Not client work' },
  { id: 'team', label: 'Team', icon: 'users', kind: 'neutral', duration: 30, desc: 'Brokerage or team meeting' },
  { id: 'other', label: 'Other', icon: 'more', kind: 'neutral', duration: 30, desc: 'Anything else' },
];

const BY_ID = Object.fromEntries(APPT_TYPES.map((t) => [t.id, t]));
const ALIASES = { tour: 'private_tour', consult: 'buyer_consult', listing_appt: 'listing_presentation', phone_call: 'call', walkthrough: 'final_walkthrough', team_meeting: 'team', appointment: 'other' };

export function apptType(id) {
  return BY_ID[id] || BY_ID[ALIASES[id]] || BY_ID.other;
}
export function apptColor(id) {
  return KIND_COLOR[apptType(id).kind] || KIND_COLOR.neutral;
}
// Solid-color tile accent for a rail item.
export function itemColor(item) {
  if (!item) return KIND_COLOR.neutral;
  if (item.kind === 'appt') return apptColor(item.apptType);
  if (item.kind === 'content') return KIND_COLOR.content;
  if (item.kind === 'personal') return KIND_COLOR.personal;
  return KIND_COLOR[item.kind] || KIND_COLOR.neutral;
}

// color-mix alpha helper — works with CSS variables.
export function alpha(color, pct) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export const SHOWING_TYPES = new Set(['showing', 'private_tour', 'open_house', 'broker_open']);
export const STATUS_LABEL = { scheduled: 'Scheduled', confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' };
export const OUTCOMES = [
  { id: 'loved', label: 'Loved it' },
  { id: 'liked', label: 'Liked it' },
  { id: 'maybe', label: 'On the fence' },
  { id: 'pass', label: 'Not for them' },
  { id: 'second', label: 'Second showing' },
  { id: 'offer', label: 'Writing an offer' },
];
