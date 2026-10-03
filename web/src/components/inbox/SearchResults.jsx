// Inbox search results — Contacts · Conversations · Messages (with the match
// highlighted). Taps fire on touchend (≤10px, ≤600ms) and blur the search box
// first, so the keyboard-dismiss relayout can't move the row out from under
// the finger (RevMatch SearchResultsList fix). Avatar → client card.
import { useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import { Spinner } from '../ui/kit';
import { formatPhone } from '../../lib/format';
import SectionHeader from './SectionHeader';
import { convName, fmtInboxTime, highlightParts, isUnnamed, previewOf, channelOf } from './inboxUtils';

const SLOP = 10;
const MAX_MS = 600;

function useGuardedTap() {
  const start = useRef(null);
  const firedAt = useRef(0);
  return (handler) => ({
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    },
    onTouchEnd: (e) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches && e.changedTouches[0];
      if (!s || !t) return;
      if (Math.abs(t.clientX - s.x) > SLOP || Math.abs(t.clientY - s.y) > SLOP || Date.now() - s.at > MAX_MS) return;
      e.preventDefault();
      firedAt.current = Date.now();
      handler(e);
    },
    onClick: (e) => {
      if (Date.now() - firedAt.current < 700) return;
      handler(e);
    },
  });
}

function blurSearch() {
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch { /* ignore */ }
}

function Hl({ text, q }) {
  return highlightParts(text, q).map((p, i) => (p.hit ? <mark key={i} className="km-sr-hit">{p.text}</mark> : <span key={i}>{p.text}</span>));
}

function Row({ onTap, avatar, title, sub, right, busy }) {
  const bind = useGuardedTap();
  return (
    <div className="km-sr-row" role="button" tabIndex={0} {...bind(onTap)} onKeyDown={(e) => { if (e.key === 'Enter') onTap(); }}>
      {avatar}
      <span className="km-sr-main">
        <span className="km-sr-title">{title}</span>
        <span className="km-sr-sub">{busy ? <span style={{ color: 'var(--dim)' }}>Opening…</span> : sub}</span>
      </span>
      {right ? <span className="km-sr-right">{right}</span> : null}
    </div>
  );
}

function AvatarTap({ onTap, children }) {
  const bind = useGuardedTap();
  if (!onTap) return children;
  const b = bind(onTap);
  return (
    <span
      className="km-sr-av"
      onTouchStart={b.onTouchStart}
      onTouchEnd={(e) => { e.stopPropagation(); b.onTouchEnd(e); }}
      onClick={(e) => { e.stopPropagation(); b.onClick(e); }}
    >
      {children}
    </span>
  );
}

export default function SearchResults({ query, results, loading, onOpenConversation, onOpenClient, onTextClient }) {
  const [opening, setOpening] = useState(null);
  const conversations = (results && results.conversations) || [];
  const messages = (results && results.messages) || [];
  const contacts = (results && results.contacts) || [];
  const empty = !conversations.length && !messages.length && !contacts.length;

  if (empty && loading) {
    return <div className="km-sr-state"><Spinner size={18} /> Searching…</div>;
  }
  if (empty) {
    return <div className="km-sr-state">No matches for “{query.trim()}”</div>;
  }

  const open = (key, fn) => () => { blurSearch(); setOpening(key); fn(); };
  const card = (clientId) => (clientId ? () => { blurSearch(); onOpenClient(clientId); } : null);
  const kindLabel = (k) => (k === 'partner' ? 'Partner' : k === 'vendor' ? 'Vendor' : null);

  return (
    <div className="km-sr">
      {contacts.length ? (
        <>
          <SectionHeader label="Contacts" count={contacts.length} />
          {contacts.map((c) => (
            <Row
              key={`k:${c.id}`}
              busy={opening === `k:${c.id}`}
              onTap={open(`k:${c.id}`, () => onTextClient(c))}
              avatar={(
                <AvatarTap onTap={card(c.id)}>
                  <Avatar name={c.name} seed={c.id} src={c.avatarUrl} size={44} style={c.isWhale ? { boxShadow: '0 0 0 1.5px rgba(var(--accent-rgb), 0.85)' } : undefined} />
                </AvatarTap>
              )}
              title={<Hl text={c.name} q={query} />}
              sub={[kindLabel(c.contactKind), c.neighborhood, formatPhone(c.phone) || c.email].filter(Boolean).join(' · ') || (c.conversationId ? 'Open conversation' : 'No messages yet · tap to text')}
            />
          ))}
        </>
      ) : null}

      {conversations.length ? (
        <>
          <SectionHeader label="Conversations" count={conversations.length} />
          {conversations.map((c) => (
            <Row
              key={`c:${c.id}`}
              busy={opening === `c:${c.id}`}
              onTap={open(`c:${c.id}`, () => onOpenConversation(c))}
              avatar={(
                <AvatarTap onTap={card(c.clientId)}>
                  <Avatar name={isUnnamed(c) ? '' : convName(c)} seed={c.clientId || c.handle} src={c.client && c.client.avatarUrl} size={44} channel={channelOf(c)} />
                </AvatarTap>
              )}
              title={<Hl text={convName(c)} q={query} />}
              sub={previewOf(c)}
              right={fmtInboxTime(c.lastMessageAt)}
            />
          ))}
        </>
      ) : null}

      {messages.length ? (
        <>
          <SectionHeader label="Messages" count={messages.length} />
          {messages.map((m) => {
            const c = m.conversation || {};
            return (
              <Row
                key={`m:${m.id}`}
                busy={opening === `m:${m.id}`}
                onTap={open(`m:${m.id}`, () => onOpenConversation(c, m.id))}
                avatar={(
                  <AvatarTap onTap={card(c.clientId)}>
                    <Avatar name={isUnnamed(c) ? '' : convName(c)} seed={c.clientId || c.handle} src={c.client && c.client.avatarUrl} size={44} />
                  </AvatarTap>
                )}
                title={convName(c)}
                sub={<>{m.isFromMe ? <span style={{ color: 'var(--faint)' }}>You: </span> : null}<Hl text={m.snippet || m.body} q={query} /></>}
                right={fmtInboxTime(m.sentAt)}
              />
            );
          })}
        </>
      ) : null}
      {loading ? <div className="km-sr-state km-sr-state--inline"><Spinner size={14} /> Updating…</div> : null}
    </div>
  );
}
