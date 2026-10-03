// One inbox row (82px, RevMatch anatomy): 48px seeded avatar with channel dot
// (group → face cluster; unsaved number → silhouette; whale → blue ring) ·
// name 15.5/600 + WHALE tag + muted bell + stars · preview 13.5 (intent chip,
// "You: " prefix, compact link preview, typing dots, Not Delivered) · time ·
// 22px blue unread badge.
import { memo } from 'react';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import AvatarCluster from './AvatarCluster';
import { BellOff } from '../thread/glyphs';
import { useLinkPreview } from '../thread/parts';
import { firstUrl } from '../thread/threadUtils';
import { mediaUrl } from '../../api/client';
import { channelOf, convName, fmtInboxTime, isUnnamed, isWhaleConv, previewOf, rowIntent } from './inboxUtils';

function Stars({ n }) {
  const k = Math.max(1, Math.min(5, Math.round(n)));
  return (
    <span className="km-crow-stars" aria-label={`${k} star${k === 1 ? '' : 's'}`}>
      {Array.from({ length: k }, (_, i) => (
        <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="12 2 15 9 22 9.3 16.5 13.8 18.5 21 12 17 5.5 21 7.5 13.8 2 9.3 9 9" />
        </svg>
      ))}
    </span>
  );
}

export function TypingDots() {
  return (
    <span className="km-crow-typing" aria-label="typing">
      <i /><i /><i />
    </span>
  );
}

// iMessage-style compact link preview in a one-line row: thumb + page title.
function RowLink({ url, prefix, fallback }) {
  const { data } = useLinkPreview(url);
  if (!data || (!data.title && !data.image)) return <>{prefix}{fallback}</>;
  return (
    <span className="km-crow-link">
      {prefix ? <span style={{ flexShrink: 0 }}>{prefix}</span> : null}
      {data.image ? <img src={mediaUrl(data.image)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
      <span className="km-truncate">{data.title || data.host}</span>
    </span>
  );
}

function ConversationRow({ conv, typing = false, onOpen, onAvatar, selected = false }) {
  const name = convName(conv);
  const whale = isWhaleConv(conv);
  const unread = conv.unreadCount || 0;
  const ch = channelOf(conv);
  const intent = typing ? null : rowIntent(conv);
  const preview = previewOf(conv);
  const url = typing ? null : firstUrl(conv.lastMessagePreview || '');
  const failed = conv.lastMessageFromMe && conv.lastMessageStatus === 'failed';
  const rating = !conv.isGroup && conv.client ? conv.client.rating || 0 : 0;

  return (
    <div
      className={`km-crow ${whale ? 'km-crow--whale' : ''} ${unread ? 'km-crow--unread' : ''} ${selected ? 'km-crow--sel' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${name}${unread ? `, ${unread} unread` : ''}`}
      onClick={() => onOpen && onOpen(conv)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen && onOpen(conv); } }}
    >
      <span
        className="km-crow-av"
        onClick={onAvatar && conv.clientId ? (e) => { e.stopPropagation(); onAvatar(conv); } : undefined}
      >
        {conv.isGroup ? (
          <AvatarCluster participants={conv.participants || []} size={48} />
        ) : (
          <Avatar
            name={isUnnamed(conv) ? '' : name}
            seed={conv.clientId || conv.handle || name}
            src={conv.client && conv.client.avatarUrl}
            size={48}
            channel={ch}
            style={whale ? { boxShadow: '0 0 0 1.5px rgba(var(--accent-rgb), 0.85)' } : undefined}
          />
        )}
      </span>

      <span className="km-crow-main">
        <span className="km-crow-top">
          <span className="km-crow-name">{name}</span>
          {whale ? <span className="km-crow-whale">Whale</span> : null}
          {conv.muted ? <span className="km-crow-muted" title="Alerts hidden"><BellOff size={12} /></span> : null}
          {rating > 0 ? <Stars n={rating} /> : null}
        </span>
        <span className="km-crow-bottom">
          <span className={`km-crow-preview ${typing ? 'km-crow-preview--typing' : ''}`}>
            {typing ? <TypingDots /> : (
              <>
                {failed ? (
                  <span className="km-crow-failed"><Icon name="alert" size={12} stroke={2.4} />Not Delivered · </span>
                ) : null}
                {intent ? <span className={`km-crow-chip ${intent === 'REPLY' ? 'km-crow-chip--reply' : ''}`}>◆ {intent}</span> : null}
                {url ? <RowLink url={url} prefix={conv.lastMessageFromMe ? 'You: ' : ''} fallback={preview} /> : preview}
              </>
            )}
          </span>
          <span className="km-crow-time">{fmtInboxTime(conv.lastMessageAt)}</span>
        </span>
      </span>

      {unread > 0 ? <span className={`km-crow-badge ${whale ? 'km-crow-badge--whale' : ''}`}>{unread > 99 ? '99+' : unread}</span> : null}
    </div>
  );
}

export default memo(ConversationRow);
