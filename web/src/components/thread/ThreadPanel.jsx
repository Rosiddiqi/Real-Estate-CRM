// Thread overlay (nav type 'thread') — a push panel: slides in from the right,
// edge-swipe back, header floats over the messages on a black gradient
// (RevMatch): glass back · centered avatar + name pill (→ client card) ·
// glass call + info. Props: { conversationId, clientId, handle, name, draft }.
import { useCallback } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import GlassButton from '../ui/GlassButton';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { nav } from '../../lib/nav';
import { formatPhone } from '../../lib/format';
import ThreadView from './ThreadView';
import { channelLabel } from './threadUtils';

function Header({ conversation, client, defaultService, fallbackName, clientId, handle }) {
  const { requestClose } = usePanel();
  const conv = conversation || {};
  const cid = conv.clientId || (client && client.id) || clientId || null;
  const c = conv.client || null;
  const name = conv.name || (client && client.name) || fallbackName || formatPhone(handle) || 'Conversation';
  const isWhale = !!(c && c.isWhale);
  const phone = (c && c.phone) || (client && client.phone) || conv.handle || handle;
  const channel = (conv.channel || defaultService) === 'sms' ? 'sms' : 'imessage';
  const openCard = useCallback(() => { if (cid) nav.openClient(cid); }, [cid]);

  return (
    <div className="km-th-hgrid" data-peel-pin="">
      <GlassButton icon="chevronLeft" onClick={requestClose} label="Back" />
      <button type="button" className="km-th-who km-press" onClick={openCard} aria-label={cid ? `Open ${name}'s card` : name} disabled={!cid}>
        <Avatar
          name={name}
          seed={cid || phone}
          src={c && c.avatarUrl}
          size={56}
          style={isWhale ? { boxShadow: '0 0 0 1.5px var(--blue), 0 0 12px rgba(46,139,255,0.5)' } : { boxShadow: '0 0 0 0.5px rgba(255,255,255,0.12)' }}
        />
        <span className="km-th-namepill km-lg">
          <span>{name}</span>
          {cid ? <Icon name="chevronRight" size={14} stroke={2.5} color="var(--lg-text-idle)" /> : null}
        </span>
        <span className="km-th-sub">
          <span className="km-dot" style={{ background: channel === 'sms' ? 'var(--sms)' : 'var(--imsg)' }} />
          {channelLabel(channel === 'sms' ? 'sms' : 'imsg')}
          {isWhale ? <span style={{ color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 10 }}>· WHALE</span> : null}
        </span>
      </button>
      <div>
        <GlassButton icon="phone" label="Call" onClick={() => nav.call({ clientId: cid || undefined, phone, name })} disabled={!phone || String(phone).includes('@')} />
        <GlassButton icon="info" label="Client details" onClick={openCard} disabled={!cid} />
      </div>
    </div>
  );
}

export default function ThreadPanel({ conversationId, clientId, handle, name, draft, listingId, overlayId, onClose }) {
  return (
    <PushPanel onClose={onClose} header={false} scroll={false} pinned={['[data-peel-pin]']}>
      <ThreadView
        conversationId={conversationId}
        clientId={clientId}
        handle={handle}
        name={name}
        initialDraft={draft}
        variant="panel"
        onConversation={(c) => { if (c && c.id && c.id !== conversationId && overlayId) nav.updateProps(overlayId, { conversationId: c.id }); }}
        header={({ conversation, client, defaultService }) => (
          <Header conversation={conversation} client={client} defaultService={defaultService} fallbackName={name} clientId={clientId} handle={handle} />
        )}
      />
    </PushPanel>
  );
}
