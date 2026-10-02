// avatarGradient — single source of truth for every avatar in the app
// (ported verbatim from RevMatch). 135° two-stop gradient; the same seed lands
// the same gradient on every screen. Seed priority everywhere:
//   client.id → phone → display name (lower-cased, trimmed)
export const AVATAR_GRADIENTS = [
  ['#2E8BFF', '#7C6FE8'],
  ['#FF375F', '#F2A93B'],
  ['#30D27A', '#30D27A'],
  ['#9A4DFF', '#9A4DFF'],
  ['#32D4F5', '#2E8BFF'],
  ['#2E8BFF', '#F2A93B'],
  ['#F2A93B', '#FF375F'],
  ['#9A4DFF', '#9A4DFF'],
  ['#FF375F', '#9A4DFF'],
  ['#30D27A', '#2E8BFF'],
  ['#FFD60A', '#F2A93B'],
  ['#9A4DFF', '#FF375F'],
  ['#30D27A', '#2E8BFF'],
];

// Reserved for known contacts silent 30+ days. Never for unknown callers.
export const SILENT_GRADIENT = ['#8E8E93', '#48484A'];

export function avatarGradient(seed) {
  if (!seed) return AVATAR_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export function avatarBackground(seed, silent = false) {
  const [a, b] = silent ? SILENT_GRADIENT : avatarGradient(seed);
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

export function avatarSeed(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim().toLowerCase();
    if (s) return s;
  }
  return '';
}
