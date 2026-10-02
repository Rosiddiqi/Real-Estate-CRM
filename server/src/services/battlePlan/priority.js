// Focus-segment ladder — the real-estate port of RevMatch's "Sports-Car thesis"
// (911 > 718 > Cayenne). Bands never overlap, so the price tier always wins and
// attributes only order WITHIN a tier:
//   TROPHY ≥$20M [80,20] · ESTATE $10–20M [62,16] · LUXURY $5–10M [44,16]
//   PREMIER $2–5M [28,14] · CORE <$2M [10,12]
// Sub-tier strength comes from the property's character (waterfront 1.0,
// penthouse / view 0.9, gated estate 0.82, new construction 0.74 … base 0.28).
// Returns 0..100, or null when there's no price signal at all.

const BANDS = [
  { tier: 'TROPHY', min: 20_000_000, base: 80, span: 20 },
  { tier: 'ESTATE', min: 10_000_000, base: 62, span: 16 },
  { tier: 'LUXURY', min: 5_000_000, base: 44, span: 16 },
  { tier: 'PREMIER', min: 2_000_000, base: 28, span: 14 },
  { tier: 'CORE', min: 0, base: 10, span: 12 },
];

const STRENGTH_LADDER = [
  [/\b(ocean\s*front|oceanfront|beach\s*front|beachfront|waterfront|bayfront|lake\s*front|direct\s+water)\b/i, 1.0],
  [/\b(penthouse|ph\b|panoramic|skyline|ocean\s+view|water\s+view|view)\b/i, 0.9],
  [/\b(gated|estate|compound|equestrian|vineyard)\b/i, 0.82],
  [/\b(new\s+construction|new\s+build|pre[-\s]?construction|new\s+development)\b/i, 0.74],
  [/\b(pool|dock|wine\s+cellar|guest\s+house|elevator)\b/i, 0.6],
  [/\b(renovated|turnkey|designer)\b/i, 0.5],
];

function bandFor(price) {
  const p = Number(price) || 0;
  return BANDS.find((b) => p >= b.min) || BANDS[BANDS.length - 1];
}

function tierFor(price) {
  if (!price || price <= 0) return null;
  return bandFor(price).tier;
}

function strengthFor(text) {
  const t = String(text || '');
  for (const [re, s] of STRENGTH_LADDER) if (re.test(t)) return s;
  return 0.28;
}

// price: best known price signal; text: attributes / names / waterfront etc.
function propertyPriority(price, text = '') {
  if (!price || price <= 0) return null;
  const b = bandFor(price);
  return Math.min(100, Math.round(b.base + b.span * strengthFor(text)));
}

// Mention fallback (a to-do title naming a property type / feature).
const PROPERTY_MENTION_RE = /\b(waterfront|oceanfront|penthouse|estate|compound|villa|mansion|beachfront|bayfront|MLS\s*#?\s*\w+)\b/i;

module.exports = { propertyPriority, tierFor, bandFor, strengthFor, PROPERTY_MENTION_RE, BANDS };
