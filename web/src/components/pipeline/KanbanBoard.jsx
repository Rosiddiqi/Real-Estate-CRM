// Kanban board — stage navigator dropdown + six snap columns + drag.
// Mobile: 88vw columns with a peek of the next; long-press the GRIP 180 ms to
// lift (moving 8px first cancels so a scroll always wins), tilted ghost, edge
// auto-scroll (both axes), spring landing. Desktop: wider multi-column board;
// drag with the mouse from the grip or anywhere on the card face.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { moneyCompact } from '../../lib/format';
import { haptic } from '../../lib/native';
import DealCard from './DealCard';
import { StageDot } from './bits';
import { stageForPhase } from './config';

const EDGE = 44;

function sortColumn(phase, list) {
  const t = (v) => (v ? new Date(v).getTime() : 0);
  if (phase === 'under_contract') {
    return [...list].sort((a, b) => (t(a.closingDate) || Infinity) - (t(b.closingDate) || Infinity) || t(b.stageChangedAt) - t(a.stageChangedAt));
  }
  if (phase === 'closed') return [...list].sort((a, b) => t(b.closedAt) - t(a.closedAt));
  return [...list].sort((a, b) => t(b.stageChangedAt) - t(a.stageChangedAt));
}
const fmtCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

function Ghost({ deal, x, y, dropping, ghostRef }) {
  if (!deal) return null;
  return (
    <div ref={ghostRef} className={`km-pl-ghost ${dropping ? 'km-pl-ghost--drop' : ''}`} style={{ left: x - 140, top: y - 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="km-truncate" style={{ fontSize: 14, fontWeight: 600 }}>{deal.name}</div>
          <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)' }}>{deal.address || deal.label}</div>
        </div>
        {deal.price ? <div className="km-pl-price-v">{moneyCompact(deal.price)}</div> : null}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  deals, cfg, pageRef, expandedId, setExpandedId, onUpdate, onSave, onAdvance, onStageChange, onRequestLost, onDelete,
  landedId, flashId,
}) {
  const scrollRef = useRef(null);
  const colRefs = useRef([]);
  const [colIdx, setColIdx] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [drag, setDrag] = useState(null); // { id, x, y, over, dropping }
  const dragRef = useRef(null);
  const ghostRef = useRef(null);
  const justDragged = useRef(false);
  const phases = cfg.phases;

  const byPhase = useMemo(() => {
    const g = Object.fromEntries(phases.map((p) => [p.id, []]));
    for (const d of deals) if (g[d.phase]) g[d.phase].push(d);
    for (const k of Object.keys(g)) g[k] = sortColumn(k, g[k]);
    return g;
  }, [deals, phases]);

  const countOf = (pid) => (pid === 'closed'
    ? byPhase.closed.reduce((s, d) => s + ((d.estimates && d.estimates.sides) ?? 1), 0)
    : byPhase[pid].length);
  const volumeOf = (pid) => byPhase[pid].reduce((s, d) => s + (d.group === 'leases' || d.side === 'referral_out' ? 0 : (d.price || 0)), 0);

  // column index ↔ scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const first = colRefs.current[0];
      const w = first ? first.offsetWidth + 14 : el.clientWidth * 0.88;
      setColIdx(Math.max(0, Math.min(phases.length - 1, Math.round(el.scrollLeft / w))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [phases.length]);

  const scrollToColumn = useCallback((i, smooth = true) => {
    const el = scrollRef.current;
    const col = colRefs.current[i];
    if (!el || !col) return;
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 14;
    el.scrollTo({ left: Math.max(0, col.offsetLeft - pad), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // ── drag ────────────────────────────────────────────────────────────────
  const hitTest = (x) => {
    for (let i = 0; i < colRefs.current.length; i++) {
      const c = colRefs.current[i];
      if (!c) continue;
      const r = c.getBoundingClientRect();
      if (x >= r.left - 5 && x <= r.right + 5) return phases[i].id;
    }
    return null;
  };

  const stopLoop = () => { if (dragRef.current && dragRef.current.raf) cancelAnimationFrame(dragRef.current.raf); };
  const loop = () => {
    const st = dragRef.current;
    if (!st || !st.active) return;
    const el = scrollRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (st.x > r.right - EDGE) el.scrollLeft += 12;
      else if (st.x < r.left + EDGE) el.scrollLeft -= 12;
    }
    const page = pageRef && pageRef.current;
    if (page) {
      const pr = page.getBoundingClientRect();
      if (st.y > pr.bottom - 120) page.scrollTop += 10;
      else if (st.y < pr.top + 80) page.scrollTop -= 10;
    }
    const g = ghostRef.current;
    if (g) { g.style.left = `${st.x - 140}px`; g.style.top = `${st.y - 30}px`; }
    const over = hitTest(st.x);
    if (over !== st.over) {
      st.over = over;
      setDrag((d) => (d && !d.dropping ? { ...d, over } : d));
    }
    st.raf = requestAnimationFrame(loop);
  };

  const finish = useCallback((commit) => {
    const st = dragRef.current;
    window.removeEventListener('pointermove', onMoveRef.current, { capture: true });
    window.removeEventListener('pointerup', onUpRef.current, { capture: true });
    window.removeEventListener('pointercancel', onCancelRef.current, { capture: true });
    if (!st) return;
    clearTimeout(st.timer);
    stopLoop();
    dragRef.current = null;
    if (!st.active) return;
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 80);
    if (scrollRef.current) scrollRef.current.classList.remove('km-pl-cols--dragging');
    const over = commit ? hitTest(st.x) : null;
    const deal = deals.find((d) => d.id === st.id);
    setDrag((d) => (d ? { ...d, x: st.x, y: st.y, dropping: true } : d));
    setTimeout(() => setDrag(null), 170);
    if (deal && over && over !== deal.phase) {
      haptic('light');
      onStageChange(deal, stageForPhase(cfg, over, deal.side), { dropped: true });
    }
  }, [deals, cfg, onStageChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMoveRef = useRef(null);
  const onUpRef = useRef(null);
  const onCancelRef = useRef(null);

  const start = (st) => {
    st.active = true;
    haptic('medium');
    try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* noop */ }
    if (scrollRef.current) scrollRef.current.classList.add('km-pl-cols--dragging');
    const deal = deals.find((d) => d.id === st.id);
    st.over = deal ? deal.phase : null;
    setDrag({ id: st.id, x: st.x, y: st.y, over: st.over, dropping: false });
    st.raf = requestAnimationFrame(loop);
  };

  const begin = (e, deal, { mouseOnly = false } = {}) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (mouseOnly && e.pointerType !== 'mouse') return;
    if (dragRef.current) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button:not([data-drag-handle]), a')) {
      if (!e.target.closest('[data-drag-handle]')) return;
    }
    const st = { id: deal.id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, pointerId: e.pointerId, mouse: e.pointerType === 'mouse', active: false };
    dragRef.current = st;
    if (!st.mouse) st.timer = setTimeout(() => { if (dragRef.current === st) start(st); }, 180);
    const onMove = (ev) => {
      const s = dragRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      s.x = ev.clientX; s.y = ev.clientY;
      if (!s.active) {
        const dist = Math.hypot(s.x - s.sx, s.y - s.sy);
        if (s.mouse) { if (dist > 5) start(s); return; }
        if (dist > 8) finish(false);
        return;
      }
      if (ev.cancelable) ev.preventDefault();
    };
    const onUp = (ev) => { if (dragRef.current && ev.pointerId === dragRef.current.pointerId) finish(true); };
    const onCancel = (ev) => { if (dragRef.current && ev.pointerId === dragRef.current.pointerId) finish(false); };
    onMoveRef.current = onMove; onUpRef.current = onUp; onCancelRef.current = onCancel;
    window.addEventListener('pointermove', onMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onCancel, { capture: true });
  };

  useEffect(() => () => { // unmount mid-drag
    const st = dragRef.current;
    if (st) { clearTimeout(st.timer); stopLoop(); }
    window.removeEventListener('pointermove', onMoveRef.current, { capture: true });
    window.removeEventListener('pointerup', onUpRef.current, { capture: true });
    window.removeEventListener('pointercancel', onCancelRef.current, { capture: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = phases[Math.min(colIdx, phases.length - 1)] || phases[0];
  const dragDeal = drag ? deals.find((d) => d.id === drag.id) : null;

  return (
    <div>
      <div className="km-pl-nav">
        <button type="button" className={`km-pl-nav-btn km-press ${navOpen ? 'km-pl-nav-btn--open' : ''}`} onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen} aria-label="Jump to a stage">
          <StageDot color={current.color} glow />
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>{current.label}</span>
          <span className="km-mono" style={{ fontSize: 10.5, fontWeight: 700, color: countOf(current.id) > 0 ? 'var(--blue)' : 'var(--faint)' }}>{fmtCount(countOf(current.id))}</span>
          <span style={{ flex: 1 }} />
          <span className="km-mono" style={{ fontSize: 9, letterSpacing: 1.2, color: 'var(--faint)' }}>{Math.min(colIdx, phases.length - 1) + 1} / {phases.length}</span>
          <Icon name="chevronDown" size={13} color="var(--faint)" style={{ transform: navOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }} />
        </button>
        {navOpen ? (
          <>
            <div onClick={() => setNavOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
            <div className="km-pl-nav-menu" role="listbox">
              {phases.map((p, i) => {
                const on = i === colIdx;
                const n = countOf(p.id);
                return (
                  <button key={p.id} type="button" role="option" aria-selected={on} className={`km-pl-nav-row ${on ? 'km-pl-nav-row--on' : ''}`} onClick={() => { scrollToColumn(i); setNavOpen(false); }}>
                    <StageDot color={p.color} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: on ? 700 : 500 }}>{p.label}</span>
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--faint)', marginTop: 1 }}>{p.sub}</span>
                    </span>
                    <span style={{ flex: 1 }} />
                    {volumeOf(p.id) ? <span className="km-mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginRight: 4 }}>{moneyCompact(volumeOf(p.id))}</span> : null}
                    <span className="km-mono" style={{ fontSize: 11, fontWeight: 700, color: n > 0 ? 'var(--blue)' : 'var(--faint)' }}>{fmtCount(n)}</span>
                    {on ? <Icon name="check" size={13} color="var(--blue)" stroke={3} /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <div ref={scrollRef} className="km-pl-cols">
        {phases.map((p, i) => {
          const list = byPhase[p.id];
          const target = drag && !drag.dropping && drag.over === p.id && dragDeal && dragDeal.phase !== p.id;
          const vol = volumeOf(p.id);
          return (
            <section key={p.id} ref={(el) => { colRefs.current[i] = el; }} data-col-stage={p.id} className={`km-pl-col ${target ? 'km-pl-col--target' : ''}`} aria-label={`${p.label} column`}>
              <div className="km-pl-col-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <StageDot color={p.color} glow />
                  <span className="km-pl-col-label">{p.label}</span>
                  <span className="km-pl-col-count">{fmtCount(countOf(p.id))}{p.id === 'closed' && list.length ? ' sides' : ''}</span>
                </div>
                {vol ? <span className="km-pl-col-vol">{moneyCompact(vol)}</span> : <span className="km-pl-col-sub">{p.sub}</span>}
              </div>
              <div className="km-pl-col-rule" style={{ background: `linear-gradient(90deg, ${p.color}, transparent)` }} />
              <div className="km-pl-col-body">
                {list.length === 0 ? (
                  <div className="km-pl-col-empty">{p.id === 'closed' ? 'Nothing closed this month yet' : 'No deals'}</div>
                ) : list.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    cfg={cfg}
                    expanded={expandedId === d.id}
                    onToggle={() => { if (!justDragged.current) setExpandedId(expandedId === d.id ? null : d.id); }}
                    onUpdate={(partial) => onUpdate(d.id, partial)}
                    onSave={() => onSave(d.id)}
                    onAdvance={onAdvance}
                    onStageChange={onStageChange}
                    onRequestLost={onRequestLost}
                    onDelete={onDelete}
                    dragging={drag && drag.id === d.id}
                    landed={landedId === d.id}
                    flash={flashId === d.id}
                    onGripPointerDown={(e) => { e.stopPropagation(); begin(e, d); }}
                    onCardPointerDown={expandedId === d.id ? undefined : (e) => begin(e, d, { mouseOnly: true })}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {drag ? <Ghost ghostRef={ghostRef} deal={dragDeal} x={drag.x} y={drag.y} dropping={drag.dropping} /> : null}
    </div>
  );
}
