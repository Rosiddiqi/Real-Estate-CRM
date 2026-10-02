// SerenaSheet — overlay `serena` ({ page, prompt }). A tall, centered
// liquid-glass popup that floats over the still-visible app (RevMatch
// SerenaSheet): iMessage-style nav bar, page dots, and a swipeable 3-page
// pager — Chat · To-Do (Battle Plan's TodoPanel) · Matchmaker (MatchDigest).
// The minimize X sits under the popup; tapping outside dismisses. Closing never
// stops a running turn (the bubble picks up the reply).
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import { toast } from '../ui/toast';
import { useOverlayDepth, panelZ } from '../ui/depth';
import { nav } from '../../lib/nav';
import { resetThread } from '../../api/serena';
import SerenaAvatar from './SerenaAvatar';
import SerenaChat from './SerenaChat';
import { serena, useSerena } from './serenaStore';
import '../../styles/serena.css';
import { useAssistant } from '../../hooks/useAssistant';

const TodoPanel = lazy(() => import('../battleplan/TodoPanel'));
const MatchDigest = lazy(() => import('../matchmaker/MatchDigest'));

const PAGES = ['chat', 'todo', 'matches'];
const PAGE_LABEL = { chat: null /* the agent's own assistant name */, todo: 'To-Do', matches: 'Matchmaker' };
const PAGE_KEY = 'km_serena_page';
const handledPrompts = new Set();

function readPage(initial) {
  if (PAGES.includes(initial)) return initial;
  try { const v = localStorage.getItem(PAGE_KEY); if (PAGES.includes(v)) return v; } catch { /* ignore */ }
  return 'chat';
}

class SideBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error('[serena] side page failed', err); }
  render() { return this.state.err ? <div className="km-srn-side-fallback">{this.props.fallback}</div> : this.props.children; }
}

