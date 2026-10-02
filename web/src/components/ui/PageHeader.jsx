// PageHeader — the ONE header layout (RevMatch rule #14): title 24px/600,
// perfectly centered between the left and right clusters; controls float as
// liquid-glass circles; the bar itself has no band — content scrolling under
// it gets the scroll-edge effect.
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
          padding: '0 12px',
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
            <div className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 1 }}>{subtitle}</div>
          ) : null}
        </div>
        <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
      </div>
      {large && title ? (
        <div style={{ padding: '2px 16px 6px' }}>
          <div className="km-large-title">{title}</div>
          {subtitle ? <div style={{ fontSize: 14, color: 'var(--dim)', marginTop: 2 }}>{subtitle}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
