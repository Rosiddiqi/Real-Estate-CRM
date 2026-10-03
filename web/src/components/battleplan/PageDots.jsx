// PLAN · STATS page dots — wide bar (active) + dim dot (inactive), monochrome.
export default function PageDots({ page, onSelectPage, style }) {
  const item = (n, label) => {
    const on = page === n;
    return (
      <button
        type="button"
        className="bp-dot-btn"
        onClick={() => onSelectPage?.(n)}
        aria-label={`Go to ${label}`}
        aria-pressed={on}
      >
        <span className="bp-dot-bar" style={{ width: on ? 18 : 4, background: on ? 'var(--bp-t1)' : 'var(--bp-t3)' }} />
        <span className="bp-dot-label" style={{ color: on ? 'var(--bp-t1)' : 'var(--bp-t3)' }}>{label}</span>
      </button>
    );
  };
  return (
    <div className="bp-dots" style={style}>
      {item(0, 'PLAN')}
      {item(1, 'STATS')}
    </div>
  );
}
