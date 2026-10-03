// Small shared primitives. Import what you need:
//   import { Button, Chip, EmptyState, Skeleton, ScoreDial, Stars, Field, TextInput,
//            TextArea, Select, Switch, Section, Row, Spinner, Segmented } from '../ui/kit';
import Icon from './Icon';

// ── Button ────────────────────────────────────────────────────────────────
export function Button({ variant = 'primary', size, block, icon, iconRight, loading, children, className = '', ...rest }) {
  const v = variant === 'primary' ? '' : `km-btn--${variant}`;
  const s = size ? `km-btn--${size}` : '';
  return (
    <button type="button" className={`km-btn ${v} ${s} ${block ? 'km-btn--block' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} stroke={1.8} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 15 : 17} stroke={1.8} /> : null}
    </button>
  );
}

export function Spinner({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'km-spin 0.8s linear infinite' }} aria-label="Loading">
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────
// tone: blue | danger | ai | success | caution | neutral
export function Chip({ tone = 'blue', icon, children, style, className = '' }) {
  const t = tone === 'blue' ? '' : `km-chip--${tone}`;
  return (
    <span className={`km-chip ${t} ${className}`} style={style}>
      {icon ? <Icon name={icon} size={11} stroke={2.2} /> : null}
      {children}
    </span>
  );
}

// Colored dot + label (stage pills etc.)
export function DotLabel({ color, children, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--dim)', ...style }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {children}
    </span>
  );
}

// ── Empty / loading ───────────────────────────────────────────────────────
export function EmptyState({ icon = 'sparkle', title, sub, action, style }) {
  return (
    <div className="km-empty" style={style}>
      <div className="km-tile" style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color="var(--faint)" stroke={1.5} />
      </div>
      {title ? <div className="km-empty-title">{title}</div> : null}
      {sub ? <div className="km-empty-sub">{sub}</div> : null}
      {action || null}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 8, style }) {
  return <div className="km-skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonRows({ n = 6, avatar = true }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '12px 0' }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {avatar ? <Skeleton w={44} h={44} r={22} /> : null}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton w={`${55 + ((i * 17) % 35)}%`} h={13} />
            <Skeleton w={`${35 + ((i * 23) % 45)}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Score dial ────────────────────────────────────────────────────────────
export function scoreColor(v) {
  if (v >= 90) return 'var(--hl-ink)';
  if (v >= 80) return 'var(--text)';
  if (v >= 60) return 'var(--amber)';
  return 'var(--faint)';
}

export function ScoreDial({ value = 0, size = 44, stroke = 4, color, label, fontSize }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const col = color || scoreColor(value);
  return (
    <div className="km-dial" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          className="km-dial-arc"
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s var(--km-ease)' }}
        />
      </svg>
      <span className="km-dial-num" style={{ fontSize: fontSize || Math.round(size * 0.32), color: col }}>
        {label != null ? label : Math.round(value)}
      </span>
    </div>
  );
}

// ── Stars ─────────────────────────────────────────────────────────────────
export function Stars({ value = 0, onChange, size = 14, gap = 2 }) {
  return (
    <span style={{ display: 'inline-flex', gap }} role={onChange ? 'radiogroup' : undefined} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const el = (
          <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={on ? 'var(--hl-ink)' : 'none'} stroke={on ? 'var(--hl-ink)' : 'var(--faint)'} strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        );
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)} style={{ padding: 2 }} aria-label={`${n} star${n > 1 ? 's' : ''}`}>{el}</button>
        ) : el;
      })}
    </span>
  );
}

// ── Form fields (focus → scroll into view, iOS-safe 16px text) ──────────
const scrollIntoViewSoon = (e) => {
  const t = e.target;
  setTimeout(() => { try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ } }, 300);
};

export function Field({ label, hint, error, children, style }) {
  return (
    <label className="km-field" style={style}>
      {label ? <span className="km-field-label">{label}</span> : null}
      {children}
      {error ? <span style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span> : hint ? <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hint}</span> : null}
    </label>
  );
}

