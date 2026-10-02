// Pinned conversations — iOS Messages style: up to 9 big avatars in a 3-up
// grid above the list, blue unread dot, typing bubble, long-press for actions.
import { useRef } from 'react';
import Avatar from '../ui/Avatar';
import AvatarCluster from './AvatarCluster';
import { TypingDots } from './ConversationRow';
import { convName, firstWord, isUnnamed, isUnread, isWhaleConv } from './inboxUtils';
import { haptic } from '../../lib/native';

function Cell({ conv, typing, onOpen, onMenu, selected }) {
  const timer = useRef(null);
  const fired = useRef(false);
  const startPos = useRef(null);
  const name = convName(conv);
  const label = conv.isGroup ? name : (isUnnamed(conv) ? name : firstWord(name));
  const whale = isWhaleConv(conv);
  const unread = isUnread(conv);

  const down = (e) => {
    fired.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    clearTimeout(timer.current);
    if (e.pointerType === 'mouse') return;
    timer.current = setTimeout(() => { fired.current = true; haptic('medium'); onMenu(conv); }, 480);
  };
  const move = (e) => {
    const s = startPos.current;
    if (s && (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8)) clearTimeout(timer.current);
  };
  const up = () => clearTimeout(timer.current);

  return (
    <button
      type="button"
      className={`km-pin km-press ${selected ? 'km-pin--sel' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onTouchEnd={(e) => { if (fired.current && e.cancelable) e.preventDefault(); }}
      onClick={() => { if (fired.current) { fired.current = false; return; } onOpen(conv); }}
      onContextMenu={(e) => { e.preventDefault(); clearTimeout(timer.current); if (!fired.current) onMenu(conv); fired.current = false; }}
      aria-label={`${name}${unread ? ', unread' : ''}`}
    >
      <span className="km-pin-av">
        {conv.isGroup ? (
          <AvatarCluster participants={conv.participants || []} size={64} />
        ) : (
          <Avatar
            name={isUnnamed(conv) ? '' : name}
            seed={conv.clientId || conv.handle || name}
            src={conv.client && conv.client.avatarUrl}
            size={64}
            style={whale ? { boxShadow: '0 0 0 2px var(--blue), 0 0 14px rgba(46,139,255,0.5)' } : undefined}
          />
        )}
        {unread ? <span className="km-pin-dot" /> : null}
        {typing ? <span className="km-pin-typing"><TypingDots /></span> : null}
      </span>
      <span className={`km-pin-name ${unread ? 'km-pin-name--unread' : ''}`}>{label}</span>
    </button>
  );
}

export default function PinnedGrid({ items, typing = {}, onOpen, onMenu, selectedId }) {
  if (!items.length) return null;
  return (
    <div className={`km-pins km-pins--${Math.min(items.length, 3)}`}>
      {items.map((c) => (
        <Cell key={c.id} conv={c} typing={!!typing[c.id]} onOpen={onOpen} onMenu={onMenu} selected={selectedId === c.id} />
      ))}
    </div>
  );
}
