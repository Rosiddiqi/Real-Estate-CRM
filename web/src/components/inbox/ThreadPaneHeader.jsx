// Desktop split-view thread header (no back button): ⋯ actions · centered
// avatar + glass name pill (→ client card) · call + info.
import GlassButton from '../ui/GlassButton';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { nav } from '../../lib/nav';
import { channelLabel } from '../thread/threadUtils';
import { convName, isUnnamed } from './inboxUtils';

export default function ThreadPaneHeader({ conversation, fallback, defaultService, onMore }) {
  const c = conversation || fallback || {};
  const cid = c.clientId || null;
  const name = convName(c) || 'Conversation';
  const whale = !!(c.client && c.client.isWhale && !c.isGroup);
  const phone = (c.client && c.client.phone) || c.handle;
  const channel = (c.channel || defaultService) === 'sms' ? 'sms' : 'imessage';
  const openCard = () => { if (cid) nav.openClient(cid); };
  return (
    <div className="km-th-hgrid km-th-hgrid--pane" data-peel-pin="">
      <div>
        {onMore && c.id ? <GlassButton icon="more" label="Conversation options" onClick={() => onMore(c)} /> : null}
      </div>
      <button type="button" className="km-th-who km-press" onClick={openCard} disabled={!cid} aria-label={cid ? `Open ${name}'s card` : name}>
        <Avatar
          name={isUnnamed(c) ? '' : name}
          seed={cid || c.handle || name}
          src={c.client && c.client.avatarUrl}
          size={48}
          style={whale ? { boxShadow: '0 0 0 1.5px rgba(var(--accent-rgb), 0.85)' } : undefined}
        />
        <span className="km-th-namepill km-lg">
          <span>{name}</span>
          {cid ? <Icon name="chevronRight" size={14} stroke={2.5} color="var(--lg-text-idle)" /> : null}
        </span>
        <span className="km-th-sub">
          <span className="km-dot" style={{ background: channel === 'sms' ? 'var(--sms)' : 'var(--imsg)' }} />
          {channelLabel(channel === 'sms' ? 'sms' : 'imsg')}
          {whale ? <span style={{ color: 'var(--dim)', fontWeight: 500, letterSpacing: '0.1em', fontSize: 10 }}>· WHALE</span> : null}
        </span>
      </button>
      <div>
        <GlassButton icon="phone" label="Call" onClick={() => nav.call({ clientId: cid || undefined, phone, name })} disabled={!phone || String(phone).includes('@')} />
        <GlassButton icon="info" label="Client details" onClick={openCard} disabled={!cid} />
      </div>
    </div>
  );
}
