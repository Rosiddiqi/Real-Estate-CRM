// AppointmentSheet — appointment detail: type + status, when / where with
// directions, the client and listing, quick actions (call · text · open
// listing · directions), status (confirm · complete · no-show · cancel), the
// AI pre-appointment relationship briefing (deterministic fallback), showing
// feedback capture, and an edit mode. Overlay contract: { id, onClose }.
import { useCallback, useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Spinner, Stars } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { useSocket } from '../../hooks/useSocket';
import { moneyCompact, relativeTime } from '../../lib/format';
import {
  getAppointment, updateAppointment, deleteAppointment, getAppointmentBriefing, logAppointmentOutcome,
} from '../../api/appointments';
import { apptType, apptColor, alpha, STATUS_LABEL, OUTCOMES, SHOWING_TYPES } from './appointmentTypes';
import { TypeGrid, ListingSearch } from './AddAppointmentSheet';
import { dateKey, fmtMin, durLabel, minuteOfDay, minToHHMM, zonedDate, dayLabelIn } from '../battleplan/time';
import useAgentTz from '../battleplan/useAgentTz';
import '../../styles/dashboard.css';

const STATUS_TONE = { scheduled: 'var(--blue)', confirmed: 'var(--green)', completed: 'var(--green)', no_show: 'var(--amber)', cancelled: 'var(--red)' };
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
// Times render in the agent's zone (same clock as the rail).
const toTime = (d) => minToHHMM(minuteOfDay(d));
const mins = (d) => minuteOfDay(d);

