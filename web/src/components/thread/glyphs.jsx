// Messaging-only glyphs the shared Icon set doesn't carry (tapbacks are drawn
// as glyphs — never OS emoji used as icons — exactly like iMessage).

export function TapbackGlyph({ type, emoji, size = 20, color = 'currentColor' }) {
  const s = size;
  switch (type) {
    case 'love':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <path fill={color} d="M12 21.2s-7.8-4.6-9.6-9.7C1.2 7.9 3.4 4.5 6.9 4.5c2.1 0 3.5 1.2 5.1 3.1 1.6-1.9 3-3.1 5.1-3.1 3.5 0 5.7 3.4 4.5 7-1.8 5.1-9.6 9.7-9.6 9.7z" />
        </svg>
      );
    case 'like':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <path fill={color} d="M2.5 10.2h3.6v10.6H2.5zM8 20.8V10.4l4.6-7.2c.3-.5.9-.7 1.4-.5 1.1.4 1.7 1.5 1.4 2.6L14.6 9h5.1c1.4 0 2.4 1.3 2.1 2.6l-1.7 7.6c-.2 1-1.1 1.6-2.1 1.6z" />
        </svg>
      );
    case 'dislike':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: 'scaleY(-1)' }}>
          <path fill={color} d="M2.5 10.2h3.6v10.6H2.5zM8 20.8V10.4l4.6-7.2c.3-.5.9-.7 1.4-.5 1.1.4 1.7 1.5 1.4 2.6L14.6 9h5.1c1.4 0 2.4 1.3 2.1 2.6l-1.7 7.6c-.2 1-1.1 1.6-2.1 1.6z" />
        </svg>
      );
    case 'laugh':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <text x="12" y="11" textAnchor="middle" fontSize="8.6" fontWeight="900" fill={color} fontFamily="-apple-system, system-ui, sans-serif" letterSpacing="0.2">HA</text>
          <text x="12" y="20.5" textAnchor="middle" fontSize="8.6" fontWeight="900" fill={color} fontFamily="-apple-system, system-ui, sans-serif" letterSpacing="0.2">HA</text>
        </svg>
      );
    case 'emphasize':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <path fill={color} d="M7.4 3.5h3.2l-.6 11.2H8zM14.4 3.5h3.2L17 14.7h-2zM9 16.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM16 16.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z" />
        </svg>
      );
    case 'question':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" d="M8.2 8.2a3.9 3.9 0 1 1 5.6 3.5c-1.1.6-1.8 1.4-1.8 2.7v.6" />
          <circle cx="12" cy="19.4" r="1.9" fill={color} />
        </svg>
      );
    case 'emoji':
      return <span style={{ fontSize: Math.round(s * 0.82), lineHeight: 1 }}>{emoji}</span>;
    default:
      return null;
  }
}

export function BellOff({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18 8a6 6 0 0 0-9.33-5M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function PinGlyph({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill={color} d="M15.6 2.4 21.6 8.4a1 1 0 0 1-.4 1.6l-3.4 1.2-3.8 3.8.6 3.6a1 1 0 0 1-1.7.9L9 15.6l-5.3 5.3a1 1 0 0 1-1.4-1.4L7.6 14.2 3.7 10.4a1 1 0 0 1 .9-1.7l3.6.6 3.8-3.8L13.2 2.8a1 1 0 0 1 1.6-.4z" />
    </svg>
  );
}

export function UnreadDotGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6" fill="#fff" />
    </svg>
  );
}

// "pencil on a line" — RevMatch's inline compose button.
export function ComposeGlyph({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

// Signal-bars "line status" (replaces RevMatch's RPM gauge): provider health.
export function LineStatusGlyph({ size = 18, health = 'green' }) {
  const color = { green: '#30D27A', yellow: '#F2A93B', red: '#FF5A5A' }[health] || '#8E8E93';
  const lit = health === 'red' ? 1 : health === 'yellow' ? 3 : health === 'green' ? 4 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={3 + i * 5} y={16 - i * 4} width="3.2" height={5 + i * 4} rx="1.2" fill={i < lit ? color : 'rgba(255,255,255,0.2)'} />
      ))}
    </svg>
  );
}
