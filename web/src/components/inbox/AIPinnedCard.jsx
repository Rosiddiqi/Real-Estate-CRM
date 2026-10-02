// AI pinned card (Clients tab) — "Needs you first": the unread threads that
// most need a reply, scored server-side (wait time, a question, a showing /
// offer / callback ask, whale, rating). Deterministic without AI; AI only
// rewrites the reasons. Tap a line → that thread. ✕ hides it until the set of
// waiting threads changes. "Not right? Give feedback" → AiFeedback (inbox_triage).
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { sendSuggestionFeedback } from '../../api/messages';

export default function AIPinnedCard({ card, onOpen, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (!expanded) return undefined;
    const t = setTimeout(() => taRef.current && taRef.current.focus(), 60);
    return () => clearTimeout(t);
  }, [expanded]);

  if (!card || !card.items || !card.items.length) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await sendSuggestionFeedback({
        kind: 'inbox_triage',
        conversationId: card.items[0].conversationId,
        isCorrect: false,
        text: `${t}\n\n— card: ${card.items.map((i) => `${i.name}: ${i.reason}`).join(' | ')}`.slice(0, 1000),
        source: card.source,
      });
      setDone(true);
      setText('');
      setTimeout(() => { setDone(false); setExpanded(false); }, 1600);
    } catch {
      /* keep the form open so they can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="km-aicard-wrap">
      <div className="km-aicard">
        <div className="km-aicard-head">
          <span className="km-aicard-tile"><Icon name="sparkle" size={18} color="var(--blue)" stroke={2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="km-aicard-eyebrow">{card.label || 'Needs you first'}</span>
            <span className="km-aicard-title">{card.title}</span>
          </span>
          {onDismiss ? (
            <button type="button" className="km-aicard-x km-press" aria-label="Hide" onClick={onDismiss}>
              <Icon name="x" size={14} stroke={2.4} />
            </button>
          ) : null}
        </div>

        <div className="km-aicard-items">
          {card.items.map((it) => (
            <button key={it.conversationId} type="button" className="km-aicard-item km-press" onClick={() => onOpen && onOpen(it)}>
              <Avatar name={it.name} seed={it.clientId || it.conversationId} size={30} style={it.isWhale ? { boxShadow: '0 0 0 1.5px var(--blue)' } : undefined} />
              <span className="km-aicard-item-main">
                <span className="km-aicard-item-name">
                  {it.name}
                  {it.isWhale ? <span className="km-crow-whale" style={{ marginLeft: 6 }}>Whale</span> : null}
                </span>
                <span className="km-aicard-item-reason">{it.reason}</span>
              </span>
              <Icon name="chevronRight" size={15} color="var(--faint)" stroke={2.2} />
            </button>
          ))}
        </div>

        <div className="km-aicard-foot">
          {!expanded && !done ? (
            <button type="button" className="km-aicard-fb" onClick={() => setExpanded(true)}>
              <Icon name="messageSquare" size={11} stroke={2} />
              Not right? Give feedback
              {card.more ? <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>+{card.more} more waiting</span> : null}
            </button>
          ) : null}
          {expanded && !done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                ref={taRef}
                className="km-aicard-ta"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Who should be first, and why? Your note trains the triage."
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="km-aicard-btn" onClick={() => { setExpanded(false); setText(''); }} disabled={busy}>Cancel</button>
                <button type="button" className="km-aicard-btn km-aicard-btn--go" onClick={submit} disabled={busy || !text.trim()}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          ) : null}
          {done ? (
            <span className="km-aicard-done"><Icon name="check" size={12} stroke={3} />Thanks — feedback saved</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
