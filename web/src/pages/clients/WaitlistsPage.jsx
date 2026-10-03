// Waitlists — RevMatch "Allocation Requests", re-geared for real estate:
// priority queues of buyers for a building, community, release or off-market
// request. Editorial masthead, lists grouped by kind with mono counts (green
// while anyone is still waiting), accordion queues with drag-to-reorder,
// "got one" checkboxes, live criteria from each client's wishlist, swipe to
// remove, add via ClientPicker. Badge = waiting entries.
import { useCallback, useEffect, useRef, useState } from 'react';
import '../../styles/clients.css';
import PushPanel, { usePanel } from '../../components/ui/PushPanel';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import Avatar from '../../components/ui/Avatar';
import Sheet from '../../components/ui/Sheet';
import { EmptyState, Skeleton, TextInput, TextArea } from '../../components/ui/kit';
import { toast, confirm } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { bumpBadges } from '../../api/system';
import { useSocket, useResync } from '../../hooks/useSocket';
import {
  listWaitlists, getWaitlist, createWaitlist, updateWaitlist, deleteWaitlist, addWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry, reorderWaitlist,
} from '../../api/clients';
import ClientPicker from '../../components/client/ClientPicker';
import { clientStore } from '../../components/client/clientStore';
import { Seg, SwipeRow, ActionSheet, displayName } from '../../components/client/clientKit';

const KINDS = [
  { value: 'building', label: 'Buildings' },
  { value: 'community', label: 'Communities' },
  { value: 'release', label: 'Releases' },
  { value: 'off_market', label: 'Off-market' },
];
const KIND_ONE = { building: 'Building', community: 'Community', release: 'Release', off_market: 'Off-market' };
const TIER = { whale: 'var(--amber)', hot: 'var(--red)', warm: '#B89A4E' };
const pad = (n) => String(n).padStart(2, '0');

function ListSheet({ open, initial, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', kind: 'building', buildingName: '', neighborhood: '', description: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ name: initial?.name || '', kind: initial?.kind || 'building', buildingName: initial?.buildingName || '', neighborhood: initial?.neighborhood || '', description: initial?.description || '' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (close) => {
    if (!f.name.trim() || saving) return;
    setSaving(true);
    try {
      const body = { name: f.name.trim(), kind: f.kind, buildingName: f.buildingName.trim() || null, neighborhood: f.neighborhood.trim() || null, description: f.description.trim() || null };
      const r = initial?.id ? await updateWaitlist(initial.id, body) : await createWaitlist(body);
      onSaved?.(r.waitlist);
      close();
    } catch (e) { toast.error(e.message || 'Couldn’t save'); }
    setSaving(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={initial?.id ? 'Edit waitlist' : 'New waitlist'} zIndex={460}>
      {({ close }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 6 }}>
          <Seg value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v }))} options={KINDS.map((k) => ({ value: k.value, label: KIND_ONE[k.value] }))} />
          <TextInput label="Name" autoFocus value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Aman Miami Beach — residences" />
          <div className="kc-grid2">
            <TextInput label="Building / project" value={f.buildingName} onChange={(e) => setF((x) => ({ ...x, buildingName: e.target.value }))} placeholder="Aman Miami Beach" />
            <TextInput label="Neighborhood" value={f.neighborhood} onChange={(e) => setF((x) => ({ ...x, neighborhood: e.target.value }))} placeholder="Mid-Beach" />
          </div>
          <TextArea label="Notes" rows={2} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} placeholder="Second release expected Q1 · 18 residences" />
          {initial?.id ? <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Everyone already in line stays in line, in the same order.</div> : null}
          <button type="button" className="km-btn km-btn--block km-btn--lg" disabled={!f.name.trim() || saving} onClick={() => save(close)}>{saving ? 'Saving…' : initial?.id ? 'Save' : 'Create waitlist'}</button>
        </div>
      )}
    </Sheet>
  );
}

