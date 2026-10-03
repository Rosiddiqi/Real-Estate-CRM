// TileDetailSheet — detail pop-up for a non-appointment rail tile (content
// block, lunch, routine) or an AI move from the To-Do list. Complete /
// Message / Call, the AI's "why", a slot editor with a live conflict preview,
// and the Coach AI box ("tell the AI how to handle this client").
import { useEffect, useMemo, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { toast } from '../ui/toast';
import { coachClient } from '../../api/battlePlan';
import { KIND_COLOR, alpha } from '../calendar/appointmentTypes';
import { fmtMin, durLabel, minToHHMM, hhmmToMin } from './time';

const KIND_LABEL = {
  call: 'Call', text: 'Text', content: 'Content', personal: 'Personal', lunch: 'Lunch', routine: 'Routine', match: 'Match', prep: 'Prep', ai: 'AI move',
};
const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];

function CoachAI({ item, onCoached }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const who = item.firstName || (item.clientName || '').split(' ')[0] || 'this client';
  const save = async () => {
    const v = note.trim();
    if (!v || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await coachClient({ clientId: item.clientId, note: v, moveId: item.moveId || undefined });
      if (r && r.handled) {
        setResult(r.action === 'defer'
          ? `Got it — holding off on ${who} for about ${r.durationDays} day${r.durationDays === 1 ? '' : 's'}. Saved why.`
          : `Got it — I won't suggest ${who} again. Saved why.`);
        onCoached?.(r);
      } else {
        setResult('Saved — the AI will use this for future plans.');
      }
      setNote('');
      setTimeout(() => setResult(null), 4500);
    } catch {
      setErr('Could not save — try again.');
    } finally {
      setBusy(false);
    }
  };
  const ready = !!note.trim() && !busy;
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: alpha('var(--violet)', 8), border: `1px solid ${alpha('var(--violet)', 30)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon name="sparkle" size={12} color="var(--violet)" stroke={2.2} />
        <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: 1.4, color: 'var(--violet)' }}>COACH AI</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--bp-t2)', lineHeight: '16px', marginBottom: 8 }}>
        Tell the AI how to handle {who} — where they are in your process and what to do next. It learns this for future plans.
      </div>
      <textarea
        className="km-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={'e.g. "Ready to write on the Bel Air estate. Push a second showing this week, then talk terms."'}
        style={{ minHeight: 76, fontSize: 16, padding: '10px 12px' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="km-press"
          onClick={save}
          disabled={!ready}
          style={{
            padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: ready ? 'linear-gradient(135deg, var(--violet), color-mix(in srgb, var(--violet) 70%, #000))' : 'var(--bp-fill)',
            color: ready ? '#fff' : 'var(--bp-t3)',
          }}
        >{busy ? 'Saving…' : 'Train AI'}</button>
        {result ? <span style={{ fontSize: 12, color: 'var(--bp-done)', fontWeight: 500 }}>✓ {result}</span> : null}
        {err ? <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span> : null}
      </div>
    </div>
  );
}

function SlotEditor({ item, others = [], onSave }) {
  const [start, setStart] = useState(minToHHMM(item.startMin ?? 540));
  const [dur, setDur] = useState(item.durationMin || 30);
  const s = hhmmToMin(start);
  const conflicts = useMemo(() => {
    if (s == null) return [];
    return others.filter((o) => o.id !== item.id && o.startMin != null && o.startMin < s + dur && o.startMin + (o.durationMin || 30) > s);
  }, [others, s, dur, item.id]);
  const idx = DURATIONS.indexOf(dur);
  const stepDur = (d) => {
    const i = idx < 0 ? DURATIONS.findIndex((x) => x >= dur) : idx;
    setDur(DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, i + d))]);
  };
  const stepBtn = { width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)', color: 'var(--bp-t1)' };
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)' }}>
      <div style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: 1.4, color: 'var(--bp-t3)', marginBottom: 8 }}>EDIT SLOT</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="time" className="km-input" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 132, minHeight: 40, padding: '8px 10px' }} aria-label="Start time" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="km-press" style={stepBtn} onClick={() => stepDur(-1)} aria-label="Shorter"><Icon name="minus" size={15} /></button>
          <span className="bp-num" style={{ minWidth: 54, textAlign: 'center', fontSize: 14, fontWeight: 500 }}>{durLabel(dur)}</span>
          <button type="button" className="km-press" style={stepBtn} onClick={() => stepDur(1)} aria-label="Longer"><Icon name="plus" size={15} /></button>
        </div>
      </div>
      <div className="bp-num" style={{ fontSize: 12, color: 'var(--bp-t2)', marginTop: 8 }}>{s != null ? `${fmtMin(s)} → ${fmtMin(s + dur)}` : 'Pick a start time'}</div>
      {conflicts.length ? (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(255, 180, 64, 0.10)', border: '1px solid rgba(255, 180, 64, 0.35)' }}>
          <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1.2, color: 'var(--amber)', marginBottom: 3 }}>! OVERLAPS WITH</div>
          {conflicts.slice(0, 3).map((c) => (
            <div key={c.id} className="km-truncate" style={{ fontSize: 12, color: 'var(--bp-t2)' }}>{fmtMin(c.startMin)} · {c.title}</div>
          ))}
        </div>
      ) : null}
      <button type="button" className="km-btn km-btn--sm" style={{ marginTop: 10, width: '100%' }} disabled={s == null} onClick={() => onSave?.(s, dur)}>Save slot</button>
    </div>
  );
}

export default function TileDetailSheet({ open, item, onClose, onComplete, onRetime, onCall, onText, onOpenClient, others, zIndex = 450 }) {
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (open) { setDone(item && item.status === 'done'); setEditing(false); } }, [open, item]);
  if (!item) return null;
  const kindKey = item.lunch ? 'personal' : item.routine ? 'personal' : item.kind;
  const c = KIND_COLOR[kindKey] || KIND_COLOR[item.channel] || KIND_COLOR.ai;
  const label = item.isMove ? (item.reasonLabel || KIND_LABEL[item.channel] || 'AI move') : item.lunch ? 'Lunch' : item.routine ? 'Routine' : (KIND_LABEL[item.kind] || 'Battle plan');
  const canComplete = !!onComplete && !item.routine;
  const canRetime = !!onRetime && !item.routine && item.startMin != null;
  return (
    <Sheet open={open} onClose={onClose} title={item.isMove ? 'Suggested move' : 'Battle plan'} left={false} right={{ label: 'Done', onClick: onClose }} zIndex={zIndex} maxWidth={480}>
      {({ close }) => (
        <div style={{ paddingTop: 4 }}>
          {done ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '6px 10px', borderRadius: 8, background: 'rgba(var(--hl-rgb), 0.10)', border: '1px solid rgba(var(--hl-rgb), 0.28)' }}>
              <Icon name="check" size={14} color="var(--bp-done)" stroke={3} />
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.6, color: 'var(--bp-done)' }}>COMPLETED</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: c, boxShadow: `0 0 8px ${alpha(c, 50)}`, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1.2, textTransform: 'uppercase', color: c, padding: '2px 7px', borderRadius: 5, background: alpha(c, 12) }}>{label}</span>
            <span style={{ flex: 1 }} />
            {item.startMin != null ? (
              <span className="bp-num" style={{ fontSize: 11, fontWeight: 500, color: c }}>
                {item.isMove ? 'Best at ' : ''}{fmtMin(item.startMin)} · {durLabel(item.durationMin)}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--bp-t1)', letterSpacing: -0.3, lineHeight: '22px' }}>
            {item.whale ? <Icon name="crown" size={14} color="var(--text)" style={{ marginRight: 6, verticalAlign: '-1px' }} /> : null}
            {item.title}
          </div>
          {item.sub ? <div className="km-selectable" style={{ fontSize: 13, color: 'var(--bp-t2)', marginTop: 4, lineHeight: '18px' }}>{item.sub}</div> : null}

          {(canComplete || item.clientId) && !done ? (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              {canComplete ? (
                <button type="button" className="km-press" onClick={async () => { setDone(true); try { await onComplete(item); } catch { setDone(false); } }} style={actBtn('var(--bp-done)', true)}>
                  <Icon name="check" size={14} stroke={3} /> Complete
                </button>
              ) : null}
              {item.clientId && onText ? (
                <button type="button" className="km-press" onClick={() => { close(); setTimeout(() => onText(item), 250); }} style={actBtn('var(--imsg)')}>
                  <Icon name="message" size={14} stroke={2} /> Message
                </button>
              ) : null}
              {item.clientId && item.phone && onCall ? (
                <button type="button" className="km-press" onClick={() => { close(); setTimeout(() => onCall(item), 250); }} style={actBtn('var(--bp-now)')}>
                  <Icon name="phone" size={14} stroke={2} /> Call
                </button>
              ) : null}
            </div>
          ) : null}

          {item.why ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--bp-fill)', borderLeft: '2px solid var(--violet)' }}>
              <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1.4, color: 'var(--violet)', marginBottom: 5 }}>{item.isMove ? 'WHY THE AI SUGGESTED THIS' : 'WHY IT’S HERE'}</div>
              <div className="km-selectable" style={{ fontSize: 13, color: 'var(--bp-t1)', lineHeight: '18px', fontWeight: 500 }}>{item.why}</div>
            </div>
          ) : null}

          {canRetime ? (
            editing ? (
              <SlotEditor item={item} others={others} onSave={async (s, d) => { await onRetime(item, s, d); setEditing(false); close(); }} />
            ) : (
              <button type="button" className="km-press" onClick={() => setEditing(true)} style={{ marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)', color: 'var(--bp-t1)', fontSize: 13, fontWeight: 500 }}>
                <Icon name="clock" size={15} color="var(--bp-t2)" />
                <span style={{ flex: 1, textAlign: 'left' }}>Move this block</span>
                <Icon name="chevronRight" size={14} color="var(--bp-t3)" />
              </button>
            )
          ) : null}

          {item.clientId ? (
            <CoachAI item={item} onCoached={() => { toast.success('The AI will remember that.'); setTimeout(close, 900); }} />
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--bp-t3)', fontStyle: 'italic' }}>
              Coach AI is available on moves tied to a client.
            </div>
          )}

          {item.clientId && onOpenClient ? (
            <button
              type="button"
              className="km-press"
              onClick={() => { close(); setTimeout(() => onOpenClient(item.clientId), 250); }}
              style={{ marginTop: 12, width: '100%', padding: '10px 14px', borderRadius: 10, background: 'var(--bp-fill)', border: '1px solid var(--bp-hair2)', color: 'var(--bp-t1)', fontSize: 13, fontWeight: 500 }}
            >Open client card →</button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function actBtn(color, filled) {
  return {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 8px', borderRadius: 10, fontSize: 12.5, fontWeight: 500, letterSpacing: -0.1,
    border: filled ? 'none' : `1px solid ${alpha(color, 35)}`,
    background: filled ? color : alpha(color, 10),
    color: filled ? '#fff' : color,
  };
}
