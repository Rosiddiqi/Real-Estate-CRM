// Slide-out drawer — secondary destinations (RevMatch "Cockpit" drawer).
// Opens only by tapping the edge handle (a left-edge drag is swipe-BACK);
// closes on scrim tap, Esc, or a >60px swipe-left on the panel.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nav, useNav } from '../../lib/nav';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { formatTime } from '../../lib/format';
import BrandLockup from '../ui/BrandMark';

const SECTION = { daily: 'Daily', tools: 'Business', admin: 'Account' };

const GROUPS = [
  { id: 'daily', items: [
    { id: 'home', label: 'Home', icon: 'home', run: () => nav.go('home') },
    { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', badge: 'activeDeals', run: () => nav.openPipeline() },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', run: () => nav.openCalendar() },
  ] },
  { id: 'tools', items: [
    { id: 'listings', label: 'Listings', icon: 'estate', run: () => nav.openListings() },
    { id: 'waitlists', label: 'Waitlists', icon: 'checklist', badge: 'waitlistWaiting', run: () => nav.openWaitlists() },
    { id: 'commissions', label: 'Commission', icon: 'dollar', run: () => nav.openCommissions() },
    { id: 'book', label: 'Book of Business', icon: 'award', run: () => nav.openBook() },
    { id: 'campaigns', label: 'Campaigns', icon: 'send', run: () => nav.openCampaigns() },
  ] },
  { id: 'admin', items: [
    { id: 'settings', label: 'Settings', icon: 'settings', run: () => nav.openSettings() },
  ] },
];

export default function SideMenu({ badges = {} }) {
  const { menuOpen } = useNav();
  const { user, workspace } = useAuth();
  const [next, setNext] = useState(null);
  const touch = useRef(null);

  useEffect(() => {
    document.body.classList.toggle('km-drawer-open', !!menuOpen);
    if (!menuOpen) return undefined;
    let alive = true;
    api.get('/appointments/upcoming', { limit: 1, withinHours: 12 })
      .then((r) => { if (alive) setNext((r && (r.appointments || r)[0]) || null); })
      .catch(() => { if (alive) setNext(null); });
    const onKey = (e) => { if (e.key === 'Escape') nav.closeMenu(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  return createPortal(
    <>
      <div
        className={`km-drawer ${menuOpen ? 'km-drawer--open' : ''}`}
        aria-hidden={!menuOpen}
        style={{ position: 'fixed', inset: 0, zIndex: 10001, visibility: menuOpen ? 'visible' : 'hidden', transition: menuOpen ? 'none' : 'visibility 0s linear 0.32s' }}
      >
        <div
          onClick={() => nav.closeMenu()}
          style={{
            position: 'absolute', inset: 0,
            background: menuOpen ? 'var(--scrim)' : 'rgba(0,0,0,0)',
            backdropFilter: menuOpen ? 'blur(3px)' : 'blur(0px)', WebkitBackdropFilter: menuOpen ? 'blur(3px)' : 'blur(0px)',
            transition: 'background 0.3s ease, backdrop-filter 0.3s ease',
          }}
        />
        <aside
          onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            if (!touch.current) return;
            const dx = e.changedTouches[0].clientX - touch.current.x;
            const dy = Math.abs(e.changedTouches[0].clientY - touch.current.y);
            if (dx < -60 && dy < 80) nav.closeMenu();
            touch.current = null;
          }}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, width: '84%', maxWidth: 340,
            background: 'var(--bg)',
            borderRight: 'var(--hairline) solid var(--glass-line)',
            boxShadow: '30px 0 80px -30px rgba(0,0,0,0.9)',
            transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.3s cubic-bezier(0.2,0,0,1)',
            display: 'flex', flexDirection: 'column',
            paddingTop: 'calc(var(--safe-top) + 22px)',
          }}
        >
          <div style={{ padding: '0 22px 18px' }}>
            <BrandLockup size={22} wordSize={12} />

            {next ? (
              <button
                type="button"
                className="km-press km-tile"
                onClick={() => { nav.closeMenu(); nav.openAppointment(next.id); }}
                style={{
                  marginTop: 20, width: '100%', textAlign: 'left', padding: '14px 16px', display: 'block',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--hl)' }} />
                  UP NEXT · <span style={{ fontFamily: 'var(--font-num)', letterSpacing: '0.04em' }}>{formatTime(next.startAt).toUpperCase()}</span>
                </div>
                <div className="km-truncate" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 6 }}>{next.title}</div>
                <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{next.location || next.type?.replace(/_/g, ' ')}</div>
              </button>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
              <Avatar name={name} seed={user?.id} src={user?.avatarUrl} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="km-truncate" style={{ fontFamily: 'var(--font-num)', fontSize: 17, fontWeight: 300 }}>{name}</div>
                <div className="km-truncate" style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: 4 }}>
                  {workspace?.brokerageName || workspace?.name || ''}
                </div>
              </div>
            </div>
          </div>
          <div className="km-scroll" style={{ flex: 1, padding: '4px 0 24px' }}>
            {GROUPS.map((g) => (
              <div key={g.id}>
                <div className="km-eyebrow" style={{ padding: '18px 22px 6px' }}>{SECTION[g.id]}</div>
                {g.items.map((it) => {
                  const count = it.badge ? badges[it.badge] : 0;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => { nav.closeMenu(); setTimeout(it.run, 60); }}
                      className="km-drawer-item"
                      style={{
                        width: 'calc(100% - 16px)', margin: '0 8px', minHeight: 52, padding: '14px 12px 14px 14px',
                        borderRadius: 14, display: 'flex', alignItems: 'center', gap: 18, textAlign: 'left',
                      }}
                    >
                      <Icon name={it.icon} size={22} stroke={1.5} color="var(--text)" />
                      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500 }}>{it.label}</span>
                      {count ? <span className="km-badge">{count}</span> : <Icon name="chevronRight" size={15} color="var(--ghost)" stroke={1.6} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Edge handle — tap target only (a left-edge DRAG is swipe-back). */}
      <EdgeHandle hidden={menuOpen} />
    </>,
    document.body,
  );
}

function EdgeHandle({ hidden }) {
  const start = useRef(null);
  return (
    <button
      type="button"
      aria-label="Open menu"
      className="km-edge-tap"
      onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }}
      onTouchEnd={(e) => {
        const s = start.current; start.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        if (Math.abs(t.clientX - s.x) < 26 && Math.abs(t.clientY - s.y) < 20 && Date.now() - s.t < 600) {
          e.preventDefault();
          nav.openMenu();
        }
      }}
      onClick={() => nav.openMenu()}
      style={{
        position: 'fixed', left: 0, top: '50%', transform: 'translateY(-50%)', width: 30, height: 180, zIndex: 10000,
        display: 'flex', alignItems: 'center', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 0.2s',
      }}
    >
      <span
        className="km-edge-handle"
        style={{
          width: 4, height: 64, borderRadius: '0 4px 4px 0',
          background: 'linear-gradient(180deg, transparent, var(--dim), transparent)',
          animation: 'km-edge-breathe 3.6s ease-in-out infinite',
        }}
      />
    </button>
  );
}
