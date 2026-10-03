// Campaigns kit — small primitives shared by the Campaigns page, builder,
// detail and the Inbox's Automations tab (RevMatch automations/kit.jsx,
// re-skinned on KeyMatch tokens). No emoji: lanes are quiet dots.
import '../../styles/campaigns.css';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { dayKeyIn, fmtTz, zonedInput } from './tz';
import { nav } from '../../lib/nav';

export const LANE_META = {
  green: { color: 'var(--kp-green)', hex: '#D4FF3F', title: "They're in", tag: 'WANTS TO SEE IT', sub: 'Interested, wants a showing or the details', short: 'Green' },
  yellow: { color: 'var(--kp-yellow)', hex: '#FFB440', title: 'They might', tag: 'MAYBE / QUESTIONS', sub: 'Curious, unsure, or asking questions', short: 'Yellow' },
  red: { color: 'var(--kp-red)', hex: '#FF6B5E', title: "They're out", tag: 'NOT INTERESTED', sub: 'Close out politely, then stop', short: 'Red' },
  gray: { color: 'var(--kp-gray)', hex: '#8A8A89', title: 'They go quiet', tag: 'NO REPLY', sub: 'Wait it out, then reach back once', short: 'No reply' },
  waiting: { color: 'var(--text)', hex: '#E6E6E6', title: 'Waiting', tag: 'NOT SENT YET', sub: 'Queued or held for a safe slot', short: 'Waiting' },
};

export const STATUS_META = {
  sending: { label: 'Sending', color: 'var(--text)', dot: true },
  listening: { label: 'Listening', color: 'var(--green)', dot: true },
  running: { label: 'Running', color: 'var(--green)', dot: true },
  scheduled: { label: 'Scheduled', color: 'var(--amber)', dot: false },
  draft: { label: 'Draft', color: null, dot: false },
  paused: { label: 'Paused', color: 'var(--amber)', dot: false },
  completed: { label: 'Done', color: null, dot: false },
  stopped: { label: 'Stopped', color: null, dot: false },
  on: { label: 'On', color: 'var(--green)', dot: true },
  off: { label: 'Off', color: null, dot: false },
};

export function LaneDot({ lane, size = 8, glow = true, style }) {
  const m = LANE_META[lane] || LANE_META.gray;
  return <span className="kp-dot" style={{ width: size, height: size, background: m.color, boxShadow: 'none', ...style }} aria-hidden="true" />;
}

export function LaneTally({ lanes, size = 7, keys = ['green', 'yellow', 'red'] }) {
  if (!lanes) return null;
  const items = keys.map((k) => [k, lanes[k] || 0]).filter(([, n]) => n > 0);
  if (!items.length) return null;
  return (
    <span className="kp-tally">
      {items.map(([k, n]) => <span key={k}><LaneDot lane={k} size={size} />{n}</span>)}
    </span>
  );
}

// Mini bar: green / yellow / red / no reply / waiting proportions.
export function LaneBar({ lanes, height = 4, style }) {
  const order = ['green', 'yellow', 'red', 'gray', 'waiting'];
  const total = order.reduce((s, k) => s + ((lanes && lanes[k]) || 0), 0);
  if (!total) return <div className="kp-lanebar" style={{ height, ...style }} />;
  return (
    <div className="kp-lanebar" style={{ height, ...style }} aria-label="Reply lanes">
      {order.map((k, i) => {
        const n = (lanes && lanes[k]) || 0;
        if (!n) return null;
        const m = LANE_META[k];
        return <i key={k} style={{ width: `${(n / total) * 100}%`, background: k === 'waiting' ? 'rgba(var(--accent-rgb), 0.35)' : m.color, animationDelay: `${i * 60}ms` }} />;
      })}
    </div>
  );
}

export function campaignPhase(c) {
  if (!c) return 'draft';
  if (c.kind === 'automation') return c.enabled ? 'on' : 'off';
  if (c.status === 'running') return c.phase === 'sending' ? 'sending' : 'listening';
  if (c.status === 'completed' && c.schedule && c.schedule.canceledAt) return 'stopped';
  return c.status;
}

export function StatusPill({ status, style }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  const color = m.color || 'var(--dim)';
  return (
    <span
      className="kp-status"
      style={{
        color,
        background: m.color ? `color-mix(in srgb, ${m.color} 9%, transparent)` : 'rgba(127,127,127,0.10)',
        border: `1px solid ${m.color ? `color-mix(in srgb, ${m.color} 28%, transparent)` : 'var(--lineHi)'}`,
        ...style,
      }}
    >
      {m.dot ? <span className="kp-dot kp-pulse" style={{ width: 5, height: 5, background: color }} /> : null}
      {m.label}
    </span>
  );
}

