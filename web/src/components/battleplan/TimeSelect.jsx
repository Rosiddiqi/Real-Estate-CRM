// Compact time picker — a native <select> on a 15-minute grid with readable
// labels ("9 AM", "6:30 PM"). Narrow rows (weekly hours, routine blocks) can't
// fit a native time input without truncating it to "09"; this always reads
// right, and on iOS it opens the wheel picker. Value is "HH:MM" (24h).
import { useMemo } from 'react';
import Icon from '../ui/Icon';
import { fmtMin, hhmmToMin, minToHHMM } from './time';

export default function TimeSelect({ value, onChange, from = 5 * 60, to = 23 * 60 + 45, step = 15, label, style, compact }) {
  const options = useMemo(() => {
    const out = [];
    for (let m = from; m <= to; m += step) out.push(m);
    const cur = hhmmToMin(value);
    if (cur != null && !out.includes(cur)) { out.push(cur); out.sort((a, b) => a - b); }
    return out;
  }, [from, to, step, value]);
  const cur = hhmmToMin(value);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', minWidth: 0, ...style }}>
      <select
        className="km-input"
        value={cur != null ? minToHHMM(cur) : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label={label}
        style={{
          width: '100%', minWidth: 0, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
          minHeight: compact ? 34 : 40, padding: compact ? '5px 20px 5px 9px' : '8px 28px 8px 12px',
          fontSize: compact ? 13.5 : 15, fontVariantNumeric: 'tabular-nums',
        }}
      >
        {cur == null ? <option value="" disabled>—</option> : null}
        {options.map((m) => <option key={m} value={minToHHMM(m)}>{fmtMin(m)}</option>)}
      </select>
      <Icon name="chevronDown" size={12} stroke={2.4} color="var(--faint)" style={{ position: 'absolute', right: compact ? 7 : 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </span>
  );
}