function QueueRow({ e, idx, wl, lifted, shift, onGrip, onToggle, onRemove, openSwipe, setOpenSwipe, onNotes }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(e.notes || '');
  const done = e.status === 'got_one';
  const c = e.client;
  return (
    <SwipeRow id={e.id} openId={openSwipe} setOpenId={setOpenSwipe} actions={[{ label: 'Remove', color: 'var(--red)', bg: 'transparent', onClick: () => onRemove(e) }]} fullSwipe={() => onRemove(e)}>
      <div
        className={`kc-q ${done ? 'kc-q--done' : ''} ${lifted ? 'kc-q--lift' : ''}`}
        data-q={e.id}
        style={{ transform: lifted ? `translate3d(0, ${lifted}px, 0) scale(1.02)` : shift ? `translate3d(0, ${shift}px, 0)` : undefined, transition: lifted ? 'none' : 'transform .22s var(--km-ease), box-shadow .2s' }}
      >
        <span className="kc-grip" onPointerDown={(ev) => onGrip(ev, e, idx)} aria-label="Drag to reorder"><Icon name="menu" size={15} /></span>
        <span className={`kc-q-rank ${idx === 0 ? 'kc-q-rank--first' : ''}`}>{pad(idx + 1)}</span>
        <button type="button" className="kc-q-box" onClick={() => onToggle(e)} aria-label={done ? 'Mark waiting' : 'Mark got one'} aria-pressed={done}>
          <span className={done ? 'kc-on' : ''}>{done ? <Icon name="check" size={13} stroke={3} /> : null}</span>
        </button>
        <button type="button" style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }} onClick={() => { clientStore.seed(c); nav.openClient(c.id); }}>
          <Avatar name={displayName(c)} seed={c.id} src={c.avatarUrl} size={34} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="km-truncate" style={{ fontSize: 16, fontWeight: 500, textDecoration: done ? 'none' : 'none' }}>{displayName(c)}</span>
              {e.tier ? <span className="kc-dot" style={{ width: 5, height: 5, background: TIER[e.tier] }} title={e.tier} /> : null}
              {done ? <span className="kc-tag kc-tag--mono kc-tag--green" style={{ height: 17 }}>Got one</span> : null}
            </span>
            <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: e.criteria ? 'var(--dim)' : 'var(--faint)', marginTop: 2 }}>
              {e.criteria ? e.criteria.text : 'No wishlist yet — just their spot in line'}
            </span>
          </span>
        </button>
      </div>
      {(e.notes || editing) ? (
        <div style={{ padding: '0 20px 10px 88px', background: 'var(--bg)' }}>
          {editing ? (
            <input className="km-input" autoFocus value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={() => { setEditing(false); if ((note || '') !== (e.notes || '')) onNotes(e, note); }} onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); }} style={{ minHeight: 36, padding: '6px 10px', fontSize: 16 }} />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)', display: 'block', maxWidth: '100%', textAlign: 'left' }}>“{e.notes}”</button>
          )}
        </div>
      ) : null}
    </SwipeRow>
  );
}

