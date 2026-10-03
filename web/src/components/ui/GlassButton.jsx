// GlassButton — 40px liquid-glass circle (header controls, floating actions).
//   <GlassButton icon="search" onClick={...} label="Search" />
//   <GlassButton icon="plus" accent />            — solid primary circle (Soul white)
//   <GlassButton icon="bell" badge={3} />
import Icon from './Icon';

export default function GlassButton({ icon, onClick, label, size = 40, accent = false, badge, iconSize, children, style, disabled, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${accent ? '' : 'km-lg'} km-press ${className}`}
      style={{
        position: 'relative',
        width: size, height: size, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: accent ? 'var(--on-accent)' : 'var(--lg-text)',
        flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
        ...(accent ? { background: 'var(--bright)', boxShadow: 'var(--glow-btn)' } : null),
        ...style,
      }}
    >
      {children || <Icon name={icon} size={iconSize || Math.round(size * 0.48)} stroke={1.6} />}
      {badge ? (
        <span
          className="km-badge"
          style={{ position: 'absolute', top: -3, right: -3, border: '2px solid var(--bg)', minWidth: 18, height: 18, fontSize: 10 }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
