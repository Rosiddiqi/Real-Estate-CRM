// Inbox header (RevMatch InboxHeader, KeyMatch skin): fluted architectural
// backdrop + blue glow, eyebrow KEYMATCH · line-status bars, 32/800 title,
// "N unread · N total · N whales", and a glass filter/menu button (Unread ·
// Pinned · iMessage · Text Message · Has Questions + Mark All Read,
// Recently Deleted, Blocked).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import GlassButton from '../ui/GlassButton';
import { LineStatusGlyph } from '../thread/glyphs';
import { useSocketStatus } from '../../hooks/useSocket';
import { api } from '../../api/client';
import { BRAND } from '../../brand';

export const FILTERS = [
  { id: '', label: 'All Conversations', icon: 'inbox' },
  { id: 'unread', label: 'Unread', icon: 'circle' },
  { id: 'pinned', label: 'Pinned', icon: 'pin' },
  { id: 'imessage', label: 'iMessage', dot: 'var(--imsg)' },
  { id: 'sms', label: 'Text Message', dot: 'var(--sms)' },
  { id: 'questions', label: 'Has Questions', icon: 'help' },
];

let lineInfo = null;
function useLineInfo() {
  const [info, setInfo] = useState(lineInfo);
  useEffect(() => {
    if (lineInfo) return;
    api.get('/bridge').then((r) => { lineInfo = r; setInfo(r); }).catch(() => {});
  }, []);
  return info;
}

function Menu({ anchor, onClose, children }) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
  }, [anchor]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!pos) return null;
  return createPortal(
    <div className="km-imenu-root" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="km-imenu km-lg km-lg--menu" style={{ top: pos.top, right: pos.right }} role="menu">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function InboxHeader({ unread = 0, total = 0, whales = 0, filter, onFilter, counts = {}, onMarkAllRead, onShowList }) {
  const status = useSocketStatus();
  const info = useLineInfo();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const healthBase = status === 'open' ? 'green' : status === 'connecting' ? 'yellow' : status === 'idle' ? 'unknown' : 'red';
  const mode = info && info.messaging ? info.messaging.mode : (info && info.provider);
  const providerLabel = !info ? 'Messaging line'
    : mode === 'twilio' ? 'Twilio SMS line'
      : mode === 'device' ? 'Texts send from your phone'
        : 'Demo line · simulated delivery';
  // Device mode (no business line) reads amber: it works, but KeyMatch can't send on its own.
  const health = healthBase === 'green' && mode === 'device' ? 'yellow' : healthBase;
  const lineLabel = healthBase === 'green' ? `${providerLabel}${mode === 'device' ? '' : ' · live'}` : healthBase === 'red' ? 'Offline — reconnecting' : 'Connecting…';
  const pick = (id) => { setOpen(false); onFilter(id); };

  return (
    <div className="km-ihead">
      <div className="km-ihead-bg km-fluted" aria-hidden="true" />
      <div className="km-ihead-glow" aria-hidden="true" />
      <div className="km-ihead-fade" aria-hidden="true" />
      <div className="km-ihead-in">
        <div className="km-ihead-row">
          <span className="km-ihead-eyebrow">{String(BRAND.name || 'KeyMatch').toUpperCase()}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span title={lineLabel} aria-label={lineLabel} style={{ display: 'inline-flex', padding: 4 }}>
              <LineStatusGlyph size={18} health={health} />
            </span>
            <span ref={btnRef} style={{ display: 'inline-flex' }}>
              <GlassButton
                icon="filter"
                size={36}
                label="Filter and options"
                onClick={() => setOpen((v) => !v)}
                style={filter ? { color: 'var(--blue)' } : undefined}
                badge={null}
              />
            </span>
          </span>
        </div>
        <div className="km-ihead-title">Inbox</div>
        <div className="km-ihead-stats">
          <span><b>{unread}</b> unread</span>
          <span className="km-ihead-sep">·</span>
          <span><b>{total}</b> total</span>
          <span className="km-ihead-sep">·</span>
          <span><b style={{ color: 'var(--blue)' }}>{whales}</b> {whales === 1 ? 'whale' : 'whales'}</span>
        </div>
      </div>

      {open ? (
        <Menu anchor={btnRef.current} onClose={() => setOpen(false)}>
          <div className="km-imenu-line">
            <LineStatusGlyph size={14} health={health} />
            <span>{lineLabel}</span>
          </div>
          <div className="km-imenu-eyebrow">Filter</div>
          {FILTERS.map((f) => (
            <button key={f.id || 'all'} type="button" role="menuitemradio" aria-checked={filter === f.id} className="km-imenu-item" onClick={() => pick(f.id)}>
              <span className="km-imenu-check">{filter === f.id ? <Icon name="check" size={15} stroke={2.6} /> : null}</span>
              <span style={{ flex: 1 }}>{f.label}</span>
              {f.id && counts[f.id] ? <span className="km-imenu-count">{counts[f.id]}</span> : null}
              {f.dot ? <span className="km-dot" style={{ background: f.dot }} /> : f.icon ? <Icon name={f.icon} size={16} stroke={1.9} color="var(--dim)" /> : null}
            </button>
          ))}
          <div className="km-imenu-sep" />
          <button type="button" className="km-imenu-item" disabled={!unread} onClick={() => { setOpen(false); onMarkAllRead(); }}>
            <span className="km-imenu-check" />
            <span style={{ flex: 1 }}>Mark All as Read</span>
            <Icon name="checkCircle" size={16} stroke={1.9} color="var(--dim)" />
          </button>
          <button type="button" className="km-imenu-item" onClick={() => { setOpen(false); onShowList('archived'); }}>
            <span className="km-imenu-check" />
            <span style={{ flex: 1 }}>Recently Deleted</span>
            <Icon name="trash" size={16} stroke={1.9} color="var(--dim)" />
          </button>
          <button type="button" className="km-imenu-item" onClick={() => { setOpen(false); onShowList('blocked'); }}>
            <span className="km-imenu-check" />
            <span style={{ flex: 1 }}>Blocked</span>
            <Icon name="shield" size={16} stroke={1.9} color="var(--dim)" />
          </button>
        </Menu>
      ) : null}
    </div>
  );
}