export function Eyebrow({ children, icon, blue = false, style, right }) {
  return (
    <div className={`kp-eyebrow ${blue ? 'kp-eyebrow--blue' : ''}`} style={style}>
      {icon ? <span className="kp-eyebrow-tile"><Icon name={icon} size={13} stroke={2} /></span> : null}
      <span style={{ flex: right ? 1 : undefined }}>{children}</span>
      {right || null}
    </div>
  );
}

export function SectionRule({ label, count, action, style, onToggle, collapsed }) {
  const inner = (
    <>
      <span className="kp-rule-label">{label}</span>
      {count != null ? <span className="kp-rule-count">{count}</span> : null}
      <span className="kp-rule-line" />
      {onToggle ? <Icon name="chevronDown" size={14} color="var(--faint)" style={{ transform: collapsed ? 'none' : 'rotate(180deg)', transition: 'transform 0.22s var(--km-ease)' }} /> : null}
    </>
  );
  return (
    <div className="kp-rule" style={style}>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>{inner}</button>
      ) : inner}
      {action || null}
    </div>
  );
}

export function MonoLabel({ children, color, style }) {
  return <div className="kp-mono" style={{ ...(color ? { color } : null), ...style }}>{children}</div>;
}

export function InfoNote({ kind = 'ai', children, style }) {
  const color = kind === 'route' ? 'var(--green)' : kind === 'warn' ? 'var(--amber)' : 'var(--bright)';
  const icon = kind === 'route' ? 'reply' : kind === 'warn' ? 'shield' : 'sparkle';
  return (
    <div className={`kp-note kp-note--${kind}`} style={style}>
      <Icon name={icon} size={15} color={color} style={{ marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// Shown in 'device' messaging mode (no business texting line): calm, not an error.
export const NEEDS_LINE_COPY = 'Campaigns need a business texting line — connect Twilio in Settings to send. You can still build and save drafts.';
export function NeedsLineBanner({ style }) {
  return (
    <div className="kp-note kp-note--calm" role="status" style={style}>
      <Icon name="phone" size={15} color="var(--dim)" style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{NEEDS_LINE_COPY}</div>
      <button type="button" onClick={() => nav.openSettings()} style={{ alignSelf: 'center', fontSize: 12.5, fontWeight: 500, color: 'var(--bright)', flexShrink: 0 }}>Settings</button>
    </div>
  );
}

export function SparkButton({ label, onClick, disabled, busy, icon = 'sparkle', style }) {
  return (
    <button type="button" className="kp-spark km-press" onClick={onClick} disabled={disabled || busy} style={style}>
      {busy ? <Spinner size={13} /> : <Icon name={icon} size={13} stroke={2.1} />}
      {label}
    </button>
  );
}

export function ComposerField({ value, onChange, placeholder, rows = 3, action, onBlur, maxLength = 2000, autoFocus, style, inputRef, ariaLabel }) {
  return (
    <div className="kp-composer" style={style}>
      <textarea
        ref={inputRef}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange && onChange(e.target.value)}
        onBlur={onBlur}
        onFocus={(e) => { const t = e.target; setTimeout(() => { try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ } }, 300); }}
      />
      {action ? <div className="kp-composer-row">{action}</div> : null}
    </div>
  );
}

export function Choice({ options, value, onChange, style }) {
  return (
    <div className="kp-choice" style={style}>
      {options.map((o) => (
        <button key={o.id} type="button" className="km-press" aria-pressed={value === o.id} disabled={o.disabled} onClick={() => onChange && onChange(o.id)}>
          {o.label}
          {o.sub ? <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--faint)', marginTop: 1 }}>{o.sub}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Glowing progress line (sent / total).
export function Progress({ value = 0, total = 0, style }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return <div className="kp-progress" style={style}><i style={{ width: `${pct}%` }} /></div>;
}

// ── time helpers (agent's zone, see tz.js) ────────────────────────────
export function fmtWhen(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const key = dayKeyIn(d);
  const time = fmtTz(d, { hour: 'numeric', minute: '2-digit' });
  if (key === dayKeyIn(now)) return opts.todayWord ? `Today ${time}` : time;
  if (key === dayKeyIn(new Date(now.getTime() + 864e5))) return `Tomorrow ${time}`;
  if (Math.abs(d - now) < 6 * 864e5) return `${fmtTz(d, { weekday: 'short' })} ${time}`;
  return `${fmtTz(d, { month: 'short', day: 'numeric' })} ${time}`;
}

export function fmtEta(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 45000) return 'any moment';
  const mins = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `~${Math.round(h / 24)}d left`;
  if (h > 0) return m ? `~${h}h ${m}m left` : `~${h}h left`;
  return `~${m}m left`;
}

export function fmtIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 45000) return 'any moment';
  if (ms < 3600000) return `in ${Math.round(ms / 60000)}m`;
  return fmtWhen(iso);
}

// datetime-local value from a Date/ISO (agent's wall time).
export function toLocalInput(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return zonedInput(x);
}
