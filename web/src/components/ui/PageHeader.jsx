// PageHeader — the ONE header layout (Soul): a small UPPERCASE tracked title
// centered between hairline glass circles; the bar has no band — content
// scrolling under it gets the scroll-edge effect. `large` gives tab roots a
// big Poppins title instead.
import GlassButton from './GlassButton';

export default function PageHeader({
  title,
  subtitle,
  onBack,          // renders a back chevron when set
  left,            // node (overrides back button)
  right,           // node
  large = false,   // large-title style (left-aligned 32px) for tab roots
  children,        // optional row beneath (tabs, search…)
  style,
  transparent = false,
}) {
  return (
    <div
      className={transparent ? '' : 'km-scroll-edge'}
      style={{
        position: 'relative', zIndex: 20, flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 8px)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          padding: '0 20px',
        }}
      >
        <div style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 8 }}>
          {left !== undefined ? left : onBack ? <GlassButton icon="chevronLeft" onClick={onBack} label="Back" /> : null}
        </div>
        <div style={{ textAlign: 'center', minWidth: 0, maxWidth: '62vw' }}>
          {!large && title ? (
            <div className="km-page-title km-truncate" style={{ lineHeight: 1.15 }}>{title}</div>
          ) : null}
          {!large && subtitle ? (
            <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }}>{subtitle}</div>
          ) : null}
        </div>
        <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
      </div>
      {large && title ? (
        <div style={{ padding: '6px 24px 8px' }}>
          <div className="km-large-title">{title}</div>
          {subtitle ? <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 6 }}>{subtitle}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
