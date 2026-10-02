// AI reply chips — three suggested replies for an unanswered inbound, shown
// above the composer while it's empty. Tapping a chip fills the composer
// (never auto-sends). 👍 / 👎 rate the set (AiFeedback). Deterministic
// fallback chips come from the server when AI is off.
import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { getReplySuggestions, sendSuggestionFeedback } from '../../api/messages';

const cache = new Map(); // messageId -> { suggestions, source }

export default function ReplySuggestions({ conversationId, lastInboundId, onPick }) {
  const [state, setState] = useState(() => (lastInboundId && cache.get(lastInboundId)) || null);
  const [hidden, setHidden] = useState(false);
  const [rated, setRated] = useState(null);

  useEffect(() => {
    setHidden(false);
    setRated(null);
    if (!conversationId || !lastInboundId) { setState(null); return undefined; }
    const hit = cache.get(lastInboundId);
    if (hit) { setState(hit); return undefined; }
    let alive = true;
    setState({ loading: true, suggestions: [] });
    getReplySuggestions(conversationId)
      .then((r) => {
        const value = { suggestions: (r && r.suggestions) || [], source: r && r.source };
        cache.set(lastInboundId, value);
        if (alive) setState(value);
      })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [conversationId, lastInboundId]);

  if (hidden || !state || (!state.loading && !state.suggestions.length)) return null;

  const feedback = (isCorrect, s) => {
    sendSuggestionFeedback({
      conversationId,
      messageId: lastInboundId,
      isCorrect,
      text: s ? s.text : state.suggestions.map((x) => x.text).join(' | '),
      tone: s ? s.tone : undefined,
      source: state.source,
    }).catch(() => {});
  };

  return (
    <div className="km-chips" role="list" aria-label="Suggested replies">
      <span className="km-chip-ai" title={state.source === 'ai' ? 'AI suggestions' : 'Suggestions'}>
        <Icon name="sparkle" size={16} stroke={1.9} />
      </span>
      {state.loading ? [0, 1, 2].map((i) => <span key={i} className="km-chip-skel km-skel" style={{ width: [176, 150, 190][i] }} />) : (
        <>
          {state.suggestions.map((s) => (
            <button
              key={s.id || s.text}
              type="button"
              role="listitem"
              className="km-chip-btn km-press"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => { onPick && onPick(s.text); feedback(true, s); setHidden(true); }}
            >
              {s.text}
            </button>
          ))}
          <button
            type="button"
            className="km-chip-ai km-press"
            aria-label="Good suggestions"
            style={{ color: rated === true ? 'var(--green)' : 'var(--lg-text-idle)' }}
            onClick={() => { setRated(true); feedback(true); }}
          >
            <Icon name="thumbsUp" size={15} stroke={1.9} />
          </button>
          <button
            type="button"
            className="km-chip-ai km-press"
            aria-label="Not helpful — hide"
            style={{ color: 'var(--lg-text-idle)' }}
            onClick={() => { feedback(false); setHidden(true); }}
          >
            <Icon name="thumbsDown" size={15} stroke={1.9} />
          </button>
        </>
      )}
    </div>
  );
}
