// ApptsTab — upcoming showings/meetings, open tasks, and past appointments
// for this client. Reads the dashboard builder's /api/appointments and
// /api/tasks (guarded: a missing endpoint shows a calm empty state).
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../ui/Icon';
import { EmptyState, Skeleton } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { api } from '../../../api/client';
import { nav } from '../../../lib/nav';
import { useSocket, useResync } from '../../../hooks/useSocket';
import { formatTime } from '../../../lib/format';
import { humanize, SectionTitle } from '../clientKit';

const TYPE_COLOR = {
  showing: 'var(--kind-showing)', private_tour: 'var(--kind-showing)', open_house: 'var(--kind-openhouse)', broker_open: 'var(--kind-openhouse)',
  listing_presentation: 'var(--kind-listing)', closing: 'var(--kind-closing)', call: 'var(--kind-call)', video: 'var(--kind-text)',
  inspection: 'var(--kind-prep)', appraisal: 'var(--kind-prep)', final_walkthrough: 'var(--kind-prep)', meeting: 'var(--kind-match)', buyer_consult: 'var(--kind-match)',
};

function ApptRow({ a, past }) {
  const d = new Date(a.startAt);
  return (
    <button type="button" className={`kc-appt km-press ${past ? 'kc-appt--past' : ''}`} onClick={() => nav.openAppointment(a.id)}>
      <div className="kc-appt-date">
        <div>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <div>{a.allDay ? 'All day' : formatTime(a.startAt)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 500 }}>{a.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span className="kc-dot" style={{ background: TYPE_COLOR[a.type] || 'var(--blue)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{humanize(a.type)}{a.status && a.status !== 'scheduled' ? ` · ${humanize(a.status)}` : ''}</span>
        </div>
        {a.location ? <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }}><Icon name="mapPin" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />{a.location}</div> : null}
        {a.notes ? <div className="km-clamp-2" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{a.notes}</div> : null}
      </div>
    </button>
  );
}

export default function ApptsTab({ client, onScroll }) {
  const [appts, setAppts] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [apptErr, setApptErr] = useState(false);

  const loadAppts = useCallback(() => {
    api.get('/appointments', { clientId: client.id, limit: 100 })
      .then((r) => { setAppts(Array.isArray(r) ? r : (r?.appointments || [])); setApptErr(false); })
      .catch(() => { setAppts([]); setApptErr(true); });
  }, [client.id]);
  const loadTasks = useCallback(() => {
    api.get('/tasks', { clientId: client.id, open: 1 })
      .then((r) => setTasks((Array.isArray(r) ? r : (r?.tasks || [])).filter((t) => !t.clientId || t.clientId === client.id)))
      .catch(() => setTasks([]));
  }, [client.id]);
  useEffect(() => { loadAppts(); loadTasks(); }, [loadAppts, loadTasks]);
  useSocket('appointment_updated', (p) => { if (!p || !p.clientId || p.clientId === client.id) loadAppts(); });
  useSocket('task_updated', (p) => { if (!p || !p.clientId || p.clientId === client.id) loadTasks(); });
  useResync(() => { loadAppts(); loadTasks(); });

  const now = Date.now();
  const list = (appts || []).filter((a) => a.clientId === client.id || !a.clientId);
  const upcoming = list.filter((a) => new Date(a.endAt || a.startAt).getTime() >= now && a.status !== 'cancelled').sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const past = list.filter((a) => new Date(a.endAt || a.startAt).getTime() < now || a.status === 'cancelled').sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
  const openTasks = (tasks || []).filter((t) => !['done', 'dismissed', 'cancelled'].includes(t.status));

  const complete = async (t) => {
    setTasks((xs) => xs.map((x) => (x.id === t.id ? { ...x, status: 'done' } : x)));
    try {
      await api.patch(`/tasks/${t.id}`, { status: 'done' });
      setTimeout(loadTasks, 600);
    } catch (e) {
      setTasks((xs) => xs.map((x) => (x.id === t.id ? t : x)));
      toast.error(e.message || 'Couldn’t complete that task');
    }
  };

  const schedule = () => nav.newAppointment({ clientId: client.id, title: `Showing with ${client.firstName || ''}`.trim() });

  return (
    <div className="kc-pane" style={{ position: 'relative' }}>
      <div className="kc-pane-scroll km-scroll" onScroll={onScroll}>
        <div className="kc-pane-inner">
          <SectionTitle style={{ marginTop: 10 }} action={<button type="button" className="km-btn km-btn--sm" onClick={schedule}><Icon name="plus" size={14} stroke={2.4} /> Schedule</button>}>Upcoming</SectionTitle>
          {appts === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton h={74} r={12} /><Skeleton h={74} r={12} /></div>
          ) : upcoming.length === 0 ? (
            <div className="kc-pf-empty" style={{ marginTop: 0 }}>
              <h4>{apptErr ? 'Calendar is warming up' : 'Nothing scheduled'}</h4>
              <p>{apptErr ? 'Appointments will show here as soon as the calendar connects.' : `Book a showing, a listing presentation or a coffee with ${client.firstName || 'them'}.`}</p>
              <button type="button" className="km-btn km-btn--sm" style={{ marginTop: 14 }} onClick={schedule}>New appointment</button>
            </div>
          ) : upcoming.map((a) => <ApptRow key={a.id} a={a} />)}

          <SectionTitle>Tasks</SectionTitle>
          {tasks === null ? <Skeleton h={44} r={10} /> : openTasks.length === 0 ? (
            <div style={{ fontSize: 13.5, color: 'var(--faint)', padding: '4px 2px 6px' }}>No open tasks for {client.firstName || 'this client'}.</div>
          ) : openTasks.map((t) => (
            <div key={t.id} className="kc-task">
              <button type="button" className={`kc-check ${t.status === 'done' ? 'kc-check--on' : ''}`} onClick={() => complete(t)} aria-label="Complete task">
                {t.status === 'done' ? <Icon name="check" size={13} stroke={3} /> : null}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--faint)' : 'var(--text)' }}>{t.title}</div>
                {t.dueAt || t.dueDate ? <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>Due {new Date(t.dueAt || `${t.dueDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div> : null}
              </div>
              {t.source === 'serena' || t.source === 'ai_capture' ? <span className="kc-tag kc-tag--mono kc-tag--violet">AI</span> : null}
            </div>
          ))}

          {past.length ? (
            <>
              <SectionTitle>Past</SectionTitle>
              {past.slice(0, 30).map((a) => <ApptRow key={a.id} a={a} past />)}
            </>
          ) : null}
          {appts !== null && list.length === 0 && openTasks.length === 0 && !apptErr ? (
            <EmptyState icon="calendar" title="No history yet" sub="Showings and meetings with this client will collect here." style={{ padding: '24px 12px' }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
