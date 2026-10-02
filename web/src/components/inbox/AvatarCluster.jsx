// Group avatar — up to three overlapping faces + "+N" (RevMatch AvatarCluster).
// Known participants use their seeded gradient; unknown numbers get a silhouette.
import Avatar from '../ui/Avatar';

export default function AvatarCluster({ participants = [], size = 48 }) {
  const list = Array.isArray(participants) ? participants.slice() : [];
  list.sort((a, b) => (!!(b && b.clientId) - !!(a && a.clientId)));
  const face = Math.round(size * 0.72);
  const overlap = Math.round(face * 0.32);
  const shown = list.slice(0, list.length > 3 ? 2 : 3);
  const extra = list.length - shown.length;
  const items = [...shown.map((p, i) => ({ p, i })), ...(extra > 0 ? [{ extra, i: shown.length }] : [])];
  const width = face + (items.length - 1) * (face - overlap);
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
      <div style={{ position: 'relative', width, height: face, transform: width > size ? `scale(${size / width})` : undefined }}>
        {items.map(({ p, i, extra: more }) => (
          <div
            key={i}
            style={{
              position: 'absolute', left: i * (face - overlap), top: 0, zIndex: 10 - i,
              borderRadius: '50%', boxShadow: '0 0 0 1.5px var(--km-crow-bg, #000)',
            }}
          >
            {more ? (
              <span style={{
                width: face, height: face, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--surfaceHi)', color: 'var(--dim)', fontSize: Math.round(face * 0.3), fontWeight: 700,
              }}
              >
                +{more}
              </span>
            ) : (
              <Avatar
                name={p && p.name ? p.name : ''}
                seed={(p && (p.clientId || p.handle)) || String(i)}
                src={p && p.avatarUrl}
                size={face}
                silent={!(p && (p.clientId || p.name))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
