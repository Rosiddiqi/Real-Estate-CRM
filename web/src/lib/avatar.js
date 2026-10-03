// Avatar backgrounds — single source of truth for every avatar in the app.
// Soul is monochrome: initials sit on a graphite disc whose shade is seeded,
// so the same seed lands the same shade on every screen. Shades are built
// from --accent-rgb (white on dark, ink on light) so they follow the theme.
// Seed priority everywhere:
//   client.id → phone → display name (lower-cased, trimmed)
export const AVATAR_SHADES = [
  [0.17, 0.07],
  [0.12, 0.05],
  [0.21, 0.09],
  [0.14, 0.11],
  [0.10, 0.04],
  [0.19, 0.06],
  [0.15, 0.08],
];

// Reserved for known contacts silent 30+ days. Never for unknown callers.
export const SILENT_SHADE = [0.05, 0.05];

export function avatarShade(seed) {
  if (!seed) return AVATAR_SHADES[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_SHADES[h % AVATAR_SHADES.length];
}

export function avatarBackground(seed, silent = false) {
  const [a, b] = silent ? SILENT_SHADE : avatarShade(seed);
  return `linear-gradient(135deg, rgba(var(--accent-rgb), ${a}) 0%, rgba(var(--accent-rgb), ${b}) 100%)`;
}

export function avatarSeed(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim().toLowerCase();
    if (s) return s;
  }
  return '';
}
