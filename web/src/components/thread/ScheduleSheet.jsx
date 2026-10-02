// Send Later — presets (later today, tomorrow 9 AM, Monday 9 AM) or a custom
// date/time. Used both to schedule the composer's text and to re-time an
// already-scheduled message.
import { useEffect, useMemo, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { formatTime } from '../../lib/format';

function at(base, days, h, m = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
}

export function schedulePresets(now = new Date()) {
  const out = [];
  // Later today: 6 PM if it's before 5, otherwise in ~3 hours (rounded to :00/:30).
  if (now.getHours() < 17) out.push({ id: 'today', label: 'Later Today', when: at(now, 0, 18) });
  else if (now.getHours() < 21) {
    const d = new Date(now.getTime() + 3 * 3600e3);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    out.push({ id: 'today', label: 'Later Today', when: d });
  }
  out.push({ id: 'tomorrow', label: 'Tomorrow Morning', when: at(now, 1, 9) });
  const dow = now.getDay(); // 0 Sun
  const toMon = ((8 - dow) % 7) || 7;
  if (toMon > 1) out.push({ id: 'monday', label: 'Monday Morning', when: at(now, toMon, 9) });
  return out;
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayLabel(d) {
  const now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (same(d, now)) return 'Today';
  if (same(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function ScheduleSheet({ open, onClose, onConfirm, preview, channel = 'imsg', initial, mode = 'create' }) {
  const presets = useMemo(() => schedulePresets(new Date()), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    if (initial) { setPick('custom'); setCustom(toLocalInput(new Date(initial))); }
    else { setPick(presets[0] ? presets[0].id : 'custom'); setCustom(toLocalInput(new Date(Date.now() + 3600e3))); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const when = pick === 'custom' ? (custom ? new Date(custom) : null) : (presets.find((p) => p.id === pick) || {}).when;
  const valid = when && !Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 60_000;

  const confirm = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try { await onConfirm(when); } finally { setBusy(false); }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Send Time' : 'Send Later'}
      right={{ label: busy ? 'Saving…' : mode === 'edit' ? 'Save' : 'Schedule', onClick: confirm, disabled: !valid || busy }}
    >
      {preview ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0 14px' }}>
          <div className={`km-bubble ${channel === 'sms' ? 'km-bubble--sms' : 'km-bubble--imsg'}`} style={{ maxWidth: '82%', fontSize: 15, lineHeight: '20px' }}>
            {preview}
          </div>
        </div>
      ) : null}
      <div className="km-list" style={{ padding: 0 }}>
        {presets.map((p) => (
          <button key={p.id} type="button" className="km-row km-press" onClick={() => setPick(p.id)} style={{ width: '100%', padding: '13px 14px', textAlign: 'left' }}>
            <Icon name={p.id === 'today' ? 'sunrise' : p.id === 'tomorrow' ? 'sun' : 'calendar'} size={18} color="var(--bright)" />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 500 }}>{p.label}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 1 }}>{dayLabel(p.when)} at {formatTime(p.when)}</span>
            </span>
            {pick === p.id ? <Icon name="check" size={18} color="var(--bright)" stroke={2.4} /> : null}
          </button>
        ))}
        <button type="button" className="km-row km-press" onClick={() => setPick('custom')} style={{ width: '100%', padding: '13px 14px', textAlign: 'left', borderBottom: 0 }}>
          <Icon name="clock" size={18} color="var(--bright)" />
          <span style={{ flex: 1, fontSize: 15.5, fontWeight: 500 }}>Custom…</span>
          {pick === 'custom' ? <Icon name="check" size={18} color="var(--bright)" stroke={2.4} /> : null}
        </button>
      </div>
      {pick === 'custom' ? (
        <input
          type="datetime-local"
          className="km-input"
          value={custom}
          min={toLocalInput(new Date(Date.now() + 2 * 60_000))}
          onChange={(e) => setCustom(e.target.value)}
          style={{ marginTop: 12, colorScheme: 'dark' }}
        />
      ) : null}
      <div style={{ fontSize: 12.5, color: valid ? 'var(--dim)' : 'var(--red)', marginTop: 12, textAlign: 'center' }}>
        {valid ? `Will be sent ${dayLabel(when)} at ${formatTime(when)}` : 'Pick a time at least a minute from now'}
      </div>
    </Sheet>
  );
}
