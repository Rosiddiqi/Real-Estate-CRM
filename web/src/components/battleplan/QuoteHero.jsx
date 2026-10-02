// QuoteHero — the daily quote / affirmation that BURNS AWAY as the planner is
// pulled (RevMatch signature, ported verbatim and restyled in the accent blue).
// `progress` 0..1 is owned by the rail (170 px of pull = one full open/close);
// tap toggles. The card collapses through a negative margin while its content
// shrinks, fades, blurs and is erased top-down by a mask; a glowing burn line
// and six embers ride the erase boundary. Auto-sizes so a long affirmation is
// never clipped (130 px floor).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dailyQuote, dailyAffirmation, inAffirmationWindow } from './quotes';

export default function QuoteHero({ progress = 0, onTap, affirmation: customAffirmation }) {
  const quote = useMemo(() => dailyQuote(new Date()), []);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') setNow(new Date()); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const showAffirmation = inAffirmationWindow(now);
  const display = showAffirmation
    ? { text: customAffirmation || dailyAffirmation(now), label: 'AFFIRMATION', footer: 'SAY IT OUT LOUD' }
    : { text: quote.text, label: 'INSPIRATION', footer: quote.author };

  const contentRef = useRef(null);
  const [cardH, setCardH] = useState(130);
  useLayoutEffect(() => {
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      const natural = Math.max(el.scrollHeight, el.offsetHeight);
      setCardH(Math.max(130, Math.ceil(natural) + 1));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined' && contentRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(contentRef.current);
    }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [display.text, display.label, display.footer]);

  const p = Math.max(0, Math.min(1, progress));
  const e = p * p * (3 - 2 * p);          // smoothstep
  const burn = Math.sin(p * Math.PI);     // 0 at ends, 1 at mid-burn
  const blueA = (a) => `color-mix(in srgb, var(--blue) ${Math.round(a * 100)}%, transparent)`;
  const mask = `linear-gradient(180deg, transparent 0%, transparent ${e * 30}%, rgba(0,0,0,${burn}) ${e * 30 + 5}%, #000 ${e * 30 + 15}%, #000 100%)`;

  return (
    <div
      style={{
        flexShrink: 0,
        position: 'relative',
        borderBottom: e > 0.95 ? 'none' : '1px solid var(--bp-hair)',
        overflow: 'hidden',
        height: e > 0 ? cardH : 'auto',
        marginBottom: -cardH * e,
        transition: 'margin-bottom 320ms cubic-bezier(0.4,0,0.2,1)',
        background: 'var(--bp-floor)',
      }}
    >
      <div
        ref={contentRef}
        role="button"
        tabIndex={0}
        onClick={onTap}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTap?.(); } }}
        aria-label={e > 0.5 ? 'Show the quote' : 'Hide the quote'}
        style={{
          padding: '14px 20px 16px', textAlign: 'center', cursor: 'pointer', outline: 'none',
          transform: `scaleY(${1 - 0.4 * e})`, transformOrigin: 'top center',
          opacity: 1 - e,
          filter: `blur(${4 * e}px)`,
          WebkitMaskImage: mask,
          maskImage: mask,
          transition: 'transform 280ms ease, opacity 240ms ease, filter 240ms ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 14, height: 1, background: 'var(--blue)' }} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--blue)', lineHeight: 1 }}>{display.label}</span>
          <div style={{ width: 14, height: 1, background: 'var(--blue)' }} />
        </div>
        <div
          className={`bp-quote-text ${showAffirmation ? 'bp-quote-text--aff' : ''}`}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 300, letterSpacing: -0.4, color: 'var(--bp-t1)', textWrap: 'balance' }}
        >
          <span style={{ color: 'var(--blue)' }}>&ldquo;</span>{display.text}<span style={{ color: 'var(--blue)' }}>&rdquo;</span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: 'var(--bp-t3)', marginTop: 8, textTransform: 'uppercase' }}>— {display.footer}</div>
      </div>

      {/* burn line riding the erase boundary */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: `${e * 30}%`, height: 2,
        background: `linear-gradient(90deg, transparent, var(--blue), transparent)`,
        boxShadow: `0 0 ${18 * burn}px ${blueA(burn)}`,
        opacity: burn, pointerEvents: 'none',
      }}
      />

      {/* embers */}
      {burn > 0.1 && [0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            position: 'absolute', left: `${20 + i * 12}%`, top: `${e * 30}%`,
            width: 3, height: 3, borderRadius: 2, background: 'var(--blue)',
            boxShadow: '0 0 6px var(--blue)',
            opacity: burn * (0.5 + (i % 3) * 0.15),
            transform: `translateY(${-30 * burn}px) translateX(${(i - 2.5) * 8}px)`,
            transition: 'transform 480ms ease-out, opacity 320ms ease',
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  );
}
