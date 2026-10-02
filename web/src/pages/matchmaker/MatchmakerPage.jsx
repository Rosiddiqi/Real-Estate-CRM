// Matchmaker tab — buyer ↔ home matching hub (RM Matchmaker.jsx, re-geared):
// a scroll-edge top bar with four modes — Whisper · Listings · Off-Market ·
// Price Drops (persisted) — over one scroll surface.
import { useEffect, useRef, useState } from 'react';
import GlassButton from '../../components/ui/GlassButton';
import { nav } from '../../lib/nav';
import WhisperPanel from '../../components/matchmaker/WhisperPanel';
import ListingsModePanel from '../../components/matchmaker/ListingsModePanel';
import OffMarketPanel from '../../components/matchmaker/OffMarketPanel';
import PriceDropPanel from '../../components/matchmaker/PriceDropPanel';
import '../../styles/listings.css';
import '../../styles/matchmaker.css';

const MODES = [
  { id: 'whisper', label: 'Whisper', full: 'Whisper' },
  { id: 'listings', label: 'Listings', full: 'Listings' },
  { id: 'offmarket', label: 'Off-Market', full: 'Off-market pairing' },
  { id: 'drops', label: 'Price Drops', full: 'Price drop' },
];
const MODE_KEY = 'km_matchmaker_mode';

export default function MatchmakerPage() {
  const [mode, setMode] = useState(() => {
    try { const m = localStorage.getItem(MODE_KEY); return MODES.some((x) => x.id === m) ? m : 'listings'; } catch { return 'listings'; }
  });
  const [edge, setEdge] = useState(false);
  const shell = useRef(null);
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } }, [mode]);
  const change = (m) => {
    setMode(m);
    if (shell.current && shell.current.scrollTop > 0) shell.current.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const label = (MODES.find((m) => m.id === mode) || MODES[1]).full;

  return (
    <div className="km-screen">
      <div className="mm-shell" ref={shell} onScroll={(e) => setEdge(e.currentTarget.scrollTop > 4)}>
        <div className="mm-glow" />
        <div className="mm-content">
          <div className={`mm-topbar km-scroll-edge ${edge ? '' : 'km-scroll-edge--idle'}`}>
            <div className="mm-header">
              <span className="mm-eyebrow" style={{ color: 'var(--dim)' }}>Matchmaker</span>
              <span style={{ flex: 1 }} />
              <GlassButton icon="estate" size={36} onClick={() => nav.openListings()} label="All listings" />
              <GlassButton icon="plus" size={36} accent onClick={() => nav.newListing(mode === 'whisper' ? { lane: 'whisper' } : {})} label="Add listing" />
            </div>
            <div className="mm-modebar">
              <div className="mm-seg km-lg km-lg--line" role="tablist" aria-label="Matchmaker modes">
                <span aria-hidden="true" className="mm-seg-lens km-lg km-lg--flat km-lg-seg" style={{ width: 'calc((100% - 8px - 12px) / 4)', transform: `translateX(calc(${MODES.findIndex((m) => m.id === mode)} * (100% + 4px)))` }} />
                {MODES.map((m) => (
                  <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => change(m.id)}>{m.label}</button>
                ))}
              </div>
              <div className="mm-mode-line">
                <span className="mm-mode-dot" />
                <span className="mm-eyebrow mm-eyebrow--blue" style={{ fontSize: 9.5 }}>{label} mode</span>
              </div>
            </div>
          </div>
          <div className="mm-panel" key={mode}>
            {mode === 'whisper' ? <WhisperPanel />
              : mode === 'offmarket' ? <OffMarketPanel />
                : mode === 'drops' ? <PriceDropPanel />
                  : <ListingsModePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