function Queue({ wl, onChanged }) {
  const [entries, setEntries] = useState(wl.entries || []);
  const [drag, setDrag] = useState(null);
  const [openSwipe, setOpenSwipe] = useState(null);
  const [pick, setPick] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const dragRef = useRef(null);
  useEffect(() => { if (!dragRef.current) setEntries(wl.entries || []); }, [wl]);

  const onGrip = (ev, e, idx) => {
    ev.preventDefault();
    const row = ev.currentTarget.closest('[data-q]');
    const h = row ? row.getBoundingClientRect().height : 64;
    const target = ev.currentTarget;
    try { target.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    const st = { id: e.id, idx, startY: ev.clientY, dy: 0, h, to: idx };
    dragRef.current = st;
    setDrag({ ...st });
    const move = (m) => {
      const s = dragRef.current;
      if (!s) return;
      s.dy = m.clientY - s.startY;
      s.to = Math.max(0, Math.min(entries.length - 1, s.idx + Math.round(s.dy / s.h)));
      setDrag({ ...s });
    };
    const up = async () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const s = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!s || s.to === s.idx) return;
      const next = [...entries];
      const [moved] = next.splice(s.idx, 1);
      next.splice(s.to, 0, moved);
      const prev = entries;
      setEntries(next);
      try { await reorderWaitlist(wl.id, next.map((x) => x.id)); onChanged(); } catch (err) { setEntries(prev); toast.error(err.message || 'Couldn’t reorder'); }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const shiftFor = (i) => {
    if (!drag || i === drag.idx) return 0;
    if (drag.to > drag.idx && i > drag.idx && i <= drag.to) return -drag.h;
    if (drag.to < drag.idx && i < drag.idx && i >= drag.to) return drag.h;
    return 0;
  };

  const toggle = async (e) => {
    const status = e.status === 'got_one' ? 'waiting' : 'got_one';
    setEntries((xs) => xs.map((x) => (x.id === e.id ? { ...x, status } : x)));
    try { await updateWaitlistEntry(wl.id, e.id, { status }); bumpBadges(); onChanged(); if (status === 'got_one') toast.success(`${displayName(e.client)} got one`); }
    catch (err) { setEntries((xs) => xs.map((x) => (x.id === e.id ? e : x))); toast.error(err.message || 'Couldn’t update'); }
  };
  const remove = async (e) => {
    if (!(await confirm({ title: `Remove ${displayName(e.client)} from ${wl.name}?`, confirmLabel: 'Remove', destructive: true }))) return;
    const prev = entries;
    setEntries((xs) => xs.filter((x) => x.id !== e.id));
    try { await removeWaitlistEntry(wl.id, e.id); bumpBadges(); onChanged(); } catch (err) { setEntries(prev); toast.error(err.message || 'Couldn’t remove'); }
  };
  const saveNotes = async (e, notes) => {
    setEntries((xs) => xs.map((x) => (x.id === e.id ? { ...x, notes } : x)));
    try { await updateWaitlistEntry(wl.id, e.id, { notes: notes || null }); } catch (err) { toast.error(err.message || 'Couldn’t save'); }
  };
  const add = async (c) => {
    try { await addWaitlistEntry(wl.id, { clientId: c.id }); bumpBadges(); toast.success(`${displayName(c)} joined the line`); onChanged(); }
    catch (err) { toast.error(err.message || 'Couldn’t add'); }
  };
  const removeList = async () => {
    if (!(await confirm({ title: `Delete “${wl.name}”?`, message: `${entries.length} ${entries.length === 1 ? 'client' : 'clients'} leave this line. This can’t be undone.`, confirmLabel: 'Delete waitlist', destructive: true }))) return;
    try { await deleteWaitlist(wl.id); bumpBadges(); onChanged(true); } catch (err) { toast.error(err.message || 'Couldn’t delete'); }
  };
  const disabled = Object.fromEntries(entries.map((e, i) => [e.client.id, `Already #${i + 1} in line`]));

  return (
    <div style={{ paddingBottom: 6 }}>
      {wl.description ? <div style={{ padding: '2px 20px 10px', fontSize: 13, color: 'var(--dim)' }}>{wl.description}</div> : null}
      {entries.length === 0 ? (
        <div style={{ padding: '6px 20px 12px', fontSize: 13.5, color: 'var(--faint)' }}>Nobody in line yet. Add the clients who asked first — order is priority.</div>
      ) : entries.map((e, i) => (
        <QueueRow key={e.id} e={e} idx={i} wl={wl} lifted={drag && drag.id === e.id ? drag.dy || 0.01 : 0} shift={shiftFor(i)} onGrip={onGrip} onToggle={toggle} onRemove={remove} openSwipe={openSwipe} setOpenSwipe={setOpenSwipe} onNotes={saveNotes} />
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px 4px' }}>
        <button type="button" className="kc-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--amber)' }} onClick={() => setPick(true)}><Icon name="userPlus" size={15} /> Add a client</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setMenu(true)} aria-label="List options" style={{ color: 'var(--dim)', display: 'flex' }}><Icon name="more" size={20} /></button>
      </div>
      <ClientPicker open={pick} onClose={() => setPick(false)} onPick={add} title={`${wl.name} · add to the line`} disabled={disabled} />
      <ActionSheet open={menu} title={wl.name} onClose={() => setMenu(false)} actions={[
        { label: 'Edit waitlist', icon: 'edit', onClick: () => setEdit(true) },
        ...KINDS.filter((k) => k.value !== wl.kind).map((k) => ({ label: `Move to ${k.label}`, icon: 'arrowRight', onClick: async () => { try { await updateWaitlist(wl.id, { kind: k.value }); onChanged(); } catch (err) { toast.error(err.message); } } })),
        { label: 'Delete waitlist', icon: 'trash', danger: true, onClick: removeList },
      ]} />
      <ListSheet open={edit} initial={wl} onClose={() => setEdit(false)} onSaved={() => onChanged()} />
    </div>
  );
}

function FloatingBar({ onAdd }) {
  const { requestClose } = usePanel();
  return (
    <div className="km-scroll-edge" style={{ position: 'relative', zIndex: 5, flexShrink: 0, display: 'flex', justifyContent: 'space-between', padding: 'calc(var(--safe-top) + 8px) 12px 4px' }}>
      <GlassButton icon="chevronLeft" label="Back" onClick={requestClose} />
      <GlassButton icon="plus" label="New waitlist" onClick={onAdd} style={{ color: 'var(--amber)' }} />
    </div>
  );
}

export default function WaitlistsPage({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    listWaitlists().then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message || 'Couldn’t load waitlists'));
  }, []);
  const loadDetail = useCallback((id) => {
    getWaitlist(id).then((r) => setDetails((d) => ({ ...d, [id]: r.waitlist }))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (openId) loadDetail(openId); }, [openId, loadDetail]);
  const refresh = (deleted) => { load(); if (openId && !deleted) loadDetail(openId); if (deleted) setOpenId(null); };
  useSocket('waitlist_updated', (p) => { load(); if (p && p.id && p.id === openId) loadDetail(p.id); });
  useSocket('client_updated', () => { if (openId) loadDetail(openId); });
  useResync(() => refresh());

  const lists = data?.waitlists || [];
  const waiting = data?.totalWaiting || 0;
  const clientsOn = new Set();
  for (const w of lists) for (const f of w.faces || []) clientsOn.add(f.id);

  return (
    <PushPanel onClose={onClose} header={<FloatingBar onAdd={() => setCreating(true)} />}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="kc-wl-mast">
          <div className="kc-eyebrow" style={{ color: 'var(--amber)', letterSpacing: '0.16em' }}>Priority access</div>
          <div className="kc-wl-h1">Waitlists</div>
          <div className="kc-wl-sum">{data ? `${lists.length} ${lists.length === 1 ? 'list' : 'lists'} · ${waiting} ${waiting === 1 ? 'client' : 'clients'} waiting · criteria from each client’s wishlist` : 'Loading…'}</div>
        </div>

        {error && !data ? (
          <EmptyState icon="alert" title="Couldn’t load waitlists" sub={error} />
        ) : !data ? (
          <div style={{ padding: '20px' }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={58} r={12} style={{ marginBottom: 12 }} />)}</div>
        ) : lists.length === 0 ? (
          <EmptyState icon="checklist" title="No waitlists yet" sub="Queue buyers for a tower release, a gated community or an off-market request — first in line, first call." action={<button type="button" className="km-btn km-btn--sm" onClick={() => setCreating(true)}>New waitlist</button>} />
        ) : KINDS.map((k) => {
          const group = lists.filter((w) => (w.kind || 'building') === k.value);
          if (!group.length) return null;
          return (
            <section key={k.value} className="kc-wl-group">
              <div className="kc-wl-ghead">
                <span className="kc-eyebrow" style={{ color: 'var(--amber)' }}>{k.label}</span>
                <span className="kc-mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{pad(group.length)} {group.length === 1 ? 'list' : 'lists'}</span>
              </div>
              {group.map((w) => {
                const open = openId === w.id;
                const allPlaced = w.count > 0 && w.waitingCount === 0;
                return (
                  <div key={w.id}>
                    <button type="button" className="kc-wl-row km-press" onClick={() => setOpenId(open ? null : w.id)} aria-expanded={open}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="kc-wl-name kc-clamp2" style={{ display: 'block' }}>{w.name}</span>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 3 }}>
                          {[w.buildingName && w.buildingName !== w.name ? w.buildingName : null, w.neighborhood].filter(Boolean).join(' · ') || KIND_ONE[w.kind || 'building']}
                        </span>
                      </span>
                      {(w.faces || []).length ? (
                        <span style={{ display: 'flex' }}>
                          {w.faces.slice(0, 3).map((f, i) => <Avatar key={f.id} name={f.name} seed={f.id} src={f.avatarUrl} size={26} style={{ marginLeft: i ? -9 : 0, boxShadow: '0 0 0 2px var(--bg)', zIndex: 3 - i }} />)}
                        </span>
                      ) : null}
                      <span className="kc-wl-count" style={{ color: w.count === 0 ? 'var(--faint)' : allPlaced ? 'var(--red)' : 'var(--green)', textShadow: 'none' }}>{pad(w.waitingCount)}</span>
                      <Icon name="chevronRight" size={15} color="var(--faint)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .28s var(--km-ease)' }} />
                    </button>
                    <div className={`kc-acc ${open ? 'kc-acc--open' : ''}`}>
                      <div>
                        {open ? (details[w.id] ? <Queue wl={details[w.id]} onChanged={refresh} /> : <div style={{ padding: '10px 20px' }}><Skeleton h={50} r={10} /></div>) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <ListSheet open={creating} onClose={() => setCreating(false)} onSaved={(w) => { load(); if (w) setOpenId(w.id); }} />
    </PushPanel>
  );
}
