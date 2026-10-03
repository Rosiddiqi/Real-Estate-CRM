// TodoPanel — the To-Do list (RevMatch LoopsStrip, rebuilt). One standing list
// that isn't tied to a day: today's + tomorrow's plan merged and de-duplicated.
//
//   YOUR LIST       only things the agent put there (typed, told Serena, or
//                   tapped Add). Ranked by urgency band, then expected value.
//                   Tap the circle = done · swipe left = remove.
//   SERENA SUGGESTS everything the AI picked up, ONE per person, best 3 shown
//                   ("Show N more"). Each says where it came from (reason chip
//                   + a plain sentence). Add · 👍 (✓ TRAINED) · 👎 (Tell AI why)
//                   · quick Call / Text.
//   DONE TODAY      collapsible; tap the green check to reopen.
//
// Contract (Serena's popup renders this):
//   <TodoPanel onNavigate={() => closeHostSheet()} />
// `onNavigate` is called before any navigation (client card, call, thread) so
// the host sheet can get out of the way.
import { useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { nav } from '../../lib/nav';
import { KIND_COLOR, alpha } from '../calendar/appointmentTypes';
import SwipeToRemove from './SwipeToRemove';
import TileDetailSheet from './TileDetailSheet';
import TrainAiSheet from './TrainAiSheet';
import useTodoBoard from './useTodoBoard';
import { moveScore, rankTodos } from './ranking';
import { dateKey, shiftKey, keyToDate, agentTz } from './time';
import '../../styles/dashboard.css';
import useAgentTz from './useAgentTz';
import { useAssistant } from '../../hooks/useAssistant';

const SUGGEST_VISIBLE = 3;
const REASON_COLOR = {
  reply: 'var(--green)', match: 'var(--violet)', offmarket: 'var(--violet)', lease: 'var(--blue)', equity: 'var(--green)',
  anniversary: 'var(--amber)', birthday: 'var(--pink)', search: 'var(--blue)', pipeline: 'var(--red)', showing: 'var(--amber)',
  silence: 'var(--bp-t2)', internal: 'var(--bp-t2)',
};

function dayLabel(key) {
  return keyToDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function taskMeta(t) {
  const parts = [];
  let hot = false;
  const today = dateKey();
  if (t.rolledOver && t.dueKey) { parts.push(`Rolled over · from ${dayLabel(t.dueKey)}`); hot = true; } else if (t.dueAt) {
    const due = new Date(t.dueAt);
    const overdue = due.getTime() < Date.now();
    const label = due.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: agentTz() });
    parts.push(overdue ? `Overdue · ${label}` : `Due ${label}`);
    hot = overdue;
  } else if (t.dueKey) {
    if (t.dueKey === today) parts.push('Today');
    else if (t.dueKey === shiftKey(today, 1)) parts.push('Tomorrow');
    else if (t.dueKey < today) { parts.push(`Overdue · ${dayLabel(t.dueKey)}`); hot = true; } else parts.push(`Due ${dayLabel(t.dueKey)}`);
  } else if (t.createdAt) {
    const ck = dateKey(new Date(t.createdAt));
    const days = Math.round((keyToDate(today) - keyToDate(ck)) / 864e5);
    if (days === 1) parts.push('Since yesterday');
    else if (days > 1 && days < 7) parts.push(`Since ${keyToDate(ck).toLocaleDateString('en-US', { weekday: 'long' })}`);
    else if (days >= 7) parts.push(`Since ${keyToDate(ck).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  }
  if (t.priority === 2) { parts.unshift('Urgent'); hot = true; } else if (t.priority === 1) { parts.unshift('High priority'); hot = true; }
  const name = t.client && t.client.name;
  if (name) parts.unshift(name);
  return { text: parts.join(' · '), hot };
}

function Spine({ color, glow }) {
  return (
    <>
      <div className="bp-spine" style={{ background: color, boxShadow: glow ? `0 0 8px ${alpha(color, 50)}` : 'none' }} />
      {glow ? <div className="bp-wash" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${color}, transparent 70%)` }} /> : null}
    </>
  );
}

