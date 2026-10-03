// KeyMatch brand mark — an original glyph drawn in the Soul manner: a thin
// ring with a keyhole at its heart and one highlight dot riding the ring (the
// "match"). The wordmark is Poppins Light, wide-tracked caps.
//   <BrandMark size={28} />            mark only
//   <Wordmark size={13} />             KEYMATCH
//   <BrandLockup size={22} />          mark + wordmark
import { BRAND } from '../../brand';

export function BrandMark({ size = 24, color = 'currentColor', dot = true, stroke, style }) {
  const sw = stroke ?? (size >= 48 ? 0.8 : size >= 28 ? 1.05 : 1.3);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <circle cx="12" cy="12" r="10.4" stroke={color} strokeWidth={sw} />
      <circle cx="12" cy="10.2" r="2.45" fill={color} />
      <path d="M10.9 11.5h2.2l.72 5.3h-3.64z" fill={color} />
      {dot ? <circle cx="19.35" cy="4.65" r="1.85" fill="var(--hl)" /> : null}
    </svg>
  );
}

export function Wordmark({ size = 13, color = 'var(--text)', style }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: size, lineHeight: 1,
        letterSpacing: '0.34em', marginRight: '-0.34em', textTransform: 'uppercase', color, whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {BRAND.name}
    </span>
  );
}

export default function BrandLockup({ size = 22, wordSize, color = 'var(--text)', gap = 12, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, color, ...style }}>
      <BrandMark size={size} />
      <Wordmark size={wordSize || Math.round(size * 0.56)} color={color} />
    </span>
  );
}
