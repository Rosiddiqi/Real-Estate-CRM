// QuoteHero — the daily quote / affirmation that BURNS AWAY as the planner is
// pulled (RevMatch signature), dressed as Soul's photo hero: a window-light
// photograph that the Home top bar floats over, a small label, the line in
// big Poppins, and a status line with the highlight dot. `progress` 0..1 is
// owned by the rail (170 px of pull = one full open/close); tap toggles. The
// text collapses through a negative margin while it shrinks, fades, blurs and
// is erased top-down by a mask; a highlight burn line and six embers ride the
// erase boundary. `topInset` is the floating top bar's height — the photo
// runs under it and stays there once the quote has burned away.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dailyQuote, dailyAffirmation, inAffirmationWindow } from './quotes';

export default function QuoteHero({ progress = 0, onTap, affirmation: customAffirmation, topInset = 0 }) {
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
    ? { text: customAffirmation || dailyAffirmation(now), label: 'Daily affirmation', footer: 'Say it out loud' }
    : { text: quote.text, label: 'Daily inspiration', footer: quote.author };
  const len = String(display.text || '').length;
  const sizeClass = len > 120 ? 'bp-quote-text--s' : len > 64 ? 'bp-quote-text--m' : '';

  const contentRef = useRef(null);
  const [cardH, setCardH] = useState(150);
  useLayoutEffect(() => {
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      const natural = Math.max(el.scrollHeight, el.offsetHeight);
      setCardH(Math.max(150, Math.ceil(natural) + 1));
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
  const mask = `linear-gradient(180deg, transparent 0%, transparent ${e * 30}%, rgba(0,0,0,${burn}) ${e * 30 + 5}%, #000 ${e * 30 + 15}%, #000 100%)`;

  return (
    <div
      className="bp-hero"
      style={{
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        paddingTop: topInset,
        height: e > 0 ? topInset + cardH : 'auto',
        marginBottom: -cardH * e,
        transition: 'margin-bottom 320ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <div className="bp-hero-photo" aria-hidden="true" />
      {/* once the quote burns away, the photo fades into the floor under the top bar */}
      <div className="bp-hero-seal" aria-hidden="true" style={{ top: Math.max(0, topInset - 64), opacity: e }} />
      <div
        ref={contentRef}
        role="button"
        tabIndex={0}
        onClick={onTap}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTap?.(); } }}
        aria-label={e > 0.5 ? 'Show the quote' : 'Hide the quote'}
        style={{
          position: 'relative', padding: '22px 24px 30px', textAlign: 'left', cursor: 'pointer', outline: 'none',
          transform: `scaleY(${1 - 0.4 * e})`, transformOrigin: 'top center',
          opacity: 1 - e,
          filter: `blur(${4 * e}px)`,
          WebkitMaskImage: mask,
          maskImage: mask,
          transition: 'transform 280ms ease, opacity 240ms ease, filter 240ms ease',
        }}
      >
        <div className="bp-hero-label">{display.label}</div>
        <div className={`bp-quote-text ${sizeClass}`}>
          {showAffirmation ? display.text : <>&ldquo;{display.text}&rdquo;</>}
        </div>
        <div className="bp-hero-foot"><span className="bp-hero-dot" />{display.footer}</div>
      </div>

      {/* burn line riding the erase boundary */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: topInset + cardH * e * 0.3, height: 2,
        background: 'linear-gradient(90deg, transparent, var(--hl), transparent)',
        boxShadow: `0 0 ${18 * burn}px rgba(var(--hl-rgb), ${burn.toFixed(2)})`,
        opacity: burn, pointerEvents: 'none',
      }}
      />

      {/* embers */}
      {burn > 0.1 && [0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            position: 'absolute', left: `${20 + i * 12}%`, top: topInset + cardH * e * 0.3,
            width: 3, height: 3, borderRadius: 2, background: 'var(--hl)',
            boxShadow: '0 0 6px var(--hl)',
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
