// Home tab — fixed top bar (date eyebrow, time-based greeting, search ·
// notifications · menu glass buttons, avatar → settings) over a two-page
// horizontal pager: Battle Plan · Stats. Strict axis lock on the first 8 px,
// page change needs a real flick (≥60 px at ≥0.4 px/ms) or a long drag
// (≥120 px); page index persisted; vertical scroll only inside pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import GlassButton from '../../components/ui/GlassButton';
import { nav } from '../../lib/nav';
import { useAuth } from '../../hooks/useAuth';
import { useResync, useSocket } from '../../hooks/useSocket';
import { getBadges } from '../../api/system';
import { mediaUrl } from '../../api/client';
import { getInitials } from '../../lib/format';
import { hourIn, dayLabelIn } from '../../components/battleplan/time';
import useAgentTz from '../../components/battleplan/useAgentTz';
import BattlePlanPage from './BattlePlanPage';
import StatsPage from './StatsPage';
import '../../styles/dashboard.css';

const PAGE_KEY = 'km_dash_page';

function readPage() {
  try {
    const v = parseInt(localStorage.getItem(PAGE_KEY) || '0', 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  } catch { return 0; }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } });
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const h = (e) => setReduced(e.matches);
      mq.addEventListener('change', h);
      return () => mq.removeEventListener('change', h);
    } catch { return undefined; }
  }, []);
  return reduced;
}

function useClockMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    const bump = () => setNow(new Date());
    document.addEventListener('visibilitychange', bump);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', bump); };
  }, []);
  return now;
}

export default function Dashboard() {
  const { user } = useAuth();
  const tz = useAgentTz();
  const [page, setPage] = useState(readPage);
  const setPagePersist = useCallback((p) => {
    setPage(p);
    try { localStorage.setItem(PAGE_KEY, String(p)); } catch { /* ignore */ }
  }, []);
  // External "jump to page" hook (drawer / deep links).
  useEffect(() => {
    const onDash = (e) => { const p = e && e.detail && e.detail.page; if (p === 0 || p === 1) setPagePersist(p); };
    window.addEventListener('km:dash-page', onDash);
    return () => window.removeEventListener('km:dash-page', onDash);
  }, [setPagePersist]);

  const reduced = useReducedMotion();
  const now = useClockMinute();

  // Notification badge.
  const [unread, setUnread] = useState(0);
  const loadBadges = useCallback(() => { getBadges().then((b) => setUnread((b && b.unreadNotifications) || 0)).catch(() => {}); }, []);
  useEffect(() => {
    loadBadges();
    const onBump = () => setTimeout(loadBadges, 400);
    window.addEventListener('km:badges', onBump);
    const id = setInterval(loadBadges, 60000);
    return () => { window.removeEventListener('km:badges', onBump); clearInterval(id); };
  }, [loadBadges]);
  useSocket(['notification'], loadBadges);
  useResync(loadBadges);

  // Swipe — axis-locked; flick or long drag.
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, t: Date.now(), axis: null }; };
  const onTouchMove = (e) => {
    const s = touch.current; if (!s || s.axis) return;
    const t = e.touches[0]; const dx = t.clientX - s.x; const dy = t.clientY - s.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    s.axis = Math.abs(dx) >= Math.abs(dy) * 2 ? 'h' : 'v';
  };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s || s.axis !== 'h' || e.touches.length > 0) return;
    const t = e.changedTouches[0]; const dx = t.clientX - s.x;
    const v = Math.abs(dx) / Math.max(1, Date.now() - s.t);
    if (!((Math.abs(dx) >= 60 && v >= 0.4) || Math.abs(dx) >= 120)) return;
    if (dx < 0 && page < 1) setPagePersist(page + 1);
    if (dx > 0 && page > 0) setPagePersist(page - 1);
  };

  const first = (user && user.firstName) || '';
  // Date + greeting in the agent's zone (the same clock the rail runs on).
  const eyebrow = dayLabelIn(now, tz, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  const h = hourIn(now, tz);
  const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="km-screen km-dash">
      <header className="km-dash-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
          <div className="km-dash-eyebrow" style={{ flex: 1, minWidth: 0 }}>{eyebrow}</div>
          <GlassButton icon="search" size={34} label="Search" onClick={() => nav.openSearch()} />
          <GlassButton icon="bell" size={34} label="Notifications" badge={unread > 0 ? (unread > 99 ? '99+' : unread) : null} onClick={() => nav.openNotifications()} />
          <GlassButton icon="menu" size={34} label="Menu" onClick={() => nav.openMenu()} />
          <button type="button" className="km-dash-avatar km-press" onClick={() => nav.openSettings()} aria-label="Settings and profile">
            {user && user.avatarUrl ? <img src={mediaUrl(user.avatarUrl)} alt="" /> : (getInitials(`${first} ${(user && user.lastName) || ''}`) || 'K').slice(0, 1)}
          </button>
        </div>
        <div className="km-dash-greeting km-truncate">{hello}{first ? `, ${first}` : ''}</div>
      </header>

      <div
        className="km-dash-viewport"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { touch.current = null; }}
      >
        <div
          className="km-dash-track"
          style={{
            transform: `translateX(${page === 0 ? '0%' : '-50%'})`,
            transition: reduced ? 'none' : 'transform 320ms var(--km-ease)',
          }}
        >
          <div className="km-dash-slot" style={{ overflow: 'hidden' }} aria-hidden={page !== 0}>
            <BattlePlanPage page={page} onSelectPage={setPagePersist} active={page === 0} />
          </div>
          <div className="km-dash-slot km-scroll" aria-hidden={page !== 1} style={{ overflowY: 'auto' }}>
            <StatsPage page={page} onSelectPage={setPagePersist} active={page === 1} />
          </div>
        </div>
      </div>
    </div>
  );
}
