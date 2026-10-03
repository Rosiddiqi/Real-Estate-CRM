// Small pipeline-only primitives (shared UI kit stays untouched).
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { moneyCompact } from '../../lib/format';
import { tone, tint } from '../../lib/palette';

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' in the viewer's zone for <input type=date>.
export function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayInput = () => toDateInput(new Date().toISOString());
export function shortDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', opts);
}
// Day-granular "when" for closing dates (date-only values live at local noon).
export function dayAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const n = new Date();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.round((b - a) / 864e5);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days === -1) return 'tomorrow';
  if (days > 1 && days < 7) return `${days}d ago`;
  if (days >= 7 && days < 60) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}
export const money0 = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const mc = (n) => (n == null ? '—' : moneyCompact(n));
export const pctOf = (r, d = 2) => (r == null ? '' : `${Number((r * 100).toFixed(d))}`);
export const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';

export function StageDot({ color, size = 7, glow = false }) {
  return (
    <span
      className="km-pl-dot"
      style={{ width: size, height: size, background: tone(color), boxShadow: glow ? `0 0 0 3px ${tint(color, 22)}` : undefined }}
    />
  );
}

export function GripDots() {
  return <span className="km-pl-gripdots" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} />)}</span>;
}

export function MiniStars({ value = 0, size = 8 }) {
  return (
    <span className="km-pl-stars" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={size} stroke={2} color={n <= value ? 'var(--pl-gold)' : 'var(--faint)'} style={{ fill: n <= value ? 'var(--pl-gold)' : 'none' }} />
      ))}
    </span>
  );
}

export function Eyebrow({ children, trailing, style }) {
  return (
    <div className="km-pl-secthead" style={style}>
      <span className="km-pl-eyebrow">{children}</span>
      {trailing || null}
    </div>
  );
}

// Parse "$4,250,000", "4.25m", "850k" → whole dollars.
export function parseAmount(s) {
  if (s == null) return null;
  const t = String(s).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!t) return null;
  const m = /^(\d*\.?\d+)([km])?$/.exec(t);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1));
}
const commas = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-US'));

// $ amount box — RevMatch's SignedAmountInput geometry, real-estate sized.
export function AmountInput({ value, onChange, placeholder = '0', width, ariaLabel, prefix = '$', suffix }) {
  const [text, setText] = useState(commas(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(commas(value)); }, [value]);
  return (
    <div className="km-pl-amt" onClick={(e) => e.stopPropagation()}>
      {prefix ? <span>{prefix}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        placeholder={placeholder}
        style={width ? { width } : undefined}
        onFocus={(e) => { focused.current = true; setText(value != null ? String(value) : ''); setTimeout(() => { try { e.target.select(); } catch { /* noop */ } }, 0); }}
        onBlur={() => { focused.current = false; setText(commas(value)); }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.,kKmM$]/g, '');
          setText(t);
          const v = parseAmount(t);
          if (t === '') onChange(null);
          else if (v != null) onChange(v);
        }}
      />
      {suffix ? <span className="km-pl-amt-suffix">{suffix}</span> : null}
    </div>
  );
}

// Percent box: shows 2.5 for 0.025, emits fractions.
export function RateInput({ value, onChange, ariaLabel, placeholder = '—' }) {
  const [text, setText] = useState(value != null ? pctOf(value, 3) : '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value != null ? pctOf(value, 3) : ''); }, [value]);
  return (
    <div className="km-pl-amt km-pl-amt--sm" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value != null ? pctOf(value, 3) : ''); }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, '');
          setText(t);
          if (t === '') return onChange(null);
          const n = parseFloat(t);
          if (Number.isFinite(n) && n <= 100) onChange(Math.round((n / 100) * 100000) / 100000);
        }}
      />
      <span className="km-pl-amt-suffix">%</span>
    </div>
  );
}

export function DateInput({ value, onChange, ariaLabel, min, max }) {
  return (
    <div className="km-pl-amt km-pl-amt--date" onClick={(e) => e.stopPropagation()}>
      <input
        type="date"
        aria-label={ariaLabel}
        value={toDateInput(value)}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}

// Compact date pill ("Sep 26") with the native picker underneath — fits in
// dense rows (contingency deadlines) where a full date field doesn't.
export function CompactDate({ value, onChange, ariaLabel, placeholder = 'Set date', tone }) {
  const ref = useRef(null);
  const label = value ? shortDate(value) : placeholder;
  const late = tone === 'late';
  return (
    <span
      className="km-pl-cdate"
      style={{ color: value ? (late ? 'var(--red)' : 'var(--text)') : 'var(--faint)' }}
      onClick={(e) => { e.stopPropagation(); try { ref.current && ref.current.showPicker && ref.current.showPicker(); } catch { /* not supported */ } }}
    >
      <Icon name="calendar" size={12} />
      {label}
      <input ref={ref} type="date" aria-label={ariaLabel} value={toDateInput(value)} onChange={(e) => onChange(e.target.value || null)} />
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <div className="km-pl-field">
      <span className="km-pl-field-l">{label}</span>
      {children}
    </div>
  );
}

export function Check({ on }) {
  return <span className="km-pl-check">{on ? <Icon name="check" size={12} stroke={2.6} color="var(--on-hl)" /> : null}</span>;
}

export function compactPrice(n) { return n ? moneyCompact(n) : null; }
