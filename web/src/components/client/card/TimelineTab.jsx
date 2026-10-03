// TimelineTab — the conversation (ThreadView, owned by the inbox builder)
// told as one story with RevMatch's orange activity pills: calls (rich call
// cards), showings, deals, notes, portfolio changes — "Added to KeyMatch"
// pinned first. ThreadView interleaves `timelineItems` by time when it
// supports them (ThreadView.supportsTimeline); otherwise the pills ride in a
// collapsible strip above the thread.
import { useMemo, useState } from 'react';
import ThreadView from '../../thread/ThreadView';
import Icon from '../../ui/Icon';
import { confirm, toast } from '../../ui/toast';
import { mediaUrl } from '../../../api/client';
import { updateNote, deleteNote } from '../../../api/clients';
import { nav } from '../../../lib/nav';
import { formatTime } from '../../../lib/format';

const KIND_ICON = {
  note: 'compose', call: 'phone', appointment: 'calendar', deal: 'handshake', property: 'house', search: 'search',
  match: 'sparkle', task: 'checklist', email: 'mail', campaign: 'send', system: 'info', added: 'userPlus',
};

const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(new Date(d).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });

function fmtDur(s) {
  if (!s) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallCard({ item }) {
  const [open, setOpen] = useState(false);
  const m = item.meta || {};
  const missed = ['call_missed'].includes(item.type) || ['missed', 'no_answer', 'busy'].includes(m.status);
  const inbound = m.direction === 'inbound';
  const bullets = (Array.isArray(m.summaryBullets) && m.summaryBullets.length ? m.summaryBullets : (item.body || '').split(/\n+/))
    .map((b) => String(typeof b === 'string' ? b : b?.text || '').replace(/^[-•*\s]+/, '').trim()).filter(Boolean).slice(0, 3);
  const transcript = Array.isArray(m.transcript) ? m.transcript : [];
  return (
    <div className="kc-callcard">
      <div className="kc-callcard-head">
        <Icon
          name={missed ? 'phoneMissed' : inbound ? 'phoneIncoming' : 'phoneOutgoing'}
          size={15}
          color={missed ? 'var(--red)' : inbound ? 'var(--green)' : 'var(--dim)'}
          stroke={2}
        />
        <span style={{ flex: 1 }}>{item.title}</span>
        {m.recordingUrl ? <span className="kc-tag kc-tag--mono kc-tag--violet">Recorded</span> : null}
        <span className="kc-mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>{shortDate(item.at)} · {formatTime(item.at)}</span>
      </div>
      {m.recordingUrl ? (
        <audio controls preload="none" src={mediaUrl(m.recordingUrl)} style={{ width: '100%', height: 34 }} />
      ) : null}
      {bullets.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="kc-tag kc-tag--mono kc-tag--violet" style={{ alignSelf: 'flex-start' }}><Icon name="sparkle" size={9} stroke={2.4} /> AI recap</span>
          {bullets.map((b, i) => <div key={i} className="kc-bullet km-selectable">{b}</div>)}
        </div>
      ) : null}
      {transcript.length ? (
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="kc-mono" style={{ fontSize: 10.5, letterSpacing: 1.2, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} /> TRANSCRIPT · {transcript.length} LINES
          </button>
          {open ? (
            <div className="kc-transcript" style={{ marginTop: 8 }}>
              {transcript.map((t, i) => (
                <div key={i} className={`${t.speaker === 'agent' ? 'kc-me' : ''} km-selectable`}>
                  <b style={{ fontSize: 10.5, color: 'var(--faint)', marginRight: 6 }}>{t.speaker === 'agent' ? 'You' : 'Client'}</b>{t.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {m.durationSec && !bullets.length && !transcript.length ? <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>{fmtDur(m.durationSec)} talk time</div> : null}
    </div>
  );
}

export function ActivityPill({ item, clientId, onChanged, onOpenProperty, onOpenTab }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.body || '');
  const [busy, setBusy] = useState(false);
  if (item.kind === 'call') return <CallCard item={item} />;
  if (item.kind === 'added') {
    return (
      <div className="kc-pillrow" style={{ justifyContent: 'center' }}>
        <span className="kc-apill kc-apill--added"><Icon name="userPlus" size={12} stroke={2.2} /> {item.title} · {shortDate(item.at)}</span>
      </div>
    );
  }
  const m = item.meta || {};
  const noteId = m.noteId;
  const expandable = !!item.body || item.kind === 'note';
  const tap = () => {
    if (item.kind === 'deal' && m.dealId) return nav.openDeal(m.dealId);
    if (item.kind === 'appointment' && m.appointmentId) return nav.openAppointment(m.appointmentId);
    if (item.kind === 'property' && m.propertyId && onOpenProperty) return onOpenProperty(m.propertyId);
    if (item.kind === 'search' && onOpenTab) return onOpenTab('Portfolio', 'wishlist');
    if (expandable) setOpen((o) => !o);
    return null;
  };
  const saveNote = async () => {
    if (!noteId || !text.trim() || busy) return;
    setBusy(true);
    try { await updateNote(clientId, noteId, { body: text.trim() }); setEditing(false); onChanged?.(); } catch (e) { toast.error(e.message || 'Couldn’t save the note'); }
    setBusy(false);
  };
  const removeNote = async () => {
    if (!noteId) return;
    if (!(await confirm({ title: 'Delete this note?', confirmLabel: 'Delete note', destructive: true }))) return;
    try { await deleteNote(clientId, noteId); onChanged?.(); } catch (e) { toast.error(e.message || 'Couldn’t delete'); }
  };
  return (
    <div className="kc-pillrow">
      <div className="kc-apill">
        <button type="button" className="kc-apill-head" onClick={tap} style={{ color: 'inherit', textAlign: 'left' }}>
          <Icon name={KIND_ICON[item.kind] || 'info'} size={13} stroke={2.2} />
          <span style={{ flex: 1 }}>{item.title} · {shortDate(item.at)}</span>
          {expandable ? <Icon name="chevronDown" size={13} stroke={2.4} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /> : null}
        </button>
        {open ? (
          editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
              <textarea className="km-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 80, background: 'rgba(var(--accent-rgb), 0.06)', color: 'var(--text)', borderColor: 'var(--lineHi)' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, fontSize: 13.5, fontWeight: 500 }}>
                <button type="button" onClick={() => { setEditing(false); setText(item.body || ''); }} style={{ color: 'rgba(255,255,255,0.8)' }}>Cancel</button>
                <button type="button" onClick={saveNote} style={{ color: 'var(--text)' }}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <>
              {item.body ? <div className="kc-apill-body km-selectable">{item.body}</div> : null}
              {noteId ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 13, fontWeight: 500, paddingTop: 2 }}>
                  <button type="button" onClick={() => setEditing(true)} style={{ color: 'var(--text)' }}>Edit</button>
                  <button type="button" onClick={removeNote} style={{ color: '#FFE1E1' }}>Delete</button>
                </div>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

export default function TimelineTab({ client, activity, loading, onChanged, onOpenProperty, onOpenTab }) {
  const supports = ThreadView.supportsTimeline === true;
  const [stripOpen, setStripOpen] = useState(() => !(client.counts && client.counts.conversations > 0));
  const items = useMemo(() => (activity || []).filter((a) => a.kind !== 'added').slice().sort((a, b) => new Date(a.at) - new Date(b.at)), [activity]);
  const added = useMemo(() => (activity || []).find((a) => a.kind === 'added') || { id: 'added', kind: 'added', title: 'Added to KeyMatch', at: client.createdAt }, [activity, client.createdAt]);
  const pill = (it) => <ActivityPill key={it.id} item={it} clientId={client.id} onChanged={onChanged} onOpenProperty={onOpenProperty} onOpenTab={onOpenTab} />;
  const timelineItems = useMemo(() => items.map((it) => ({ id: it.id, at: it.at, node: pill(it) })), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const topNode = added.at ? pill(added) : null;
  const latest = items[items.length - 1];

  return (
    <div className="kc-pane" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {!supports ? (
        <div className="kc-strip">
          <button type="button" className="kc-strip-toggle" onClick={() => setStripOpen((o) => !o)} aria-expanded={stripOpen}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span className="kc-dot" style={{ background: 'var(--kc-pill)', boxShadow: '0 0 6px var(--kc-pill)' }} />
              <b style={{ color: 'var(--text)', fontWeight: 500 }}>Activity</b>
              <span className="km-truncate">{loading && !activity ? 'Loading…' : latest ? `${latest.title}` : 'Nothing logged yet'}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span className="kc-mono" style={{ fontSize: 11 }}>{items.length}</span>
              <Icon name="chevronDown" size={14} style={{ transform: stripOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
            </span>
          </button>
          {stripOpen ? (
            <div className="kc-strip-list km-scroll">
              {topNode}
              {items.map(pill)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <ThreadView clientId={client.id} embedded timelineItems={timelineItems} topNode={topNode} />
      </div>
    </div>
  );
}
