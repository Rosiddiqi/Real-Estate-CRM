// AddAppointmentSheet — new appointment. Type grid (icons + KIND colors),
// client via ClientPicker, optional listing (search; location auto-fills),
// date / start / duration, notes, a live conflict preview against the day's
// other appointments, and an off-day heads-up from the work schedule.
// Overlay contract: { prefill: { clientId, listingId, dealId, type, startAt, durationMin, title, location, notes }, onClose }
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { toast } from '../ui/toast';
import ClientPicker from '../client/ClientPicker';
import { api } from '../../api/client';
import { createAppointment, getAppointments, getWorkSchedule } from '../../api/appointments';
import { fullName, moneyCompact } from '../../lib/format';
import { haptic } from '../../lib/native';
import { nav } from '../../lib/nav';
import { APPT_TYPES, KIND_COLOR, apptType, alpha } from './appointmentTypes';
import { dateKey, keyToDate, resolveWindow, fmtMin, durLabel, minuteOfDay, zonedDate, shiftKey, minToHHMM } from '../battleplan/time';
import useAgentTz from '../battleplan/useAgentTz';
import '../../styles/dashboard.css';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

function listingAddress(l) {
  if (!l) return '';
  const street = [l.street, l.unitNumber].filter(Boolean).join(' ');
  return [street || l.buildingName || l.title, [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}
function listingPhoto(l) {
  return l ? (l.heroPhoto || (l.photoUrls || [])[0] || null) : null;
}
// Default slot: the next half hour today in the agent's zone, or 10 AM
// tomorrow once it's 8 PM or later.
function defaultStart(prefill) {
  if (prefill && prefill.startAt) return new Date(prefill.startAt);
  const now = new Date();
  const next = Math.ceil((minuteOfDay(now) + 1) / 30) * 30;
  if (next >= 20 * 60) return zonedDate(shiftKey(dateKey(now), 1), 600);
  return zonedDate(dateKey(now), next);
}
const toTime = (d) => minToHHMM(minuteOfDay(d));

export function TypeGrid({ value, onChange, compact }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compact ? 5 : 4}, minmax(0, 1fr))`, gap: 8 }}>
      {APPT_TYPES.map((t) => {
        const on = t.id === value;
        const c = KIND_COLOR[t.kind];
        return (
          <button
            key={t.id}
            type="button"
            className="cal-type-tile"
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            title={t.desc}
            style={on ? { background: alpha(c, 16), borderColor: alpha(c, 55), color: 'var(--text)', boxShadow: `0 0 0 1px ${alpha(c, 30)}, 0 8px 18px -10px ${alpha(c, 60)}` } : undefined}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? c : alpha(c, 14) }}>
              <Icon name={t.icon} size={16} color={on ? '#fff' : c} stroke={2} />
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function ListingSearch({ value, onPick, onClear }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value || q.trim().length < 2) { setRows([]); return undefined; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      api.get('/listings', { search: q.trim(), limit: 6 })
        .then((r) => { if (alive) setRows(r.listings || r.items || []); })
        .catch(() => { if (alive) setRows([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, value]);
  if (value) {
    return (
      <div className="bp-tile" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14 }}>
        <PropertyPhoto src={listingPhoto(value)} seed={value.id} height={44} radius={10} style={{ width: 60, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="km-truncate" style={{ fontSize: 14, fontWeight: 600 }}>{[value.street, value.unitNumber].filter(Boolean).join(' ') || value.title || 'Listing'}</div>
          <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)' }}>{[value.city, value.listPrice ? moneyCompact(value.listPrice) : null].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="km-icon-btn km-icon-btn--sm" onClick={onClear} aria-label="Remove listing" style={{ background: 'var(--bp-fill)' }}><Icon name="x" size={15} /></button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <div className="km-search km-lg km-lg--line" style={{ height: 44 }}>
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings by address, MLS #, building" aria-label="Search listings" />
        {busy ? <span className="km-faint" style={{ fontSize: 12 }}>…</span> : null}
      </div>
      {rows.length ? (
        <div className="km-list" style={{ marginTop: 6, padding: '0 10px' }}>
          {rows.map((l) => (
            <button key={l.id} type="button" className="km-row km-press" style={{ width: '100%', textAlign: 'left', gap: 10, padding: '8px 0' }} onClick={() => { onPick(l); setQ(''); setRows([]); }}>
              <PropertyPhoto src={listingPhoto(l)} seed={l.id} height={36} radius={8} style={{ width: 48, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{[l.street, l.unitNumber].filter(Boolean).join(' ') || l.title || 'Listing'}</span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>{[l.neighborhood || l.city, l.listPrice ? moneyCompact(l.listPrice) : null, l.mlsNumber ? `MLS ${l.mlsNumber}` : null].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AddAppointmentSheet({ prefill = {}, onClose }) {
  useAgentTz();
  const start0 = useMemo(() => defaultStart(prefill), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [type, setType] = useState(apptType(prefill.type || 'showing').id);
  const [client, setClient] = useState(null);
  const [listing, setListing] = useState(null);
  const [title, setTitle] = useState(prefill.title || '');
  const [date, setDate] = useState(dateKey(start0));
  const [time, setTime] = useState(toTime(start0));
  const [dur, setDur] = useState(prefill.durationMin || apptType(prefill.type || 'showing').duration);
  const [durTouched, setDurTouched] = useState(!!prefill.durationMin);
  const [location, setLocation] = useState(prefill.location || '');
  const [locTouched, setLocTouched] = useState(!!prefill.location);
  const [notes, setNotes] = useState(prefill.notes || '');
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dayAppts, setDayAppts] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const closeRef = useRef(null);

  // Prefill client / listing.
  useEffect(() => {
    if (prefill.clientId) api.get(`/clients/${prefill.clientId}`).then((r) => setClient(r.client || r)).catch(() => {});
    if (prefill.listingId) api.get(`/listings/${prefill.listingId}`).then((r) => setListing(r.listing || r)).catch(() => {});
    getWorkSchedule().then((r) => setSchedule(r.schedule)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!durTouched) setDur(apptType(type).duration); }, [type, durTouched]);
  useEffect(() => { if (listing && !locTouched) setLocation(listingAddress(listing)); }, [listing, locTouched]);

  // The chosen day's other appointments (conflict preview).
  useEffect(() => {
    let alive = true;
    const from = zonedDate(date, 0);
    const to = zonedDate(shiftKey(date, 1), 0);
    getAppointments({ from: from.toISOString(), to: to.toISOString(), limit: 100 })
      .then((r) => { if (alive) setDayAppts((r.appointments || []).filter((a) => a.status !== 'cancelled')); })
      .catch(() => { if (alive) setDayAppts([]); });
    return () => { alive = false; };
  }, [date]);

  const startAt = useMemo(() => {
    const [h, m] = time.split(':').map(Number);
    return zonedDate(date, (h || 0) * 60 + (m || 0));
  }, [date, time]);
  const startMin = (() => { const [h, m] = time.split(':').map(Number); return (h || 0) * 60 + (m || 0); })();
  const conflicts = useMemo(() => dayAppts.filter((a) => {
    const s = new Date(a.startAt).getTime(); const e = new Date(a.endAt).getTime();
    return s < startAt.getTime() + dur * 60000 && e > startAt.getTime();
  }), [dayAppts, startAt, dur]);
  const win = resolveWindow(schedule, date);
  const offDay = win && win.off;
  const outside = win && !win.off && (startMin < win.start || startMin + dur > win.end);

  const meta = apptType(type);
  const autoTitle = client ? `${meta.label} with ${fullName(client)}` : listing ? `${meta.label} — ${[listing.street, listing.unitNumber].filter(Boolean).join(' ') || listing.title || ''}` : meta.label;
  const valid = !!date && !!time && !Number.isNaN(startAt.getTime());

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { appointment } = await createAppointment({
        type, title: title.trim() || null, clientId: client ? client.id : null, listingId: listing ? listing.id : null,
        dealId: prefill.dealId || null, startAt: startAt.toISOString(), durationMin: dur, location: location.trim() || null, notes: notes.trim() || null,
      });
      haptic('success');
      toast.success(`${meta.label} booked · ${keyToDate(date).toLocaleDateString('en-US', { weekday: 'short' })} ${fmtMin(startMin)}`, appointment ? { action: { label: 'Open', onClick: () => nav.openAppointment(appointment.id) } } : undefined);
      closeRef.current?.();
    } catch (err) {
      toast.error(err.message || 'Couldn’t book that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet open onClose={onClose} title="New appointment" right={{ label: saving ? 'Saving…' : 'Add', onClick: save, disabled: !valid || saving }} maxHeight="90%">
        {({ close }) => {
          closeRef.current = close;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 4 }}>
              <TypeGrid value={type} onChange={setType} />

              <div className="km-field">
                <span className="km-field-label">Client</span>
                {client ? (
                  <div className="bp-tile" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14 }}>
                    <Avatar name={fullName(client)} seed={client.id} src={client.avatarUrl} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="km-truncate" style={{ fontSize: 15, fontWeight: 600 }}>{fullName(client)}</div>
                      <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)' }}>{client.phone || client.email || client.type || ''}</div>
                    </div>
                    <button type="button" className="km-btn km-btn--plain km-btn--sm" onClick={() => setPicker(true)}>Change</button>
                    <button type="button" className="km-icon-btn km-icon-btn--sm" onClick={() => setClient(null)} aria-label="Remove client" style={{ background: 'var(--bp-fill)' }}><Icon name="x" size={15} /></button>
                  </div>
                ) : (
                  <button type="button" className="km-press" onClick={() => setPicker(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 14px', borderRadius: 'var(--r-md)', border: '1px dashed var(--lineHi)', color: 'var(--bright)', fontSize: 15, fontWeight: 500 }}>
                    <Icon name="userPlus" size={18} /> Link a client (optional)
                  </button>
                )}
              </div>

              <div className="km-field">
                <span className="km-field-label">Listing</span>
                <ListingSearch value={listing} onPick={setListing} onClear={() => { setListing(null); if (!locTouched) setLocation(''); }} />
              </div>

              <label className="km-field">
                <span className="km-field-label">Title</span>
                <input className="km-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} maxLength={200} />
              </label>

              <div className="km-field-row">
                <label className="km-field" style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-field-label">Date</span>
                  <input type="date" className="km-input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: '100%', minWidth: 0 }} />
                </label>
                <label className="km-field" style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-field-label">Start</span>
                  <input type="time" className="km-input" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} style={{ width: '100%', minWidth: 0 }} />
                </label>
              </div>

              <div className="km-field">
                <span className="km-field-label">Duration · ends {fmtMin(startMin + dur)}</span>
                <div className="km-scroll-x" style={{ display: 'flex', gap: 8 }}>
                  {DURATIONS.map((d) => (
                    <button key={d} type="button" className={`km-pill ${dur === d ? 'km-pill--on' : ''}`} onClick={() => { setDur(d); setDurTouched(true); }}>{durLabel(d)}</button>
                  ))}
                </div>
              </div>

              {offDay || outside || conflicts.length ? (
                <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,149,0,0.10)', border: '1px solid rgba(242,169,59,0.35)' }}>
                  {offDay ? <div style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>Heads up — you’re off this day per your schedule.</div> : null}
                  {outside ? <div style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 600 }}>Outside your working hours ({fmtMin(win.start)}–{fmtMin(win.end)}).</div> : null}
                  {conflicts.length ? (
                    <div style={{ marginTop: offDay || outside ? 6 : 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: 'var(--amber)', marginBottom: 3 }}>! OVERLAPS WITH</div>
                      {conflicts.slice(0, 3).map((a) => (
                        <div key={a.id} className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)' }}>
                          {fmtMin(minuteOfDay(a.startAt))} · {a.title}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label className="km-field">
                <span className="km-field-label">Location</span>
                <input className="km-input" value={location} onChange={(e) => { setLocation(e.target.value); setLocTouched(true); }} placeholder={type === 'video' || type === 'call' ? 'Link or number' : 'Property address or meeting place'} />
              </label>

              <label className="km-field">
                <span className="km-field-label">Notes</span>
                <textarea className="km-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, lockbox, agenda, who else is coming…" />
              </label>

              <button type="button" className="km-btn km-btn--lg km-btn--block" disabled={!valid || saving} onClick={save}>
                {saving ? 'Booking…' : `Add ${meta.label.toLowerCase()}`}
              </button>
            </div>
          );
        }}
      </Sheet>
      <ClientPicker open={picker} onClose={() => setPicker(false)} onPick={(c) => setClient(c)} kind="client" title="Who is it with?" />
    </>
  );
}
