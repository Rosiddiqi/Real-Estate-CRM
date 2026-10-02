// Calendar — month grid (today in gold, KIND dots per appointment type, work
// hours / OFF marks) over the selected day's agenda. Overlay contract:
// { date?: 'YYYY-MM-DD', onClose }.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel from '../../components/ui/PushPanel';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import Avatar from '../../components/ui/Avatar';
import { EmptyState, Button } from '../../components/ui/kit';
import { nav } from '../../lib/nav';
import { useResync, useSocket } from '../../hooks/useSocket';
import { getAppointments, getWorkSchedule } from '../../api/appointments';
import { MonthGrid, MonthNav } from '../../components/battleplan/MonthCalendar';
import { apptType, apptColor, alpha, STATUS_LABEL } from '../../components/calendar/appointmentTypes';
import { dateKey, keyToDate, fmtMin, durLabel, resolveWindow, compactHours, minuteOfDay, zonedDate } from '../../components/battleplan/time';
import useAgentTz from '../../components/battleplan/useAgentTz';
import '../../styles/dashboard.css';

const mins = (d) => minuteOfDay(new Date(d));

export default function CalendarPage({ date, onClose }) {
  useAgentTz();
  const today = dateKey();
  const [selected, setSelected] = useState(/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : today);
  const sel = keyToDate(selected);
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() });
  const [appts, setAppts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [schedule, setSchedule] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const from = new Date(view.y, view.m, 1 - 7);
    const to = new Date(view.y, view.m + 1, 8);
    try {
      const r = await getAppointments({ from: from.toISOString(), to: to.toISOString(), limit: 1000 });
      setAppts(r.appointments || []);
      setStatus('ready');
    } catch { setStatus((s) => (s === 'ready' ? 'ready' : 'error')); }
  }, [view.y, view.m]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getWorkSchedule().then((r) => setSchedule(r.schedule)).catch(() => {}); }, []);
  useSocket(['appointment_updated'], () => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); });
  useResync(load);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const a of appts) {
      const k = dateKey(new Date(a.startAt));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return m;
  }, [appts]);
  const dots = useMemo(() => {
    const m = new Map();
    for (const [k, list] of byDay) {
      const cols = [];
      for (const a of list) { if (a.status === 'cancelled') continue; const c = apptColor(a.type); if (!cols.includes(c)) cols.push(c); }
      if (cols.length) m.set(k, cols);
    }
    return m;
  }, [byDay]);
  const marks = useCallback((key) => {
    const w = resolveWindow(schedule, key);
    if (!w) return null;
    return w.off ? { off: true } : { off: false, hours: compactHours(w) };
  }, [schedule]);

  const dayList = (byDay.get(selected) || []).slice().sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const step = (n) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const pick = (k) => {
    setSelected(k);
    const d = keyToDate(k);
    if (d.getMonth() !== view.m || d.getFullYear() !== view.y) setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const goToday = () => pick(today);
  const add = () => {
    const startMin = selected === today ? Math.min(23 * 60 + 30, Math.ceil((minuteOfDay(new Date()) + 1) / 30) * 30) : 600;
    nav.newAppointment({ startAt: zonedDate(selected, startMin).toISOString() });
  };
  const win = resolveWindow(schedule, selected);
  const dayTitle = selected === today ? 'Today' : sel.toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <PushPanel
      onClose={onClose}
      title="Calendar"
      right={<GlassButton icon="plus" accent label="New appointment" onClick={add} />}
    >
      <div style={{ padding: '6px 12px 0' }}>
        <div className="st-plain" style={{ padding: '6px 8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1 }}><MonthNav year={view.y} month={view.m} onPrev={() => step(-1)} onNext={() => step(1)} /></div>
          </div>
          <MonthGrid year={view.y} month={view.m} selectedKey={selected} onSelect={pick} dots={dots} marks={marks} todayKey={today} />
        </div>
      </div>

      <div style={{ padding: '18px 20px 8px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--blue)' }}>
            {sel.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: -0.7, marginTop: 3 }}>{dayTitle}</div>
          <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>
            {win ? (win.off ? 'Off day' : `Working ${fmtMin(win.start)} – ${fmtMin(win.end)}`) : 'No hours set'}
            {dayList.length ? ` · ${dayList.filter((a) => a.status !== 'cancelled').length} appointment${dayList.length === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        {selected !== today ? <button type="button" className="km-pill" onClick={goToday}>Today</button> : null}
      </div>

      <div style={{ padding: '0 16px' }}>
        {status === 'loading' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} className="km-skel" style={{ height: 64, borderRadius: 14 }} />)}</div>
        ) : null}
        {status === 'error' && !appts.length ? (
          <EmptyState icon="calendar" title="Couldn’t load your calendar" sub="Check your connection and try again." action={<Button size="sm" onClick={load}>Try again</Button>} />
        ) : null}
        {status === 'ready' && !dayList.length ? (
          <EmptyState icon="calendar" title="Nothing booked" sub={selected < today ? 'No appointments on this day.' : 'A clear day. Book a showing or block time for content.'} action={selected >= today ? <Button size="sm" icon="plus" onClick={add}>New appointment</Button> : null} />
        ) : null}
        {dayList.map((a, i) => {
          const t = apptType(a.type);
          const c = apptColor(a.type);
          const cancelled = a.status === 'cancelled';
          return (
            <button
              key={a.id}
              type="button"
              className="bp-tile km-press km-row-in"
              onClick={() => nav.openAppointment(a.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px 11px 16px', marginBottom: 8, textAlign: 'left', opacity: cancelled ? 0.5 : 1, animationDelay: `${Math.min(i, 12) * 30}ms` }}
            >
              <div className="bp-spine" style={{ background: c, boxShadow: `0 0 8px ${alpha(c, 50)}` }} />
              <div className="bp-wash" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${c}, transparent 70%)` }} />
              <div style={{ width: 58, flexShrink: 0 }}>
                <div className="bp-num" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', textDecoration: cancelled ? 'line-through' : 'none' }}>
                  {a.allDay ? 'All day' : (() => { const [hm, ap] = fmtMin(mins(a.startAt)).split(' '); return <>{hm}<span style={{ fontSize: 10, fontWeight: 700, marginLeft: 2, color: 'var(--dim)' }}>{ap}</span></>; })()}
                </div>
                <div className="bp-num" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{durLabel(a.durationMin)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={t.icon} size={13} color={c} stroke={2.2} />
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: c, textTransform: 'uppercase' }}>{t.label}</span>
                  {a.status !== 'scheduled' ? <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: 'var(--faint)', textTransform: 'uppercase' }}>· {STATUS_LABEL[a.status]}</span> : null}
                </div>
                <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 600, marginTop: 3 }}>{a.title}</div>
                {a.location ? <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>{a.location}</div> : null}
              </div>
              {a.client ? <Avatar name={a.client.name} seed={a.client.id} src={a.client.avatarUrl} size={32} /> : <Icon name="chevronRight" size={15} color="var(--faint)" />}
            </button>
          );
        })}
      </div>
    </PushPanel>
  );
}
