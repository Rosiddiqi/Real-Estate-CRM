// Sticky bucket header — "NEEDS RESPONSE 3 ———" (10px caps, fading rule).
export default function SectionHeader({ label, count, accent = false, action }) {
  return (
    <div className="km-isec" role="heading" aria-level={3}>
      <span className="km-isec-label" style={accent ? { color: 'var(--text)' } : undefined}>{label}</span>
      {count != null ? <span className="km-isec-count">{count}</span> : null}
      <span className="km-isec-rule" />
      {action || null}
    </div>
  );
}
