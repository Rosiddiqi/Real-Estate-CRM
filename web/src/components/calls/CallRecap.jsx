// CallRecap (RevMatch C5Recap): the hung-up call lands here. Summary +
// bullets, then the agent's follow-ups ONE card at a time — book the showing,
// the to-dos they promised, a follow-up text draft — Skip · Edit · Yes. Added
// items keep a 5-minute Undo. Customer texts open as a draft in the thread;
// nothing is ever sent from here.
import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { decideSuggestion, getCall, undoCallAction } from '../../api/calls';
import { callStore } from './callStore';
import { callName, fmtShort } from './callUtil';
import SaveContactSheet from './SaveContactSheet';

const KIND = {
  appointment: { label: 'Appointment', icon: 'calendar', yes: 'Yes, book it' },
  task: { label: 'To-do', icon: 'checklist', yes: 'Yes, add it' },
  text: { label: 'Text draft', icon: 'message', yes: 'Open draft' },
  note: { label: 'Note', icon: 'file', yes: 'Save note' },
  search: { label: 'Buyer search', icon: 'target', yes: 'Save search' },
};
const ORDER = { appointment: 0, task: 1, search: 2, note: 3, text: 4 };
const TYPE_LABEL = { showing: 'Showing', private_tour: 'Private tour', listing_presentation: 'Listing presentation', buyer_consult: 'Buyer consult', call: 'Call', meeting: 'Meeting', inspection: 'Inspection', closing: 'Closing' };

// [label, key, value] rows — display mode shows resolved values, edit mode the raw inputs.
function fieldRows(s, editing) {
  const f = s.fields || {};
  const when = (s.preview && s.preview.when) || null;
  if (s.kind === 'appointment') {
    return editing
      ? [['Day', 'date', f.date || ''], ['Time', 'time', f.time || '']]
      : [['What', 'type', TYPE_LABEL[f.type] || f.type || 'Showing'], ['When', 'when', when || [f.date, f.time].filter(Boolean).join(' ')]];
  }
  if (s.kind === 'task') return [['To-do', 'title', f.title || s.title], ['Due', 'date', editing ? (f.date || '') : (when || f.date || 'No date')]];
  if (s.kind === 'text' || s.kind === 'note') return [[s.kind === 'text' ? 'Message' : 'Note', 'body', f.body || '']];
  return [];
}

