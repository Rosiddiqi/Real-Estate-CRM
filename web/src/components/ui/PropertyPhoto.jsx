// PropertyPhoto — every property image in the app. Lazy, cover-fit, and if the
// image is missing or fails to load it falls back to a quiet, on-brand
// placeholder so a card never shows a broken image.
//   <PropertyPhoto src={l.heroPhoto} seed={l.id} label={l.neighborhood} height={180} radius={16} />
import { useState } from 'react';
import { mediaUrl } from '../../api/client';

// Quiet, on-brand "no photo yet": showroom-black surface, a faint accent
// light from the top corner, fine architectural fluting and a small glyph —
// never a cartoon. Seeded tint so neighbouring cards aren't identical.
const TINTS = ['46,139,255', '25,194,214', '107,131,255', '77,162,255', '154,77,255', '48,210,122'];

function pick(seed) {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { tint: TINTS[h % TINTS.length], x: 55 + (h % 40), tower: h % 3 === 1 };
}

export function PhotoFallback({ seed, label, compact }) {
  const { tint, x, tower } = pick(seed);
  const glyph = tower
    ? <path d="M9 21V4h8v17M5 21h14M11.5 8h3M11.5 11.5h3M11.5 15h3" />
    : <path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-6h4v6" />;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: `radial-gradient(130% 95% at ${x}% -10%, rgba(${tint},0.22), rgba(${tint},0) 62%), linear-gradient(180deg, #121925 0%, #0B0F16 100%)`,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, opacity: 0.55, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px)', maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.15))', WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.15))' }} />
      <svg viewBox="0 0 24 24" width={compact ? 18 : 30} height={compact ? 18 : 30} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={compact ? 1.6 : 1.3} strokeLinecap="round" strokeLinejoin="round"
        style={{ position: 'absolute', left: '50%', top: '50%', transform: compact ? 'translate(-50%, -50%)' : 'translate(-50%, -60%)' }}>
        {glyph}
      </svg>
      {label && !compact ? (
        <div style={{ position: 'absolute', left: 14, bottom: 11, right: 14, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }} className="km-truncate">
          {label}
        </div>
      ) : null}
    </div>
  );
}

export default function PropertyPhoto({ src, seed, label, height, ratio, radius = 0, style, children, className = '', alt = '' }) {
  const [failed, setFailed] = useState(false);
  const showImg = src && !failed;
  return (
    <div
      className={`km-photo ${className}`}
      style={{
        height,
        aspectRatio: !height && ratio ? ratio : undefined,
        borderRadius: radius,
        ...style,
      }}
    >
      {showImg ? (
        <img src={mediaUrl(src)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ position: 'absolute', inset: 0 }} />
      ) : (
        <PhotoFallback seed={seed || src || label} label={label} compact={(height && height < 90)} />
      )}
      {children}
    </div>
  );
}
