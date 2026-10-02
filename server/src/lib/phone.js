// Phone normalization — the ONE implementation (backend). Stored form is the
// bare 10-digit US number ("3055550142"); non-US numbers keep their digits.
function normalizePhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.includes('@')) return s.toLowerCase(); // iMessage email handle
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

// E.164 for providers (Twilio): "+13055550142"
function toE164(raw) {
  const n = normalizePhone(raw);
  if (!n || n.includes('@')) return n;
  if (n.length === 10) return `+1${n}`;
  return n.startsWith('+') ? n : `+${n}`;
}

// Display: 305-555-0142
function formatPhone(raw) {
  const n = normalizePhone(raw);
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return raw || '';
}

// US area code → IANA timezone (subset; used for recipient-local send windows).
const AREA_TZ = {
  '212': 'America/New_York', '646': 'America/New_York', '917': 'America/New_York', '718': 'America/New_York',
  '305': 'America/New_York', '786': 'America/New_York', '954': 'America/New_York', '561': 'America/New_York',
  '407': 'America/New_York', '813': 'America/New_York', '727': 'America/New_York', '239': 'America/New_York',
  '404': 'America/New_York', '678': 'America/New_York', '617': 'America/New_York', '202': 'America/New_York',
  '312': 'America/Chicago', '773': 'America/Chicago', '214': 'America/Chicago', '713': 'America/Chicago',
  '512': 'America/Chicago', '615': 'America/Chicago',
  '303': 'America/Denver', '720': 'America/Denver', '970': 'America/Denver', '602': 'America/Phoenix', '480': 'America/Phoenix',
  '310': 'America/Los_Angeles', '323': 'America/Los_Angeles', '424': 'America/Los_Angeles', '213': 'America/Los_Angeles',
  '415': 'America/Los_Angeles', '650': 'America/Los_Angeles', '408': 'America/Los_Angeles', '702': 'America/Los_Angeles',
  '206': 'America/Los_Angeles', '858': 'America/Los_Angeles', '619': 'America/Los_Angeles', '949': 'America/Los_Angeles',
};
function tzForPhone(raw, fallback = 'America/New_York') {
  const n = normalizePhone(raw);
  return (n.length === 10 && AREA_TZ[n.slice(0, 3)]) || fallback;
}

module.exports = { normalizePhone, toE164, formatPhone, tzForPhone };
