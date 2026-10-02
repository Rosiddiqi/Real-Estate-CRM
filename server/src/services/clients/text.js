// Small text/money helpers for the clients area (server side).

// $4.25M · $850K · $950
function moneyShort(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  const trim = (x, d) => { const s = x.toFixed(d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
  if (abs >= 1e9) return `$${trim(abs / 1e9, 2)}B`;
  if (abs >= 1e6) return `$${trim(abs / 1e6, 2)}M`;
  if (abs >= 1e3) return `$${trim(abs / 1e3, abs >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(abs)}`;
}

// Real-estate money normalization (spec §8.7) — NEVER the car rule.
//   "$12.4M" → 12,400,000 · "850k" → 850,000 · "around 9" (price context) → 9,000,000
//   bare < 100 = millions · 100–9,999 = thousands · ≥ 10,000 = dollars
function parseMoneyRE(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return normalizeBare(raw);
  const s = String(raw).toLowerCase().replace(/[,$\s]/g, '').replace(/usd/, '');
  const m = /^(-?\d+(?:\.\d+)?)(k|m|mm|mil|million|b|bn|billion|thousand)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === 'k' || unit === 'thousand') return Math.round(n * 1e3);
  if (unit === 'm' || unit === 'mm' || unit === 'mil' || unit === 'million') return Math.round(n * 1e6);
  if (unit === 'b' || unit === 'bn' || unit === 'billion') return Math.round(n * 1e9);
  return normalizeBare(n);
}

function normalizeBare(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return Math.round(n * 1e6);
  if (n < 10000) return Math.round(n * 1e3);
  return Math.round(n);
}

module.exports = { moneyShort, parseMoneyRE, normalizeBare };
