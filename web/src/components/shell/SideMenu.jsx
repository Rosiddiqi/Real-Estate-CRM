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
import { BRAND } from '../../brand';

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
            background: menuOpen ? 'rgba(2,3,5,0.62)' : 'rgba(2,3,5,0)',
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
            background: 'color-mix(in srgb, var(--bg) 97%, transparent)',
            backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            borderRight: '1px solid var(--lineHi)',
            boxShadow: '30px 0 80px -30px rgba(0,0,0,0.9)',
            transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.3s cubic-bezier(0.2,0,0,1)',
            display: 'flex', flexDirection: 'column',
            paddingTop: 'calc(var(--safe-top) + 18px)',
          }}
        >
          <div style={{ padding: '0 18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.22em' }}>
              <span style={{ width: 22, height: 22, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, var(--bright), var(--deep))', boxShadow: '0 6px 14px -6px var(--glow)' }}>
                <Icon name="key" size={13} color="#fff" stroke={2.2} />
              </span>
              {BRAND.name.toUpperCase()}
            </div>

            {next ? (
              <button
                type="button"
                className="km-press"
                onClick={() => { nav.closeMenu(); nav.openAppointment(next.id); }}
                style={{
                  marginTop: 16, width: '100%', textAlign: 'left', padding: '13px 14px', borderRadius: 16,
                  border: '1px solid var(--line)', background: 'linear-gradient(165deg, var(--surfaceHi), var(--surface))',
                  boxShadow: '0 14px 30px -14px rgba(0,0,0,0.7)',
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--bright)' }}>UP NEXT · {formatTime(next.startAt).toUpperCase()}</div>
                <div className="km-truncate" style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{next.title}</div>
                <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{next.location || next.type?.replace(/_/g, ' ')}</div>
              </button>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <Avatar name={name} seed={user?.id} src={user?.avatarUrl} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="km-truncate" style={{ fontSize: 16.5, fontWeight: 600 }}>{name}</div>
                <div className="km-truncate" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: 3 }}>
                  {workspace?.brokerageName || workspace?.name || ''}
                </div>
              </div>
            </div>
          </div>
          <div className="km-divider" />
          <div className="km-scroll" style={{ flex: 1, padding: '6px 0 24px' }}>
            {GROUPS.map((g, gi) => (
              <div key={g.id}>
                {gi > 0 ? <div className="km-divider" style={{ margin: '6px 16px' }} /> : null}
                {g.items.map((it) => {
                  const count = it.badge ? badges[it.badge] : 0;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => { nav.closeMenu(); setTimeout(it.run, 60); }}
                      className="km-drawer-item"
                      style={{
                        width: 'calc(100% - 16px)', margin: '0 8px', minHeight: 48, padding: '13.5px 12px 13.5px 16px',
                        borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                      }}
                    >
                      <Icon name={it.icon} size={21} stroke={1.6} color="var(--dim)" />
                      <span style={{ flex: 1, fontSize: 15.5, fontWeight: 500 }}>{it.label}</span>
                      {count ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{count}</span> : null}
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
          background: 'linear-gradient(180deg, transparent, var(--bright), transparent)',
          boxShadow: '0 0 14px var(--glow)',
          animation: 'km-edge-breathe 3.6s ease-in-out infinite',
        }}
      />
    </button>
  );
}