export default function SerenaSheet({ page: initialPage, prompt, overlayId, onClose }) {
  const { name: assistant } = useAssistant();
  // A focused layer: the page dims and the tab bar steps aside (like a call).
  useEffect(() => {
    document.body.classList.add('km-tabbar-hidden');
    return () => document.body.classList.remove('km-tabbar-hidden');
  }, []);
  const s = useSerena();
  const depth = useOverlayDepth();
  const [page, setPageState] = useState(() => readPage(initialPage));
  const [phase, setPhase] = useState('entering');
  const [menu, setMenu] = useState(false);
  const [visited, setVisited] = useState(() => new Set([readPage(initialPage)]));
  const swipe = useRef(null);
  const closing = useRef(false);

  const setPage = useCallback((p) => {
    setPageState(p);
    setVisited((v) => (v.has(p) ? v : new Set([...v, p])));
    try { localStorage.setItem(PAGE_KEY, p); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('in')));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => { if (PAGES.includes(initialPage)) setPage(initialPage); }, [initialPage, setPage]);

  // nav.openSerena('chat', prompt) → run the prompt once.
  useEffect(() => {
    const p = String(prompt || '').trim();
    if (!p || handledPrompts.has(overlayId)) return;
    handledPrompts.add(overlayId);
    setPage('chat');
    setTimeout(() => serena.send(p), 120);
  }, [prompt, overlayId, setPage]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setMenu(false);
    setPhase('leaving');
    setTimeout(() => onClose?.(), 200);
  }, [onClose]);

  // Close first, then navigate (a transient surface never sits over the next page).
  const handoff = useCallback((fn) => {
    requestClose();
    setTimeout(() => { try { fn(); } catch (err) { console.error(err); } }, 330);
  }, [requestClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    const onPage = (e) => { if (PAGES.includes(e?.detail?.page)) setPage(e.detail.page); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('serena:page', onPage);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('serena:page', onPage); };
  }, [requestClose, setPage]);

  const openCard = useCallback((open) => {
    if (!open) return;
    if (open.type === 'todo') { setPage('todo'); return; }
    handoff(() => {
      if (open.type === 'client') nav.openClient(open.id);
      else if (open.type === 'appointment') nav.openAppointment(open.id);
      else if (open.type === 'deal') nav.openDeal(open.id);
      else if (open.type === 'listing') nav.openListing(open.id);
    });
  }, [handoff, setPage]);

  const idx = PAGES.indexOf(page);
  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY, axis: null }; };
  const onTouchMove = (e) => {
    const sw = swipe.current;
    if (!sw || sw.axis) return;
    const t = e.touches[0];
    const dx = t.clientX - sw.x;
    const dy = t.clientY - sw.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    sw.axis = Math.abs(dx) >= Math.abs(dy) * 2 ? 'h' : 'v';
  };
  const onTouchEnd = (e) => {
    const sw = swipe.current;
    swipe.current = null;
    if (!sw || sw.axis !== 'h') return;
    if (e.target.closest && e.target.closest('textarea, input, .km-scroll-x')) return;
    const dx = e.changedTouches[0].clientX - sw.x;
    if (Math.abs(dx) < 55) return;
    if (dx < 0 && idx < PAGES.length - 1) setPage(PAGES[idx + 1]);
    if (dx > 0 && idx > 0) setPage(PAGES[idx - 1]);
  };

  const newConversation = async () => {
    setMenu(false);
    try {
      await resetThread();
      await serena.hydrate();
      toast('Fresh conversation started');
    } catch { toast.error('Couldn’t start a new conversation'); }
  };

  const anim = phase === 'in' ? '' : phase === 'entering' ? 'is-entering' : 'is-leaving';
  return createPortal(
    <div className="km-srn-wrap" style={{ zIndex: panelZ(depth) }} role="dialog" aria-modal="true" aria-label={assistant}>
      <div className={`km-srn-scrim ${anim}`} onClick={requestClose} aria-hidden="true" />
      <div className="km-srn-column">
        <div className={`km-srn-popup km-lg ${anim}`}>
          <div className="km-srn-nav">
            <button type="button" onClick={requestClose} aria-label={`Close ${assistant}`}><Icon name="chevronLeft" size={22} stroke={2.4} /></button>
            <div className="km-srn-nav-id">
              <SerenaAvatar size={26} thinking={s.typing} />
              <span className="km-srn-nav-name">
                {PAGE_LABEL[page] || assistant}
                {page === 'chat' && s.mode === 'offline' ? <span className="km-srn-mode">· offline</span> : null}
              </span>
            </div>
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label={`${assistant} options`} style={{ justifyContent: 'flex-end' }}><Icon name="info" size={20} stroke={2} /></button>
          </div>
          {menu ? (
            <>
              <div style={{ position: 'absolute', inset: 0, zIndex: 25 }} onClick={() => setMenu(false)} aria-hidden="true" />
              <div className="km-srn-menu km-lg km-lg--menu">
                <div className="km-srn-menu-note">
                  {s.mode === 'ai'
                    ? `${assistant} is running on Claude. Every change comes with Undo, and no client message goes out without your tap.`
                    : `Offline mode: no AI key is set on the server, so ${assistant} understands a fixed set of commands — every action still has Undo and nothing sends without your tap.`}
                </div>
                <button type="button" className="km-srn-menu-row" onClick={newConversation}><Icon name="compose" size={17} stroke={2} />New conversation</button>
                <button type="button" className="km-srn-menu-row" onClick={() => { setMenu(false); setPage('todo'); }}><Icon name="checklist" size={17} stroke={2} />Open To-Do</button>
                <button type="button" className="km-srn-menu-row" onClick={() => handoff(() => nav.openSettings('assistant'))}><Icon name="settings" size={17} stroke={2} />Assistant settings</button>
              </div>
            </>
          ) : null}
          <div className="km-srn-dots" role="tablist">
            {PAGES.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={p === page} aria-label={PAGE_LABEL[p] || assistant} className={`km-srn-dot ${p === page ? 'is-on' : ''}`} onClick={() => setPage(p)} />
            ))}
          </div>
          <div className="km-srn-pager" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { swipe.current = null; }}>
            <div className="km-srn-track" style={{ transform: `translateX(-${idx * 33.3333}%)` }}>
              <section className="km-srn-page" aria-hidden={page !== 'chat'}>
                <SerenaChat active={page === 'chat' && phase === 'in'} onHandoff={handoff} onOpenCard={openCard} />
              </section>
              <section className="km-srn-page" aria-hidden={page !== 'todo'}>
                <div className="km-srn-page-scroll">
                  <SideBoundary fallback="To-dos couldn’t load. Swipe to chat.">
                    <Suspense fallback={<div className="km-srn-side-fallback">Loading your to-dos…</div>}>
                      {visited.has('todo') ? <TodoPanel onNavigate={() => { closing.current = true; onClose?.(); }} /> : null}
                    </Suspense>
                  </SideBoundary>
                </div>
              </section>
              <section className="km-srn-page" aria-hidden={page !== 'matches'}>
                <div className="km-srn-page-scroll">
                  <SideBoundary fallback="Matches couldn’t load. Swipe to chat.">
                    <Suspense fallback={<div className="km-srn-side-fallback">Loading matches…</div>}>
                      {visited.has('matches') ? <MatchDigest onNavigate={() => { closing.current = true; onClose?.(); }} onClose={() => { closing.current = true; onClose?.(); }} /> : null}
                    </Suspense>
                  </SideBoundary>
                </div>
              </section>
            </div>
          </div>
        </div>
        <button type="button" className={`km-srn-min km-lg km-lg--solid ${anim}`} onClick={requestClose} aria-label={`Minimize ${assistant}`}>
          <Icon name="x" size={15} stroke={2.4} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
