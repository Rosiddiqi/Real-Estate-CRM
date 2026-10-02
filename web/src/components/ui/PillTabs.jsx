// PillTabs — segmented control. Track = liquid glass pill; the selected
// segment is a NEUTRAL lens that springs between cells; the label carries the
// emphasis (HIG: no color on the backgrounds of several controls).
//   <PillTabs value={tab} onChange={setTab} items={[{ id:'all', label:'All', count:12 }, ...]} />
export default function PillTabs({ items, value, onChange, size = 'md', style, className = '' }) {
  const idx = Math.max(0, items.findIndex((i) => i.id === value));
  const n = items.length || 1;
  const h = size === 'sm' ? 34 : 40;
  return (
    <div
      className={`km-lg km-lg--line ${className}`}
      role="tablist"
      style={{
        position: 'relative', display: 'flex', alignItems: 'stretch',
        height: h, padding: 3, borderRadius: 999, ...style,
      }}
    >
      <div
        aria-hidden="true"
        className="km-lg km-lg--flat km-lg-seg"
        style={{
          position: 'absolute', top: 3, bottom: 3, left: 3,
          width: `calc((100% - 6px) / ${n})`,
          transform: `translateX(${idx * 100}%)`,
          borderRadius: 999,
          transition: 'transform 0.34s var(--km-spring)',
        }}
      />
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(it.id)}
            style={{
              flex: 1, position: 'relative', zIndex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: size === 'sm' ? 12.5 : 13.5, fontWeight: 600,
              color: active ? 'var(--lg-text)' : 'var(--lg-text-idle)',
              transition: 'color 0.2s',
              padding: '0 6px',
            }}
          >
            <span className="km-truncate">{it.label}</span>
            {it.count ? (
              <span
                style={{
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                  fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? 'var(--blue)' : 'var(--lg-fill)', color: active ? '#fff' : 'var(--lg-text-idle)',
                }}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
