// TrainAiSheet — the 👎 "Tell AI why" trainer for an AI move: reasons + an
// optional note + an optional 30-day mute for the client. Feeds AiFeedback
// (the copy prompt's REP FEEDBACK block) and, with the mute, a real
// suppression the candidate generator honors.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { alpha } from '../calendar/appointmentTypes';

const REASONS = ['Wrong timing', 'Wrong person', 'Already handled', 'Not my style', "Don't suggest this type"];

export default function TrainAiSheet({ open, move, onClose, onSubmit, zIndex = 460 }) {
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [mute, setMute] = useState(false);
  useEffect(() => { if (open) { setPicked(new Set()); setNote(''); setMute(false); } }, [open, move && move.id]);
  if (!move) return null;
  const toggle = (r) => setPicked((p) => { const n = new Set(p); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  const canSend = picked.size > 0 || note.trim().length > 0;
  const who = move.firstName || (move.clientName || '').split(' ')[0] || 'this client';
  return (
    <Sheet open={open} onClose={onClose} title="Train the AI" zIndex={zIndex} maxWidth={500}>
      {({ close }) => (
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.6, color: 'var(--violet)', textTransform: 'uppercase' }}>Tell AI why</div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3, marginTop: 3, lineHeight: 1.3 }}>Why is this one off?</div>
          <div style={{ fontSize: 12.5, color: 'var(--bp-t2)', lineHeight: 1.45, padding: '8px 10px', marginTop: 8, borderRadius: 10, background: 'var(--bp-fill)', border: '1px solid var(--bp-hair)' }}>
            “{move.title}”{move.clientName ? ` · ${move.clientName}` : ''}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {REASONS.map((r) => {
              const on = picked.has(r);
              return (
                <button
                  key={r}
                  type="button"
                  className="km-press"
                  onClick={() => toggle(r)}
                  aria-pressed={on}
                  style={{
                    padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                    background: on ? alpha('var(--violet)', 18) : 'var(--bp-fill)',
                    border: `1px solid ${on ? alpha('var(--violet)', 55) : 'var(--bp-hair2)'}`,
                    color: on ? 'color-mix(in srgb, var(--violet) 45%, var(--bp-t1))' : 'var(--bp-t2)',
                  }}
                >{r}</button>
              );
            })}
          </div>
          <textarea
            className="km-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything else the AI should learn from this? (optional)"
            style={{ marginTop: 10, minHeight: 64, fontSize: 16 }}
          />
          {move.clientId ? (
            <button
              type="button"
              onClick={() => setMute((v) => !v)}
              aria-pressed={mute}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', marginTop: 10, padding: '11px 12px', borderRadius: 12, textAlign: 'left',
                background: mute ? 'rgba(255,149,0,0.10)' : 'var(--bp-fill)',
                border: `1px solid ${mute ? 'rgba(255,149,0,0.40)' : 'var(--bp-hair2)'}`,
              }}
            >
              <span style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: mute ? '#FF9500' : 'transparent', border: `1.5px solid ${mute ? '#FF9500' : 'var(--bp-t3)'}` }}>
                {mute ? <Icon name="check" size={11} color="#1a1308" stroke={3.5} /> : null}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: mute ? '#FFB340' : 'var(--bp-t2)' }}>Stop suggesting {who} for 30 days</span>
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canSend}
            className="km-press"
            onClick={() => { if (!canSend) return; onSubmit?.({ move, reasons: [...picked], note: note.trim(), mute }); close(); }}
            style={{
              width: '100%', height: 46, marginTop: 14, borderRadius: 13, fontSize: 14.5, fontWeight: 700,
              background: canSend ? 'linear-gradient(135deg, var(--violet), color-mix(in srgb, var(--violet) 65%, #000))' : 'var(--bp-fill)',
              color: canSend ? '#fff' : 'var(--bp-t3)',
              boxShadow: canSend ? `0 6px 20px ${alpha('var(--violet)', 35)}, inset 0 1px 0 rgba(255,255,255,0.18)` : 'none',
            }}
          >Teach the AI</button>
        </div>
      )}
    </Sheet>
  );
}
