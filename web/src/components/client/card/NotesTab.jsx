// NotesTab — an auto-saving composer (Apple Notes feel: the note is created
// on the first pause and kept in sync as you type; "Done" starts a fresh one)
// plus the note list: pinned first, then newest, with pin / edit / delete.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon';
import { EmptyState, Skeleton, Spinner } from '../../ui/kit';
import { confirm, toast } from '../../ui/toast';
import { listNotes, addNote, updateNote, deleteNote } from '../../../api/clients';
import { useSocket } from '../../../hooks/useSocket';
import { formatDateTime } from '../../../lib/format';

const draftKey = (id) => `km-note-draft:${id}`;
const readDraft = (id) => { try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; } };
const writeDraft = (id, d) => { try { if (d && d.text) localStorage.setItem(draftKey(id), JSON.stringify(d)); else localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } };

function useAutoSave(clientId, onSaved) {
  const [text, setText] = useState(() => readDraft(clientId)?.text || '');
  const [noteId, setNoteId] = useState(() => readDraft(clientId)?.noteId || null);
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const idRef = useRef(noteId);
  idRef.current = noteId;

  const persist = useCallback((body) => {
    chain.current = chain.current.then(async () => {
      const b = body.trim();
      if (!b) return;
      setStatus('saving');
      try {
        if (idRef.current) await updateNote(clientId, idRef.current, { body: b });
        else {
          const r = await addNote(clientId, b);
          idRef.current = r.note.id;
          setNoteId(r.note.id);
        }
        writeDraft(clientId, { text: body, noteId: idRef.current });
        setStatus('saved');
        onSaved?.();
      } catch (e) {
        if (e && e.status === 404 && idRef.current) { idRef.current = null; setNoteId(null); }
        setStatus('error');
      }
    });
    return chain.current;
  }, [clientId, onSaved]);

  const change = (v) => {
    setText(v);
    writeDraft(clientId, { text: v, noteId: idRef.current });
    clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => persist(v), 900);
  };
  const done = async () => {
    clearTimeout(timer.current);
    if (text.trim()) await persist(text);
    setText(''); setNoteId(null); idRef.current = null; setStatus('idle');
    writeDraft(clientId, null);
  };
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  return { text, change, done, status, noteId };
}

function NoteItem({ n, clientId, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.body);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setText(n.body); }, [n.body, editing]);
  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try { await updateNote(clientId, n.id, { body: text.trim() }); setEditing(false); onChanged(); } catch (e) { toast.error(e.message || 'Couldn’t save'); }
    setSaving(false);
  };
  const pin = async () => {
    try { await updateNote(clientId, n.id, { pinned: !n.pinned }); onChanged(); } catch (e) { toast.error(e.message || 'Couldn’t pin'); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this note?', confirmLabel: 'Delete note', destructive: true }))) return;
    try { await deleteNote(clientId, n.id); onChanged(); } catch (e) { toast.error(e.message || 'Couldn’t delete'); }
  };
  return (
    <div className="kc-note km-row-in">
      {editing ? (
        <>
          <textarea className="km-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 8, fontSize: 14, fontWeight: 600 }}>
            <button type="button" onClick={() => setEditing(false)} style={{ color: 'var(--dim)' }}>Cancel</button>
            <button type="button" onClick={save} style={{ color: 'var(--green)' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      ) : (
        <>
          <div className="kc-note-body km-selectable">
            {n.pinned ? <Icon name="pin" size={13} color="var(--amber)" stroke={2.2} style={{ marginRight: 6, verticalAlign: '-1px' }} /> : null}
            {n.body}
          </div>
          <div className="kc-note-meta">
            <span>{formatDateTime(n.createdAt)}</span>
            {n.source && n.source !== 'agent' ? <span className="kc-tag kc-tag--mono" style={{ height: 18 }}>{n.source}</span> : null}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={pin} style={{ color: n.pinned ? 'var(--amber)' : 'var(--dim)' }}>{n.pinned ? 'Unpin' : 'Pin'}</button>
            <button type="button" onClick={() => setEditing(true)} style={{ color: 'var(--bright)' }}>Edit</button>
            <button type="button" onClick={remove} style={{ color: 'var(--red)' }}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function NotesTab({ client, onScroll, onFocusChange }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    listNotes(client.id).then((r) => { setNotes(r.notes || []); setError(null); }).catch((e) => setError(e.message || 'Couldn’t load notes'));
  }, [client.id]);
  useEffect(() => { load(); }, [load]);
  useSocket('activity_created', (p) => { if (p && p.clientId === client.id && p.type === 'note') load(); });
  const { text, change, done, status, noteId } = useAutoSave(client.id, load);

  const visible = (notes || []).filter((n) => n.id !== noteId);
  return (
    <div className="kc-pane" style={{ position: 'relative' }}>
      <div className="kc-pane-scroll km-scroll" onScroll={onScroll}>
        <div className="kc-pane-inner">
          <div className="kc-composer" style={{ marginTop: 6 }}>
            <textarea
              data-cc-text-input=""
              value={text}
              onChange={(e) => change(e.target.value)}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              placeholder={`Write a note about ${client.firstName || 'them'}… it saves as you type`}
              rows={3}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: status === 'error' ? 'var(--red)' : 'var(--faint)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {status === 'saving' ? <><Spinner size={12} /> Saving…</> : status === 'saved' ? <><Icon name="checkCircle" size={13} color="var(--green)" /> Saved</> : status === 'error' ? 'Couldn’t save — keep typing to retry' : 'Auto-saves'}
              </span>
              <button
                type="button"
                className="km-btn km-btn--sm"
                disabled={!text.trim()}
                onClick={async () => { await done(); toast.success('Note saved'); }}
              >
                Done
              </button>
            </div>
          </div>

          {error && !notes ? (
            <EmptyState icon="alert" title="Couldn’t load notes" sub={error} />
          ) : !notes ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
              {[0, 1, 2].map((i) => <div key={i}><Skeleton w={`${70 - i * 12}%`} h={13} /><Skeleton w="30%" h={10} style={{ marginTop: 8 }} /></div>)}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon="compose" title="No notes yet" sub="What did they say? What do they love? Write it down — it powers your briefings." />
          ) : (
            <div style={{ marginTop: 8 }}>
              {visible.map((n) => <NoteItem key={n.id} n={n} clientId={client.id} onChanged={load} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
