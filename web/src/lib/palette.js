// Data colours (pipeline stages, listing sources, campaign accents, tiers)
// arrive as hex from the server — some stored long ago in the old blue/violet
// palette. tone() maps any of them onto the Soul palette as theme-aware CSS
// variables (monochrome + the highlight + amber/red for warnings), so every
// one reads in dark and light. Unknown colours pass through untouched.
const MAP = {
  // Soul palette (current server constants)
  '#E6E6E6': 'var(--text)',
  '#BDBDBD': 'var(--dim)',
  '#8A8A89': 'var(--dim)',
  '#D4FF3F': 'var(--green)',
  '#FFB440': 'var(--amber)',
  '#FF6B5E': 'var(--red)',
  '#CFE3E3': 'var(--cyan)',
  // legacy RevMatch palette (rows stored before the re-skin)
  '#2E8BFF': 'var(--text)',
  '#4DA2FF': 'var(--text)',
  '#1F8AFF': 'var(--text)',
  '#9A4DFF': 'var(--dim)',
  '#B98CFF': 'var(--dim)',
  '#B98AFF': 'var(--dim)',
  '#BF5AF2': 'var(--dim)',
  '#7C5CFC': 'var(--dim)',
  '#30D27A': 'var(--green)',
  '#34C759': 'var(--green)',
  '#34C4A8': 'var(--cyan)',
  '#F2A93B': 'var(--amber)',
  '#FF9F0A': 'var(--amber)',
  '#FF5A5A': 'var(--red)',
  '#FF7A66': 'var(--red)',
};

export function tone(color, fallback = 'var(--faint)') {
  if (!color) return fallback;
  const key = String(color).trim().toUpperCase();
  return MAP[key] || color;
}

// A translucent tint of any colour (hex or CSS var) — use instead of
// appending hex alpha ("#2E8BFF33"), which breaks on CSS variables.
export function tint(color, pct) {
  return `color-mix(in srgb, ${tone(color)} ${pct}%, transparent)`;
}

export default tone;