export function TextInput({ label, hint, error, style, inputStyle, prefix, ...rest }) {
  const input = (
    <input className="km-input" onFocus={scrollIntoViewSoon} style={{ ...(prefix ? { paddingLeft: 28 } : null), ...inputStyle }} {...rest} />
  );
  return (
    <Field label={label} hint={hint} error={error} style={style}>
      {prefix ? (
        <span style={{ position: 'relative', display: 'block' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)', fontSize: 15 }}>{prefix}</span>
          {input}
        </span>
      ) : input}
    </Field>
  );
}

export function TextArea({ label, hint, error, style, rows = 4, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} style={style}>
      <textarea className="km-input" rows={rows} onFocus={scrollIntoViewSoon} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, error, style, options = [], ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} style={style}>
      <span style={{ position: 'relative', display: 'block' }}>
        <select className="km-input" onFocus={scrollIntoViewSoon} style={{ paddingRight: 36 }} {...rest}>
          {options.map((o) => (typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--faint)' }}>
          <Icon name="chevronDown" size={16} />
        </span>
      </span>
    </Field>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`km-switch ${checked ? 'km-switch--on' : ''}`}
      style={{ opacity: disabled ? 0.5 : 1 }}
    />
  );
}

// Chip-style multi select (amenities, neighborhoods…)
export function ChipSelect({ options, value = [], onChange, multi = true }) {
  const set = new Set(value);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const on = set.has(id);
        return (
          <button
            key={id}
            type="button"
            className={`km-pill ${on ? 'km-pill--on' : ''}`}
            onClick={() => {
              if (!multi) return onChange?.(on ? [] : [id]);
              const next = new Set(set);
              if (on) next.delete(id); else next.add(id);
              onChange?.([...next]);
            }}
          >
            {on ? <Icon name="check" size={13} stroke={2.4} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Grouped list (iOS inset grouped) ─────────────────────────────────────
export function Section({ title, action, children, style, footer }) {
  return (
    <section style={{ marginTop: 22, ...style }}>
      {title || action ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px' }}>
          {title ? <div className="km-eyebrow">{title}</div> : <span />}
          {action || null}
        </div>
      ) : null}
      {children}
      {footer ? <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '8px 4px 0' }}>{footer}</div> : null}
    </section>
  );
}

// Soul row: a bare 22px outline icon, Poppins Medium label, quiet sub,
// generous rhythm and a whisper of a divider. (iconBg is accepted for
// compatibility but Soul icons sit on the surface, not in tiles.)
export function Row({ icon, iconColor, iconBg, title, sub, value, chevron, onClick, right, danger, style, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={onClick ? 'km-press' : ''}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
        padding: '14px 16px', minHeight: 54, borderBottom: '1px solid rgba(var(--accent-rgb), 0.05)', ...style,
      }}
    >
      {icon ? (
        <span style={{ width: 24, height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'var(--red)' : (iconColor || 'var(--text)') }}>
          <Icon name={icon} size={21} stroke={1.6} />
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 500, color: danger ? 'var(--red)' : 'var(--text)' }}>{title}</span>
        {sub ? <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--faint)', marginTop: 2 }}>{sub}</span> : null}
        {children}
      </span>
      {value != null ? <span style={{ fontFamily: 'var(--font-num)', fontSize: 14, color: 'var(--dim)', flexShrink: 0 }}>{value}</span> : null}
      {right || null}
      {chevron ? <Icon name="chevronRight" size={16} color="var(--faint)" stroke={1.6} /> : null}
    </Tag>
  );
}

export function Group({ children, style }) {
  return (
    <div className="km-tile" style={{ overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

// Stat block (label + big number + delta)
export function Stat({ label, value, sub, tone, style }) {
  const color = tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--dim)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <div className="km-eyebrow">{label}</div>
      <div className="km-num" style={{ fontSize: 26 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12.5, color }}>{sub}</div> : null}
    </div>
  );
}