function Label({ children, color = 'var(--bp-t2)', right = null }) {
  return (
    <div className="td-label" style={{ color }}>
      <span>{children}</span>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function AddTodoBox({ onAdd }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const ready = text.trim().length > 0 && !busy;
  const submit = async (e) => {
    e?.preventDefault();
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    setText('');
    try { await onAdd(title); } catch { setText(title); } finally { setBusy(false); inputRef.current?.focus(); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px 2px' }}>
      <input
        ref={inputRef}
        className="td-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a to-do…"
        enterKeyHint="done"
        aria-label="Add a to-do"
      />
      <button
        type="submit"
        className="td-plus"
        disabled={!ready}
        aria-label="Add to-do"
        style={{
          border: `var(--hairline) solid ${ready ? 'var(--hl)' : 'var(--bp-hair2)'}`,
          background: ready ? 'var(--hl)' : 'transparent',
          color: ready ? 'var(--on-hl)' : 'var(--bp-t3)',
        }}
      >
        <Icon name="plus" size={18} stroke={2.6} />
      </button>
    </form>
  );
}

function MyRow({ task, onDone, onRemove, onOpen }) {
  const meta = taskMeta(task);
  const whale = task.ev ? task.ev.whale : (task.client && task.client.isWhale);
  return (
    <div data-bp-item={`task-${task.id}`} style={{ marginBottom: 8, opacity: task.pendingSave ? 0.7 : 1, transition: 'opacity 0.2s' }} className="km-row-in">
      <SwipeToRemove onRemove={onRemove}>
        <div className="bp-tile" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px 12px 16px' }}>
          <Spine color={meta.hot ? 'var(--bp-amber)' : 'var(--bp-t3)'} glow={false} />
          <button
            type="button"
            className="td-circle"
            onClick={(e) => { e.stopPropagation(); onDone(); }}
            aria-label="Mark done"
            style={{ border: `1.2px solid ${meta.hot ? 'var(--bp-amber)' : 'var(--bp-t3)'}` }}
          />
          <div onClick={onOpen || undefined} style={{ flex: 1, minWidth: 0, cursor: onOpen ? 'pointer' : 'default' }}>
            <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--bp-t1)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
              {whale ? <Icon name="crown" size={12} color="var(--text)" style={{ marginRight: 5, verticalAlign: '-1px' }} /> : null}
              {task.title}
            </div>
            {meta.text ? (
              <div className="km-truncate" style={{ fontSize: 12, color: meta.hot ? 'var(--bp-amber)' : 'var(--bp-t3)', marginTop: 4 }}>{meta.text}</div>
            ) : null}
          </div>
        </div>
      </SwipeToRemove>
    </div>
  );
}

function SuggestionRow({ s, onAdd, onDismiss, onOpen }) {
  const { name: assistant } = useAssistant();
  const why = s.notes || (s.client ? `${s.client.name} · ${assistant} picked this up from a text or call` : `${assistant} picked this up from a text or call`);
  return (
    <div data-bp-item={`sugg-${s.id}`} className="bp-tile km-row-in" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 16px', marginBottom: 8 }}>
      <Spine color="var(--violet)" glow={false} />
      <div onClick={onOpen || undefined} style={{ flex: 1, minWidth: 0, cursor: onOpen ? 'pointer' : 'default' }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--bp-t1)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{s.title}</div>
        <div className="km-clamp-2" style={{ fontSize: 12, color: 'var(--bp-t2)', marginTop: 4, lineHeight: 1.4 }}>{why}</div>
      </div>
      <button type="button" className="td-btn td-iconbtn" onClick={onDismiss} aria-label="Dismiss suggestion" style={{ border: '1px solid var(--bp-hair2)', color: 'var(--bp-t2)' }}>
        <Icon name="x" size={14} stroke={2.2} />
      </button>
      <button type="button" className="td-btn" onClick={onAdd} style={{ background: 'var(--hl)', color: 'var(--on-hl)' }}>Add</button>
    </div>
  );
}

function MoveRow({ m, flash, onAdd, onGood, onBad, onOpen, onCall, onText }) {
  const rc = REASON_COLOR[m.src] || 'var(--bp-t2)';
  const sentence = m.reasonSentence || 'Suggested follow-up';
  const detail = (m.why || m.sub || '').trim();
  return (
    <div data-bp-item={`move-${m.id}`} className="bp-tile km-row-in" style={{ padding: '12px 12px 10px 16px', marginBottom: 8 }}>
      <Spine color="var(--violet)" glow={false} />
      <div onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, minWidth: 0 }}>
          <span className="td-reason" style={{ color: rc, background: alpha(rc, 13), border: `1px solid ${alpha(rc, 28)}` }}>{m.reasonLabel || 'FOLLOW-UP'}</span>
          {m.whale ? <Icon name="crown" size={12} color="var(--text)" /> : null}
          {m.date && m.date !== dateKey() ? <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: 0.8, color: 'var(--bp-t3)' }}>TOMORROW</span> : null}
          <span style={{ flex: 1 }} />
          {flash === 'trained' ? <span className="td-trained">✓ TRAINED</span> : null}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--bp-t1)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{m.title}</div>
        <div className="km-clamp-2" style={{ fontSize: 12, color: 'var(--bp-t2)', marginTop: 4, lineHeight: 1.4 }}>
          {sentence}{detail && detail !== m.title ? ` · ${detail}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        {m.phone ? (
          <button type="button" className="td-btn" onClick={onCall} style={{ height: 30, padding: '0 12px', fontSize: 12, background: 'var(--hl)', color: 'var(--on-hl)', fontWeight: 500 }}>
            <Icon name="phone" size={12} stroke={2.4} /> Call
          </button>
        ) : null}
        {m.canText ? (
          <button type="button" className="td-btn" onClick={onText} style={{ height: 30, padding: '0 10px', fontSize: 12, background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)', color: 'var(--bp-t1)' }}>
            <Icon name="message" size={12} stroke={2.2} /> Text
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {flash === 'added' ? (
          <span className="td-trained" style={{ color: 'var(--hl-ink)' }}>Added</span>
        ) : (
          <>
            <button type="button" className="td-btn td-iconbtn" onClick={onGood} aria-label="Good suggestion" style={{ height: 32, width: 32, border: '1px solid var(--bp-hair2)', color: flash === 'trained' ? 'var(--violet)' : 'var(--bp-t2)' }}>
              <Icon name="thumbsUp" size={14} stroke={2} />
            </button>
            <button type="button" className="td-btn td-iconbtn" onClick={onBad} aria-label="Tell AI why this is off" style={{ height: 32, width: 32, border: '1px solid var(--bp-hair2)', color: 'var(--bp-t2)' }}>
              <Icon name="thumbsDown" size={14} stroke={2} />
            </button>
            <button type="button" className="td-btn" onClick={onAdd} style={{ height: 32, background: 'var(--hl)', color: 'var(--on-hl)' }}>Add</button>
          </>
        )}
      </div>
    </div>
  );
}

function SkeletonTiles() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      {[0, 1, 2].map((i) => <div key={i} className="km-skel" style={{ height: 58, borderRadius: 13 }} />)}
    </div>
  );
}

export default function TodoPanel({ onNavigate, style }) {
  const { name: assistant } = useAssistant();
  useAgentTz();
  const board = useTodoBoard();
  const [showAll, setShowAll] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [train, setTrain] = useState(null);

  const go = (fn) => {
    if (onNavigate) { onNavigate(); setTimeout(fn, 260); } else fn();
  };

  const mine = useMemo(() => rankTodos(board.tasks || []), [board.tasks]);

  // One per person: a specific captured suggestion beats a planner move; best first.
  const suggestions = useMemo(() => {
    const byPerson = new Map();
    const loose = [];
    const put = (key, item) => {
      if (!key) { loose.push(item); return; }
      const prev = byPerson.get(key);
      if (!prev || (prev.kind === 'move' && item.kind === 'suggested') || (prev.kind === item.kind && item.score > prev.score)) byPerson.set(key, item);
    };
    for (const s of board.suggested || []) put(s.clientId ? `c:${s.clientId}` : null, { kind: 'suggested', score: moveScore({ ...s, stars: s.ev && s.ev.rating }) * 1.1, row: s });
    for (const m of board.moves || []) put(m.clientId ? `c:${m.clientId}` : null, { kind: 'move', score: moveScore(m), row: m });
    return [...byPerson.values(), ...loose].sort((a, b) => b.score - a.score);
  }, [board.suggested, board.moves]);
  const shown = showAll ? suggestions : suggestions.slice(0, SUGGEST_VISIBLE);
  const hidden = suggestions.length - shown.length;

  const openClient = (id) => go(() => nav.openClient(id));
  const call = (m) => {
    go(() => nav.call({ clientId: m.clientId, phone: m.phone, name: m.clientName }));
    setTimeout(() => board.moveDone(m, 'Call placed — marked done'), 600);
  };
  const text = (m) => go(() => nav.openThread({ clientId: m.clientId, name: m.clientName }));

  const empty = board.status === 'ready' && !mine.length && !suggestions.length && !(board.done || []).length;

  return (
    <div style={{ padding: '0 16px 12px', ...style }}>
      <AddTodoBox onAdd={board.add} />

      {board.status === 'loading' && !mine.length ? <SkeletonTiles /> : null}
      {board.status === 'error' && !mine.length ? (
        <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--bp-t3)', fontSize: 13 }}>
          Couldn’t load your list.{' '}
          <button type="button" onClick={board.reload} style={{ color: 'var(--bright)', fontWeight: 500 }}>Try again</button>
        </div>
      ) : null}

      {empty ? (
        <div className="km-empty" style={{ padding: '36px 16px 20px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <Icon name="checkCircle" size={28} color="var(--bp-done)" />
          </div>
          <div className="km-empty-title">You’re all clear</div>
          <div className="km-empty-sub">No open to-dos or moves right now. Type one above, or new ones land here as they come up.</div>
        </div>
      ) : null}

      {board.status !== 'loading' && !empty ? (
        <>
          <Label right={(board.done || []).length ? <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bp-done)', letterSpacing: 0, textTransform: 'none' }}>{board.done.length} done today</span> : null}>
            Your list{mine.length ? ` · ${mine.length}` : ''}
          </Label>
          {!mine.length ? (
            <div style={{ fontSize: 14, color: 'var(--bp-t3)', padding: '4px 2px 8px' }}>Nothing on your list. Type one above, or add one {assistant} suggests.</div>
          ) : null}
          {mine.map((t, i) => (
            <div key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <MyRow
                task={t}
                onDone={() => board.complete(t)}
                onRemove={() => board.remove(t)}
                onOpen={t.clientId ? () => openClient(t.clientId) : null}
              />
            </div>
          ))}
        </>
      ) : null}

      {suggestions.length ? (
        <>
          <Label color="var(--hl-ink)" right={<Icon name="sparkle" size={12} color="var(--hl-ink)" />}>{assistant} suggests</Label>
          {shown.map((it) => (it.kind === 'suggested' ? (
            <SuggestionRow
              key={`s-${it.row.id}`}
              s={it.row}
              onAdd={() => board.approveSuggested(it.row)}
              onDismiss={() => board.dismissSuggested(it.row)}
              onOpen={it.row.clientId ? () => openClient(it.row.clientId) : null}
            />
          ) : (
            <MoveRow
              key={`m-${it.row.id}`}
              m={it.row}
              flash={board.flash[it.row.id]}
              onAdd={() => board.addMove(it.row)}
              onGood={() => board.trainGood(it.row)}
              onBad={() => setTrain(it.row)}
              onOpen={() => setDetail(it.row)}
              onCall={() => call(it.row)}
              onText={() => text(it.row)}
            />
          )))}
          {suggestions.length > SUGGEST_VISIBLE ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ display: 'block', width: '100%', minHeight: 44, fontSize: 14, fontWeight: 500, color: 'var(--hl-ink)' }}>
              {showAll ? 'Show fewer' : `Show ${hidden} more`}
            </button>
          ) : null}
        </>
      ) : null}

      {(board.done || []).length ? (
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => setDoneOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44, padding: '0 2px' }} aria-expanded={doneOpen}>
            <Icon name="check" size={14} color="var(--bp-done)" stroke={2.6} />
            <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 1.1, color: 'var(--bp-done)', textTransform: 'uppercase' }}>Done today · {board.done.length}</span>
            <span style={{ flex: 1 }} />
            <Icon name="chevronDown" size={13} color="var(--bp-t3)" stroke={2.4} style={{ transform: doneOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
          </button>
          {doneOpen ? board.done.map((t) => (
            <div key={t.id} className="km-row-in" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', marginTop: 4, borderRadius: 10, background: 'rgba(var(--hl-rgb), 0.07)' }}>
              <button type="button" className="td-circle" onClick={() => board.reopen(t)} aria-label="Reopen — not done after all" style={{ background: 'var(--hl)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={12} color="var(--on-hl)" stroke={2.6} />
              </button>
              <div className="km-truncate" style={{ flex: 1, fontSize: 14, color: 'var(--bp-t2)', textDecoration: 'line-through' }}>{t.title}</div>
            </div>
          )) : null}
        </div>
      ) : null}

      <TileDetailSheet
        open={!!detail}
        item={detail ? { ...detail, isMove: true, moveId: detail.id, kind: detail.channel === 'call' ? 'call' : 'text' } : null}
        onClose={() => setDetail(null)}
        onComplete={(m) => { setDetail(null); return board.moveDone(m); }}
        onRetime={(m, s, d) => board.moveRetime(m, s, d)}
        onCall={(m) => call(m)}
        onText={(m) => text(m)}
        onOpenClient={(id) => openClient(id)}
        zIndex={470}
      />
      <TrainAiSheet open={!!train} move={train} onClose={() => setTrain(null)} onSubmit={(p) => board.trainBad(p)} zIndex={480} />
    </div>
  );
}