function whenLabel(a) {
  const s = new Date(a.startAt); const e = new Date(a.endAt);
  const day = dayLabelIn(s);
  return a.allDay ? `${day} · All day` : `${day} · ${fmtMin(mins(s))} – ${fmtMin(mins(e))}`;
}
function directionsUrl(loc) {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(loc)}`;
}

function QuickAction({ icon, label, color, onClick, href }) {
  const inner = (
    <>
      <span style={{ width: 44, height: 44, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: alpha(color, 14), color }}>
        <Icon name={icon} size={19} stroke={2} />
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--dim)' }}>{label}</span>
    </>
  );
  const style = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 };
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="km-press" style={style}>{inner}</a>;
  return <button type="button" className="km-press" onClick={onClick} style={style}>{inner}</button>;
}

function Briefing({ appt }) {
  const [state, setState] = useState({ loading: true, briefing: null, error: false });
  const load = useCallback((refresh) => {
    setState((s) => ({ ...s, loading: true, error: false }));
    getAppointmentBriefing(appt.id, refresh)
      .then((r) => setState({ loading: false, briefing: r.briefing, error: false }))
      .catch(() => setState({ loading: false, briefing: null, error: true }));
  }, [appt.id]);
  useEffect(() => { load(false); }, [load]);
  const b = state.briefing;
  return (
    <div className="km-ai-card" style={{ marginTop: 16, background: alpha('var(--violet)', 7), borderColor: alpha('var(--violet)', 22), borderLeftColor: 'var(--violet)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon name="sparkle" size={13} color="var(--violet)" stroke={2.2} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.3, color: 'var(--violet)' }}>PRE-APPOINTMENT BRIEFING</span>
        <span style={{ flex: 1 }} />
        {b ? <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: 'var(--faint)' }}>{b.source === 'ai' ? 'AI' : 'QUICK BRIEF'}</span> : null}
        <button type="button" onClick={() => load(true)} disabled={state.loading} aria-label="Refresh briefing" className="km-icon-btn km-icon-btn--sm" style={{ width: 26, height: 26, color: 'var(--dim)' }}>
          {state.loading ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
        </button>
      </div>
      {state.loading && !b ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className="km-skel" style={{ height: 14, width: '80%' }} />
          <div className="km-skel" style={{ height: 11, width: '95%' }} />
          <div className="km-skel" style={{ height: 11, width: '70%' }} />
        </div>
      ) : null}
      {state.error && !b ? <div style={{ fontSize: 13, color: 'var(--dim)' }}>Couldn’t prepare a briefing right now.</div> : null}
      {b ? (
        <div className="km-selectable">
          <div style={{ fontSize: 14.5, fontWeight: 650, lineHeight: 1.35, marginBottom: 8 }}>{b.headline}</div>
          {(b.bullets || []).map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--text)', marginTop: 4 }}>
              <span style={{ width: 4, height: 4, borderRadius: 2, background: 'var(--violet)', marginTop: 8, flexShrink: 0 }} />
              <span>{t}</span>
            </div>
          ))}
          {(b.talkingPoints || []).length ? (
            <>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, color: 'var(--faint)', margin: '12px 0 2px' }}>SAY / SHOW</div>
              {b.talkingPoints.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                  <Icon name="arrowRight" size={12} color="var(--blue)" stroke={2.4} style={{ marginTop: 4 }} />
                  <span>{t}</span>
                </div>
              ))}
            </>
          ) : null}
          {(b.watchOuts || []).length ? (
            <>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1.2, color: 'var(--amber)', margin: '12px 0 2px' }}>WATCH FOR</div>
              {b.watchOuts.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
                  <Icon name="alert" size={12} color="var(--amber)" stroke={2.2} style={{ marginTop: 3 }} />
                  <span>{t}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OutcomeCapture({ appt, onSaved }) {
  const [outcome, setOutcome] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!appt.outcome);
  const save = async () => {
    if (busy || (!outcome && !text.trim())) return;
    setBusy(true);
    try {
      const { appointment } = await logAppointmentOutcome(appt.id, { outcome: outcome || undefined, feedback: text.trim() || undefined });
      haptic('success');
      toast.success('Feedback logged to their timeline.');
      setEditing(false);
      onSaved?.(appointment);
    } catch (err) {
      toast.error(err.message || 'Couldn’t log that.');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 16, background: 'var(--surfaceHi)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="messageSquare" size={14} color="var(--kind-showing)" stroke={2} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.3, color: 'var(--dim)' }}>SHOWING FEEDBACK</span>
        <span style={{ flex: 1 }} />
        {!editing ? <button type="button" className="km-btn km-btn--plain km-btn--sm" onClick={() => setEditing(true)}>Update</button> : null}
      </div>
      {!editing ? (
        <div className="km-selectable" style={{ fontSize: 14, marginTop: 8, lineHeight: 1.45 }}>{appt.outcome}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
            {OUTCOMES.map((o) => (
              <button key={o.id} type="button" className={`km-pill ${outcome === o.id ? 'km-pill--on' : ''}`} onClick={() => setOutcome(outcome === o.id ? null : o.id)} style={{ height: 34 }}>{o.label}</button>
            ))}
          </div>
          <textarea className="km-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did they say? Rooms they loved, objections, next step…" style={{ marginTop: 10, minHeight: 64 }} />
          <button type="button" className="km-btn km-btn--sm" style={{ marginTop: 10, width: '100%' }} disabled={busy || (!outcome && !text.trim())} onClick={save}>{busy ? 'Saving…' : 'Log feedback'}</button>
        </>
      )}
    </div>
  );
}

function EditForm({ appt, onCancel, onSaved }) {
  const s0 = new Date(appt.startAt);
  const [type, setType] = useState(appt.type);
  const [title, setTitle] = useState(appt.title || '');
  const [date, setDate] = useState(dateKey(s0));
  const [time, setTime] = useState(toTime(s0));
  const [dur, setDur] = useState(appt.durationMin || 60);
  const [location, setLocation] = useState(appt.location || '');
  const [notes, setNotes] = useState(appt.notes || '');
  const [listing, setListing] = useState(appt.listing || null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const [h, m] = time.split(':').map(Number);
      const d = zonedDate(date, (h || 0) * 60 + (m || 0));
      if (Number.isNaN(d.getTime())) throw new Error('Pick a date and time.');
      const { appointment } = await updateAppointment(appt.id, {
        type, title: title.trim() || appt.title, startAt: d.toISOString(), durationMin: dur, location: location.trim() || null, notes: notes.trim() || null, listingId: listing ? listing.id : null,
      });
      haptic('success');
      toast.success('Appointment updated');
      onSaved(appointment);
    } catch (err) {
      toast.error(err.message || 'Couldn’t save changes.');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
      <TypeGrid value={type} onChange={setType} />
      <label className="km-field"><span className="km-field-label">Title</span><input className="km-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
      <div className="km-field-row">
        <label className="km-field" style={{ flex: 1, minWidth: 0 }}><span className="km-field-label">Date</span><input type="date" className="km-input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: '100%', minWidth: 0 }} /></label>
        <label className="km-field" style={{ flex: 1, minWidth: 0 }}><span className="km-field-label">Start</span><input type="time" className="km-input" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} style={{ width: '100%', minWidth: 0 }} /></label>
      </div>
      <div className="km-field">
        <span className="km-field-label">Duration</span>
        <div className="km-scroll-x" style={{ display: 'flex', gap: 8 }}>
          {DURATIONS.map((d) => <button key={d} type="button" className={`km-pill ${dur === d ? 'km-pill--on' : ''}`} onClick={() => setDur(d)}>{durLabel(d)}</button>)}
        </div>
      </div>
      <div className="km-field"><span className="km-field-label">Listing</span><ListingSearch value={listing} onPick={setListing} onClear={() => setListing(null)} /></div>
      <label className="km-field"><span className="km-field-label">Location</span><input className="km-input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="km-field"><span className="km-field-label">Notes</span><textarea className="km-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="km-btn km-btn--ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
        <button type="button" className="km-btn" style={{ flex: 1.4 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

export default function AppointmentSheet({ id, onClose }) {
  useAgentTz();
  const [appt, setAppt] = useState(null);
  const [status, setStatus] = useState('loading');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    getAppointment(id)
      .then((r) => { setAppt(r.appointment); setStatus('ready'); })
      .catch((err) => setStatus(err && err.status === 404 ? 'missing' : 'error'));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('appointment_updated', (p) => {
    if (!p) return;
    if (p.action === 'deleted' && p.id === id) { setStatus('missing'); return; }
    if (p.appointment && p.appointment.id === id && !editing) setAppt((a) => ({ ...a, ...p.appointment }));
  });

  const setStatusTo = async (next, close) => {
    if (next === 'cancelled') {
      const ok = await confirm({ title: 'Cancel this appointment?', message: 'It stays on their timeline as cancelled.', confirmLabel: 'Cancel appointment', destructive: true });
      if (!ok) return;
    }
    const before = appt;
    setBusy(next);
    setAppt((a) => ({ ...a, status: next }));
    try {
      const { appointment } = await updateAppointment(appt.id, { status: next });
      setAppt(appointment);
      haptic(next === 'completed' ? 'success' : 'light');
      toast.success({ confirmed: 'Confirmed', completed: 'Marked complete', no_show: 'Marked no-show', cancelled: 'Appointment cancelled', scheduled: 'Reopened' }[next]);
      if (next === 'cancelled') close();
    } catch (err) {
      setAppt(before);
      toast.error(err.message || 'Couldn’t update that.');
    } finally { setBusy(null); }
  };

  const remove = async (close) => {
    const ok = await confirm({ title: 'Delete this appointment?', message: 'This removes it from your calendar for good.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteAppointment(appt.id);
      toast('Appointment deleted');
      close();
    } catch (err) { toast.error(err.message || 'Couldn’t delete it.'); }
  };

  const meta = appt ? apptType(appt.type) : null;
  const c = appt ? apptColor(appt.type) : 'var(--blue)';
  const past = appt && new Date(appt.endAt).getTime() < Date.now();
  const started = appt && new Date(appt.startAt).getTime() < Date.now();
  const showFeedback = appt && appt.clientId && SHOWING_TYPES.has(appt.type) && (started || appt.status === 'completed') && appt.status !== 'cancelled';

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Edit appointment' : meta ? meta.label : 'Appointment'}
      subtitle={!editing && appt ? whenLabel(appt) : undefined}
      left={editing ? { label: 'Cancel', onClick: () => setEditing(false) } : false}
      right={!editing && appt && status === 'ready' ? { label: 'Edit', onClick: () => setEditing(true) } : undefined}
      maxHeight="90%"
    >
      {({ close }) => {
        if (status === 'loading') return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={22} /></div>;
        if (status === 'missing') return <div className="km-empty"><div className="km-empty-title">This appointment is gone</div><div className="km-empty-sub">It may have been deleted on another device.</div></div>;
        if (status === 'error' || !appt) return <div className="km-empty"><div className="km-empty-title">Couldn’t load it</div><button type="button" className="km-btn km-btn--sm" onClick={load}>Try again</button></div>;
        if (editing) return <EditForm appt={appt} onCancel={() => setEditing(false)} onSaved={(a) => { setAppt(a); setEditing(false); }} />;
        return (
          <div style={{ paddingTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: c, padding: '3px 8px', borderRadius: 6, background: alpha(c, 13) }}>
                <Icon name={meta.icon} size={12} stroke={2.2} /> {meta.label}
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: STATUS_TONE[appt.status], padding: '3px 8px', borderRadius: 6, border: `1px solid ${alpha(STATUS_TONE[appt.status], 35)}` }}>
                {STATUS_LABEL[appt.status] || appt.status}
              </span>
              {appt.source && appt.source !== 'user' ? <span style={{ fontSize: 10, color: 'var(--faint)' }}>via {appt.source}</span> : null}
            </div>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: -0.4, marginTop: 10, lineHeight: 1.2 }} className="km-selectable">{appt.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14, color: 'var(--dim)' }}>
              <Icon name="clock" size={15} /> <span>{whenLabel(appt)} · {durLabel(appt.durationMin)}</span>
            </div>
            {appt.location ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 14, color: 'var(--dim)' }}>
                <Icon name="mapPin" size={15} /> <span className="km-truncate km-selectable" style={{ flex: 1 }}>{appt.location}</span>
              </div>
            ) : null}

            {appt.client ? (
              <button type="button" className="bp-tile km-press" onClick={() => { close(); setTimeout(() => nav.openClient(appt.client.id), 260); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', marginTop: 16, borderRadius: 16, textAlign: 'left' }}>
                <Avatar name={appt.client.name} seed={appt.client.id} src={appt.client.avatarUrl} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="km-truncate" style={{ fontSize: 16, fontWeight: 600 }}>{appt.client.name}</span>
                    {appt.client.isWhale ? <Icon name="crown" size={13} color="var(--amber)" /> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {appt.client.rating ? <Stars value={appt.client.rating} size={10} gap={1} /> : null}
                    <span className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)' }}>{[appt.client.type, appt.client.status].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
                <Icon name="chevronRight" size={15} color="var(--faint)" />
              </button>
            ) : null}

            <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
              {appt.client && appt.client.phone ? <QuickAction icon="phone" label="Call" color="var(--green)" onClick={() => { close(); setTimeout(() => nav.call({ clientId: appt.client.id, phone: appt.client.phone, name: appt.client.name }), 260); }} /> : null}
              {appt.client ? <QuickAction icon="message" label="Text" color="var(--imsg)" onClick={() => { close(); setTimeout(() => nav.openThread({ clientId: appt.client.id }), 260); }} /> : null}
              {appt.listing ? <QuickAction icon="house" label="Listing" color="var(--kind-showing)" onClick={() => { close(); setTimeout(() => nav.openListing(appt.listing.id), 260); }} /> : null}
              {appt.location ? <QuickAction icon="compass" label="Directions" color="var(--amber)" href={directionsUrl(appt.location)} /> : null}
              <QuickAction icon="trash" label="Delete" color="var(--red)" onClick={() => remove(close)} />
            </div>

            {appt.listing ? (
              <button type="button" className="km-press" onClick={() => { close(); setTimeout(() => nav.openListing(appt.listing.id), 260); }} style={{ display: 'block', width: '100%', marginTop: 16, borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)', textAlign: 'left', background: 'var(--surfaceHi)' }}>
                <PropertyPhoto src={appt.listing.photo} seed={appt.listing.id} height={140} label={appt.listing.short} />
                <div style={{ padding: '10px 12px' }}>
                  <div className="km-truncate" style={{ fontSize: 15, fontWeight: 600 }}>{appt.listing.short || appt.listing.title}</div>
                  <div className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>
                    {[appt.listing.listPrice ? moneyCompact(appt.listing.listPrice) : null, appt.listing.beds ? `${appt.listing.beds} bd` : null, appt.listing.bathsTotal ? `${appt.listing.bathsTotal} ba` : null, appt.listing.livingAreaSqft ? `${Number(appt.listing.livingAreaSqft).toLocaleString()} sq ft` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </button>
            ) : null}

            {appt.status !== 'cancelled' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 16 }}>
                {appt.status === 'scheduled' && !past ? (
                  <button type="button" className="km-btn km-btn--ghost km-btn--sm" disabled={!!busy} onClick={() => setStatusTo('confirmed', close)}>{busy === 'confirmed' ? <Spinner size={14} /> : <Icon name="checkCircle" size={15} color="var(--green)" />} Confirm</button>
                ) : null}
                {appt.status !== 'completed' ? (
                  <button type="button" className="km-btn km-btn--success km-btn--sm" disabled={!!busy} onClick={() => setStatusTo('completed', close)}>{busy === 'completed' ? <Spinner size={14} /> : <Icon name="check" size={15} stroke={2.6} />} Complete</button>
                ) : (
                  <button type="button" className="km-btn km-btn--ghost km-btn--sm" disabled={!!busy} onClick={() => setStatusTo('scheduled', close)}><Icon name="undo" size={15} /> Reopen</button>
                )}
                {started && appt.status !== 'no_show' && appt.status !== 'completed' ? (
                  <button type="button" className="km-btn km-btn--ghost km-btn--sm" disabled={!!busy} onClick={() => setStatusTo('no_show', close)}><Icon name="userCheck" size={15} color="var(--amber)" /> No-show</button>
                ) : null}
                <button type="button" className="km-btn km-btn--ghost km-btn--sm" disabled={!!busy} onClick={() => setStatusTo('cancelled', close)} style={{ color: 'var(--red)' }}><Icon name="x" size={15} /> Cancel</button>
              </div>
            ) : (
              <button type="button" className="km-btn km-btn--ghost km-btn--sm km-btn--block" style={{ marginTop: 16 }} onClick={() => setStatusTo('scheduled', close)}><Icon name="undo" size={15} /> Restore appointment</button>
            )}

            {showFeedback ? <OutcomeCapture appt={appt} onSaved={(a) => setAppt(a)} /> : null}
            {appt.client ? <Briefing appt={appt} /> : null}

            {appt.notes ? (
              <div style={{ marginTop: 16 }}>
                <div className="km-eyebrow" style={{ marginBottom: 6 }}>Notes</div>
                <div className="km-selectable" style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{appt.notes}</div>
              </div>
            ) : null}
            <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 18, textAlign: 'center' }}>
              Booked {relativeTime(appt.createdAt)}{appt.updatedAt && appt.updatedAt !== appt.createdAt ? ` · updated ${relativeTime(appt.updatedAt)}` : ''}
            </div>
          </div>
        );
      }}
    </Sheet>
  );
}
