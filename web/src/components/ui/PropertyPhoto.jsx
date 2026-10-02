// PropertyPhoto — every property image in the app. Lazy, cover-fit, and if the
// image is missing or fails to load it falls back to a branded architectural
// placeholder (seeded gradient + elevation line drawing) so a card never shows
// a broken image.
//   <PropertyPhoto src={l.heroPhoto} seed={l.id} label={l.neighborhood} height={180} radius={16} />
import { useState } from 'react';
import { mediaUrl } from '../../api/client';

const PALETTES = [
  ['#0F2A44', '#1E5A7A', '#7FB8D6'], // bay blue
  ['#1B2A22', '#2F5D4A', '#9CC9A8'], // palm
  ['#2A1F17', '#6B4A33', '#E0B38A'], // sandstone
  ['#16192B', '#343E7A', '#A7B4F2'], // dusk
  ['#22161F', '#5E2F4E', '#E6A3C6'], // sunset
  ['#121A1F', '#2B4A57', '#8FD0DD'], // glass
];

function pick(seed) {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { pal: PALETTES[h % PALETTES.length], variant: h % 3 };
}

export function PhotoFallback({ seed, label, compact }) {
  const { pal, variant } = pick(seed);
  const [a, b, c] = pal;
  return (
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(160deg, ${b} 0%, ${a} 70%)`, overflow: 'hidden' }}>
      <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
        <defs>
          <linearGradient id={`sky-${seed}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0.35" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="400" height="240" fill={`url(#sky-${seed})`} />
        <circle cx="318" cy="62" r="26" fill={c} opacity="0.22" />
        {variant === 0 ? (
          // modern two-volume villa
          <g fill="none" stroke={c} strokeOpacity="0.75" strokeWidth="2">
            <path d="M70 200V130h150v70M190 130V95h140v105" />
            <path d="M40 200h330" />
            <path d="M95 150h45v50M160 150h40M210 115h100M230 140h70v60" strokeOpacity="0.5" />
          </g>
        ) : variant === 1 ? (
          // waterfront tower
          <g fill="none" stroke={c} strokeOpacity="0.75" strokeWidth="2">
            <path d="M170 200V50h70v150M150 200h110" />
            {[70, 90, 110, 130, 150, 170].map((y) => <path key={y} d={`M180 ${y}h50`} strokeOpacity="0.45" />)}
            <path d="M20 214c20 0 20-6 40-6s20 6 40 6 20-6 40-6 20 6 40 6 20-6 40-6 20 6 40 6 20-6 40-6 20 6 40 6 20-6 40-6" strokeOpacity="0.5" />
          </g>
        ) : (
          // mediterranean estate
          <g fill="none" stroke={c} strokeOpacity="0.75" strokeWidth="2">
            <path d="M60 200v-60l50-30 50 30v60M160 200v-75h170v75M150 125l95-40 95 40" />
            <path d="M40 200h340M190 200v-40a15 15 0 0 1 30 0v40M260 150h40v25h-40z" strokeOpacity="0.5" />
          </g>
        )}
      </svg>
      {label && !compact ? (
        <div style={{ position: 'absolute', left: 12, bottom: 10, right: 12, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }} className="km-truncate">
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
