// Avatar — Soul: monochrome initials on a graphite disc with a hairline ring
// (seeded shade, identical on every screen), photo when available,
// silhouette for unsaved numbers. Optional channel dot (iMessage = white,
// SMS = grey) and status ring.
import { avatarBackground, avatarSeed } from '../../lib/avatar';
import { getInitials } from '../../lib/format';
import { mediaUrl } from '../../api/client';

function Silhouette({ size }) {
  return (
    <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="var(--faint)" aria-hidden="true">
      <circle cx="12" cy="8.2" r="4.4" />
      <path d="M3.5 21.5c.6-4.6 4.1-7.4 8.5-7.4s7.9 2.8 8.5 7.4z" />
    </svg>
  );
}

export default function Avatar({
  name,
  seed,
  src,
  size = 40,
  silent = false,
  channel,          // 'imessage' | 'sms' — small dot bottom-right
  ring,             // CSS color for a status ring
  badge,            // ReactNode rendered top-right (e.g. whale crown)
  onClick,
  style,
  className = '',
}) {
  const initials = getInitials(name);
  const bg = avatarBackground(avatarSeed(seed, name), silent);
  const fontSize = Math.round(size * 0.38);
  const dot = Math.max(9, Math.round(size * 0.26));
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`km-avatar ${onClick ? 'km-press' : ''} ${className}`}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        fontSize,
        background: src ? 'var(--surfaceHi)' : bg,
        color: silent ? 'var(--faint)' : undefined,
        boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 3.5px ${ring}` : 'inset 0 0 0 var(--hairline) var(--lineHi)',
        overflow: 'visible',
        ...style,
      }}
      aria-label={name || 'Contact'}
    >
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {src ? (
          <img src={mediaUrl(src)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : initials ? (
          <span style={{ lineHeight: 1 }}>{initials}</span>
        ) : (
          <Silhouette size={size} />
        )}
      </span>
      {channel ? (
        <span
          style={{
            position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: '50%',
            background: channel === 'sms' ? 'var(--meta)' : 'var(--text)',
            border: '2px solid var(--bg)',
          }}
        />
      ) : null}
      {badge ? (
        <span style={{ position: 'absolute', top: -4, right: -4 }}>{badge}</span>
      ) : null}
    </Tag>
  );
}