export default function CallRecap({ call, lines, onDone, onHandoff }) {
  const [cards, setCards] = useState(() => (call.suggestions || []));
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [vals, setVals] = useState({});
  const [showTx, setShowTx] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const decided = useRef(new Map());
  const pending = call.recapStatus === 'pending' || (!call.recapStatus && call.status === 'completed' && call.durationSec > 0 && !call.summary);

  // Merge server snapshots; locally-decided cards always win (never resurrect).
  useEffect(() => {
    const next = (call.suggestions || []).map((c) => (decided.current.has(c.id) ? { ...c, ...decided.current.get(c.id) } : c));
    setCards(next);
  }, [call.suggestions]);

  // Fallback poll while the recap is being written (realtime usually wins).
  useEffect(() => {
    if (!pending) return undefined;
    let n = 0;
    const id = setInterval(async () => {
      n += 1;
      try { const { call: c } = await getCall(call.id); if (c && c.recapStatus === 'ready') { callStore.patchCall({ ...c, transcript: undefined }); clearInterval(id); } } catch { /* keep waiting */ }
      if (n > 18) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [pending, call.id]);

  const sorted = useMemo(() => [...cards].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9)), [cards]);
  const current = sorted.find((c) => !c.status || c.status === 'pending');
  const doneCount = sorted.filter((c) => c.status && c.status !== 'pending').length;
  const name = saved ? [saved.firstName, saved.lastName].filter(Boolean).join(' ') : callName(call);

  const setLocal = (id, patch) => {
    decided.current.set(id, { ...(decided.current.get(id) || {}), ...patch });
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const decide = async (card, status) => {
    if (busy) return;
    const fields = editing === card.id ? vals : undefined;
    setBusy(card.id);
    const prev = { status: card.status || 'pending' };
    setLocal(card.id, { status: status === 'no' ? 'no' : status === 'edit' ? 'edited' : 'yes' });
    try {
      const out = await decideSuggestion(call.id, card.id, { status: fields && status === 'yes' ? 'edit' : status, fields });
      setLocal(card.id, { ...out.suggestion, undoToken: out.undoToken || null });
      setEditing(null);
      if (status !== 'no') haptic('success');
      if (out.draft && out.draft.clientId) {
        onHandoff(() => nav.openThread({ clientId: out.draft.clientId, draft: out.draft.body }));
      }
    } catch (err) {
      setLocal(card.id, prev);
      toast.error(err.message || 'Couldn’t do that');
    } finally {
      setBusy(null);
    }
  };

  const undo = async (card) => {
    if (!card.undoToken) return;
    try {
      await undoCallAction(card.undoToken);
      setLocal(card.id, { status: 'pending', undoToken: null, result: null });
      toast('Undone');
    } catch (err) { toast.error(err.message || 'Undo expired'); }
  };

  const startEdit = (card) => {
    setEditing(card.id);
    const f = card.fields || {};
    setVals(card.kind === 'appointment' ? { date: f.date || '', time: f.time || '' } : card.kind === 'task' ? { title: f.title || card.title, date: f.date || '' } : { body: f.body || '' });
  };

  return (
    <>
      <div className="km-call-top">
        <button type="button" className="km-call-round km-lg km-lg--light" onClick={onDone} aria-label="Close"><Icon name="x" size={18} stroke={2.2} /></button>
        <div className="km-call-timer km-lg km-lg--light"><Icon name="checkCircle" size={14} stroke={2.4} color="var(--green)" />{call.mode === 'device' ? 'Call logged' : 'Call ended'}{call.mode === 'device' && call.outcome === 'no_answer' ? '' : ` · ${fmtShort(call.durationSec)}`}</div>
        <span style={{ width: 40 }} />
      </div>
      <div className="km-recap-body">
        <div className="km-call-inner">
          <div className="km-call-hero" style={{ paddingTop: 16, paddingBottom: 14 }}>
            <Avatar name={call.client || saved ? name : null} seed={call.clientId || saved?.id || call.otherNumber} src={call.client?.avatarUrl} size={60} />
            <div className="km-call-name" style={{ fontSize: 23 }}>{name}</div>
            <div className="km-call-meta">{call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call · {call.mode === 'device' && call.outcome === 'no_answer' ? 'no answer' : call.mode === 'device' && call.outcome === 'voicemail' ? `voicemail ${fmtShort(call.durationSec)}` : fmtShort(call.durationSec)}{call.mode === 'simulated' ? ' · demo line' : call.mode === 'device' ? ' · from your phone' : ''}</div>
            {!call.clientId && !saved && call.otherNumber ? (
              <button type="button" className="km-srn-ghost km-srn-ghost--blue" style={{ marginTop: 10 }} onClick={() => setSaveOpen(true)}><Icon name="userPlus" size={14} stroke={2} />Save contact</button>
            ) : saved ? <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>✓ Saved to clients</div> : null}
          </div>

          <div className="km-recap-card">
            <div className="km-recap-eyebrow"><Icon name="sparkle" size={12} stroke={2.2} color="#C29BFF" />Summary{call.topic ? <span style={{ marginLeft: 'auto', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }} className="km-truncate">{call.topic}</span> : null}</div>
            {pending ? (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                <Spinner size={16} color="#C29BFF" />Wrapping up the call — pulling out your commitments and next steps…
              </div>
            ) : call.summary ? (
              <>
                <div className="km-recap-summary km-selectable">{call.summary}</div>
                {call.summaryBullets && call.summaryBullets.length ? (
                  <div className="km-recap-bullets">{call.summaryBullets.map((b) => <div key={b} className="km-selectable">{b}</div>)}</div>
                ) : null}
              </>
            ) : (
              <div className="km-recap-summary" style={{ color: 'rgba(255,255,255,0.6)' }}>{lines.length ? 'Nothing to action from this call.' : 'No transcript was captured on this call, so there’s nothing to summarize.'}</div>
            )}
          </div>

          {!pending && sorted.length ? (
            current ? (
              <div className="km-sg" key={current.id}>
                <div className="km-sg-head">
                  <span className="km-sg-kind"><Icon name={(KIND[current.kind] || KIND.task).icon} size={13} stroke={2.2} />{(KIND[current.kind] || KIND.task).label}</span>
                  <span className="km-sg-count">{doneCount + 1} of {sorted.length}</span>
                </div>
                <div className="km-sg-title">{current.title}</div>
                {current.heard ? <div className="km-sg-heard km-selectable"><b>{call.mode === 'device' ? 'From your notes' : 'From the call'}</b>“{current.heard}”</div> : null}
                <div className="km-sg-fields">
                  {fieldRows(current, editing === current.id).map(([label, key, value]) => (
                    <div className="km-sg-field" key={key}>
                      <label>{label}</label>
                      {editing === current.id ? (
                        key === 'body'
                          ? <textarea value={vals.body || ''} onChange={(e) => setVals((v) => ({ ...v, body: e.target.value }))} />
                          : <input value={vals[key] || ''} onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))} placeholder={key === 'time' ? 'HH:MM (24h)' : key === 'date' ? 'tomorrow, friday, 10/14…' : ''} />
                      ) : <span className="km-sg-val km-selectable" style={key === 'body' ? { whiteSpace: 'pre-wrap', lineHeight: 1.4 } : null}>{value || '—'}</span>}
                    </div>
                  ))}
                </div>
                <div className="km-sg-actions">
                  <button type="button" className="km-sg-btn km-lg km-lg--light" onClick={() => decide(current, 'no')} disabled={!!busy}>Skip</button>
                  {editing === current.id
                    ? <button type="button" className="km-sg-btn km-lg km-lg--light" onClick={() => setEditing(null)}>Cancel</button>
                    : <button type="button" className="km-sg-btn km-lg km-lg--light" onClick={() => startEdit(current)} disabled={!!busy}>Edit</button>}
                  <button type="button" className="km-sg-btn km-sg-btn--yes" onClick={() => decide(current, 'yes')} disabled={!!busy || ((current.kind === 'appointment' || current.kind === 'note') && !call.clientId && !saved)}>
                    {busy === current.id ? <Spinner size={16} color="#fff" /> : null}{editing === current.id ? 'Save' : (KIND[current.kind] || KIND.task).yes}
                  </button>
                </div>
                <div className="km-sg-dots">{sorted.map((c) => <span key={c.id} className={c.id === current.id ? 'is-on' : c.status && c.status !== 'pending' ? 'is-done' : ''} />)}</div>
              </div>
            ) : (
              <div className="km-sg">
                <div className="km-recap-eyebrow"><Icon name="checkCircle" size={13} stroke={2.4} color="var(--green)" />All set</div>
                <div style={{ marginTop: 8 }}>
                  {sorted.map((c) => (
                    <div key={c.id} className="km-sg-done-row">
                      <Icon name={c.status === 'no' ? 'x' : 'check'} size={15} stroke={2.4} color={c.status === 'no' ? 'rgba(255,255,255,0.4)' : 'var(--green)'} />
                      <span className="km-truncate" style={{ flex: 1, color: c.status === 'no' ? 'rgba(255,255,255,0.45)' : '#fff' }}>{c.title}</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{c.status === 'no' ? 'Skipped' : c.kind === 'text' ? 'Drafted' : c.status === 'edited' ? 'Edited · added' : 'Added'}</span>
                      {c.undoToken || c.status === 'no' ? (
                        <button type="button" className="km-srn-ghost" style={{ padding: '5px 9px' }} onClick={() => (c.status === 'no' ? setLocal(c.id, { status: 'pending' }) : undo(c))}>{c.status === 'no' ? 'Review' : 'Undo'}</button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button type="button" className="km-sg-btn km-sg-btn--yes" style={{ width: '100%', marginTop: 14 }} onClick={onDone}>Done</button>
              </div>
            )
          ) : !pending ? (
            <button type="button" className="km-sg-btn km-sg-btn--yes" style={{ width: '100%', marginTop: 16 }} onClick={onDone}>Done</button>
          ) : null}

          {lines.length ? (
            <div className="km-recap-card" style={{ marginTop: 14 }}>
              <button type="button" className="km-recap-eyebrow" style={{ width: '100%' }} onClick={() => setShowTx((v) => !v)}>
                <Icon name="file" size={12} stroke={2.2} />Transcript · {lines.filter((l) => l.speaker !== 'note').length} lines
                <Icon name={showTx ? 'chevronUp' : 'chevronDown'} size={13} stroke={2.2} style={{ marginLeft: 'auto' }} />
              </button>
              {showTx ? (
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto' }}>
                  {lines.map((l) => (
                    <div key={l.id} style={{ marginBottom: 9, fontSize: 13.5, lineHeight: 1.42 }} className="km-selectable">
                      <span style={{ fontSize: 11, fontWeight: 700, color: l.speaker === 'agent' ? 'rgba(255,255,255,0.4)' : 'var(--bright)', marginRight: 6 }}>{l.speaker === 'agent' ? 'YOU' : l.speaker === 'note' ? 'NOTE' : (call.client?.firstName || 'THEM').toUpperCase()}</span>
                      <span style={{ color: l.speaker === 'agent' ? 'rgba(255,255,255,0.7)' : '#fff' }}>{l.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <SaveContactSheet open={saveOpen} phone={call.otherNumber} onClose={() => setSaveOpen(false)} onSaved={(c) => { setSaved(c); callStore.patchCall({ clientId: c.id, client: { id: c.id, name: c.name, firstName: c.firstName, lastName: c.lastName, phone: c.phone } }); }} />
    </>
  );
}
