// Month grid + month calendar sheet (RevMatch MonthCalendar, ported).
// Today is always real gold (even after the 7 PM flip selects tomorrow), the
// selected day is the accent gradient, work days carry a blue wash + hours
// ("9-6"), off days read OFF, and up to three KIND-colored dots mark the
// appointment types on that day.
import { useEffect, useMemo, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { dateKey, keyToDate, calKey } from './time';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cellsFor(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, key: calKey(year, month, d) });
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function MonthNav({ year, month, onPrev, onNext, compact }) {
  const btn = {
    width: compact ? 28 : 32, height: compact ? 28 : 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)', color: 'var(--bp-t1)',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 4px 10px' }}>
      <button type="button" className="km-press" style={btn} onClick={onPrev} aria-label="Previous month"><Icon name="chevronLeft" size={15} stroke={2.2} /></button>
      <div style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, letterSpacing: -0.3, color: 'var(--bp-t1)' }}>
        {MONTHS[month]} <span style={{ color: 'var(--bp-t3)' }}>{year}</span>
      </div>
      <button type="button" className="km-press" style={btn} onClick={onNext} aria-label="Next month"><Icon name="chevronRight" size={15} stroke={2.2} /></button>
    </div>
  );
}

export function MonthGrid({ year, month, selectedKey, onSelect, dots, marks, todayKey = dateKey() }) {
  const cells = useMemo(() => cellsFor(year, month), [year, month]);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DOW.map((d, i) => (
          <div key={i} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, color: 'var(--bp-t3)', textAlign: 'center', padding: '4px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} />;
          const isToday = c.key === todayKey;
          const isSel = c.key === selectedKey;
          const mark = marks ? marks(c.key) : null;
          const isWork = !!(mark && !mark.off && mark.hours);
          const isOff = !!(mark && mark.off);
          const colors = (dots && dots.get(c.key)) || [];
          const ink = isToday ? 'var(--bp-now-ink)' : isSel ? '#fff' : 'var(--bp-t1)';
          return (
            <button
              key={c.key}
              type="button"
              className="cal-cell"
              onClick={() => onSelect?.(c.key)}
              aria-label={keyToDate(c.key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              aria-pressed={isSel}
              style={{
                background: isToday
                  ? 'linear-gradient(135deg, var(--bp-now), var(--bp-now-deep))'
                  : isSel ? 'linear-gradient(135deg, var(--blue), var(--deep))'
                    : isWork ? 'color-mix(in srgb, var(--blue) 14%, transparent)'
                      : isOff ? 'var(--bp-fill)' : 'transparent',
                border: isToday || isSel ? '1px solid transparent' : isWork ? '1px solid color-mix(in srgb, var(--blue) 32%, transparent)' : '1px solid transparent',
                boxShadow: isToday ? '0 0 10px rgba(212,169,74,0.35)' : isSel ? '0 6px 14px -6px var(--glow)' : 'none',
                color: ink,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: isSel || isToday ? 700 : 500, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{c.day}</span>
              {isToday && !mark ? <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1 }}>TODAY</span> : null}
              {isOff ? <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1, color: isToday || isSel ? ink : 'var(--bp-t3)' }}>OFF</span> : null}
              {isWork ? <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', color: isToday || isSel ? ink : 'var(--blue)' }}>{mark.hours}</span> : null}
              {colors.length ? (
                <span style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 2 }}>
                  {colors.slice(0, 3).map((col, k) => (
                    <span key={k} style={{ width: 4.5, height: 4.5, borderRadius: 3, background: isToday ? 'var(--bp-now-ink)' : isSel ? '#fff' : col, boxShadow: isToday || isSel ? 'none' : `0 0 5px ${col}` }} />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The rail's "pick a day" sheet.
export default function MonthCalendarSheet({ open, onClose, selectedKey, onSelect, dots, marks }) {
  const sel = keyToDate(selectedKey || dateKey());
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() });
  useEffect(() => {
    if (open) { const d = keyToDate(selectedKey || dateKey()); setView({ y: d.getFullYear(), m: d.getMonth() }); }
  }, [open, selectedKey]);
  const today = dateKey();
  const label = (selectedKey || today) === today
    ? 'TODAY'
    : `${sel.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} · ${sel.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${sel.getDate()}`;
  const step = (n) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <Sheet open={open} onClose={onClose} title="Pick a day" left={false} right={{ label: 'Today', onClick: () => onSelect?.(today) }} maxWidth={460}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 4px' }}>
        <Icon name="calendar" size={12} color="var(--blue)" stroke={2} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.6, color: 'var(--blue)' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 9, fontWeight: 600, letterSpacing: 1, color: 'var(--bp-t3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'color-mix(in srgb, var(--blue) 30%, transparent)' }} />WORKING</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'linear-gradient(135deg, var(--bp-now), var(--bp-now-deep))' }} />TODAY</span>
        </span>
      </div>
      <div style={{ animation: 'fadeUp 200ms ease-out both' }}>
        <MonthNav year={view.y} month={view.m} onPrev={() => step(-1)} onNext={() => step(1)} />
        <MonthGrid year={view.y} month={view.m} selectedKey={selectedKey || today} onSelect={onSelect} dots={dots} marks={marks} todayKey={today} />
      </div>
    </Sheet>
  );
}
