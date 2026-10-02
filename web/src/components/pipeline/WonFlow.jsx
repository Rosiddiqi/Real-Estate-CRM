// The won flow — ONE two-beat finish used by EVERY path into Closed (board
// drag, stage dropdown, Deal sheet, New Deal created at Closed, other
// builders): CLOSED! (buyer) / SOLD! (listing) fireworks with money + keys
// raining for ~5 s, then "What did you net on {First}'s closing?" with a
// Closed-on date (defaults today). Ported from RevMatch DealWonFlow +
// WonCelebration; respects prefers-reduced-motion.
//
//   import { runWonFlow } from '../pipeline/WonFlow';
//   const res = await runWonFlow(deal);   // → { commission, closedAt } | null (Later)
//   or render <WonFlow deal={deal} onDone={(res) => …} /> yourself.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { haptic } from '../../lib/native';
import { first, todayInput, toDateInput } from './bits';
import '../../styles/pipeline.css';

const DURATION = 5000;
const COLORS = ['#2E8BFF', '#FF5A5A', '#30D27A', '#4DA2FF', '#9A4DFF', '#F2A93B', '#FFFFFF'];
const FIREWORKS = 12;
const SPARKS = 16;
const DROPS = 50;

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function wonTitle(deal) {
  const side = deal && deal.side;
  if (side === 'lease_tenant' || side === 'lease_landlord') return 'LEASED!';
  if (side === 'referral_out') return 'PAID!';
  if (side === 'listing' || side === 'dual') return 'SOLD!';
  return 'CLOSED!';
}

function Firework({ left, delay, color, peak }) {
  const sparks = useMemo(() => Array.from({ length: SPARKS }, (_, i) => {
    const a = (i / SPARKS) * Math.PI * 2;
    const dist = 130 + Math.random() * 90;
    return { i, dx: Math.cos(a) * dist, dy: -Math.sin(a) * dist };
  }), []);
  return (
    <>
      <div
        className="km-won-trail"
        style={{ left: `${left}%`, height: `${peak}vh`, background: `linear-gradient(to top, transparent 0%, ${color}aa 70%, ${color} 100%)`, animation: `km-won-launch 0.5s ${delay}s ease-out both` }}
      />
      {sparks.map((p) => (
        <div
          key={p.i}
          className="km-won-spark"
          style={{
            left: `${left}%`, bottom: `${peak}vh`, background: color, boxShadow: `0 0 10px ${color}, 0 0 20px ${color}88`,
            animation: `km-won-burst 1.6s ${delay + 0.5}s cubic-bezier(0.15, 0.55, 0.3, 1) both`,
            '--dx': `${p.dx}px`, '--dy': `${p.dy}px`,
          }}
        />
      ))}
    </>
  );
}

export function WonCelebration({ deal, onDismiss }) {
  const reduced = reducedMotion();
  useEffect(() => {
    const t = setTimeout(onDismiss, reduced ? 1800 : DURATION);
    return () => clearTimeout(t);
  }, [onDismiss, reduced]);
  const fireworks = useMemo(() => Array.from({ length: reduced ? 0 : FIREWORKS }, (_, i) => {
    const t = i / (FIREWORKS - 1);
    const delay = t < 0.5 ? t * 4.5 : 2.2 + (t - 0.5) * 5.0;
    return { id: i, left: 8 + Math.random() * 84, delay: Math.min(delay, 4.6), color: COLORS[Math.floor(Math.random() * COLORS.length)], peak: 50 + Math.random() * 25 };
  }), [reduced]);
  const drops = useMemo(() => Array.from({ length: reduced ? 0 : DROPS }, (_, i) => {
    const duration = 2.4 + Math.random() * 1.6;
    return {
      id: i, key: i % 3 === 0, left: Math.random() * 100, delay: Math.random() * 3.6, duration,
      rs: Math.round(-30 + Math.random() * 60), re: Math.round(-180 + Math.random() * 720), sway: 12 + Math.round(Math.random() * 24),
    };
  }), [reduced]);
  const address = deal.address || deal.propertyLabel;
  return (
    <div className="km-won" onClick={onDismiss} role="presentation">
      {fireworks.map((f) => <Firework key={f.id} {...f} />)}
      {drops.map((b) => (
        <div
          key={b.id}
          className="km-won-drop"
          style={{
            left: `${b.left}%`,
            animation: `km-won-fall ${b.duration}s ${b.delay}s linear both, km-won-sway ${b.duration / 2}s ${b.delay}s ease-in-out infinite alternate`,
            '--rotStart': `${b.rs}deg`, '--rotEnd': `${b.re}deg`, '--sway': `${b.sway}px`,
          }}
        >
          {b.key ? <Icon name="key" size={24} color="#F5C24B" stroke={2.2} /> : <div className="km-won-bill">$</div>}
        </div>
      ))}
      <div className="km-won-center">
        <div className="km-won-title">{wonTitle(deal)}</div>
        <div className="km-won-name">{deal.name || (deal.client && deal.client.name) || 'Deal closed'}</div>
        <div className="km-won-sub">{address || 'Deal closed'}</div>
        <div className="km-won-keys"><Icon name="key" size={30} stroke={2} /></div>
      </div>
    </div>
  );
}

export function NetPrompt({ deal, open, onDone }) {
  const est = deal.commission != null ? deal.commission : deal.estimates ? deal.estimates.net : null;
  const [amount, setAmount] = useState(est > 0 ? String(Math.round(est)) : '');
  const [date, setDate] = useState(deal.closedAt ? toDateInput(deal.closedAt) : todayInput());
  const value = Number(String(amount).replace(/[^0-9.]/g, '')) || 0;
  const dateChanged = date && date !== (deal.closedAt ? toDateInput(deal.closedAt) : todayInput());
  const split = deal.splitShare != null && deal.splitShare < 1;
  const lease = deal.side === 'lease_tenant' || deal.side === 'lease_landlord';
  const title = lease ? 'Leased' : deal.side === 'listing' || deal.side === 'dual' ? 'Sold' : deal.side === 'referral_out' ? 'Referral paid' : 'Closed';
  const save = () => onDone({ commission: value > 0 ? Math.round(value) : undefined, closedAt: date || undefined });
  return (
    <Sheet open={open} onClose={() => onDone(null)} title={title} left={false} zIndex={10010}>
      <div style={{ padding: '2px 2px 6px' }}>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 6 }}>
            What did you net on {first(deal.name)}’s closing?
          </div>
          <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.45, marginBottom: 14 }}>
            Optional — you can always add it later in Commissions.
            {est > 0 ? ' Starting from your estimate — change it if it came in different.' : ''}
            {split ? ` This deal is split ${Math.round(deal.splitShare * 100)}/${Math.round((1 - deal.splitShare) * 100)} — enter YOUR share, it’s never re-split.` : ''}
          </div>
          <div className="km-pl-bigamt" style={{ marginBottom: 12 }}>
            <span>$</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              aria-label="Net commission"
              value={amount ? Number(String(amount).replace(/[^0-9.]/g, '') || 0).toLocaleString('en-US') : ''}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            />
          </div>
          <div className="km-pl-field" style={{ marginBottom: 4 }}>
            <span className="km-pl-field-l" style={{ fontSize: 13.5 }}>Closed on</span>
            <div className="km-pl-amt km-pl-amt--date">
              <input type="date" aria-label="Closed on" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="km-pl-btnrow">
            <button type="button" className="km-pl-btn km-press" onClick={() => onDone(null)}>Later</button>
            <button type="button" className="km-pl-btn km-pl-btn--primary km-press" style={{ flex: 2 }} disabled={!(value > 0) && !dateChanged} onClick={save}>
              {value > 0 ? 'Save commission' : 'Save date'}
            </button>
          </div>
      </div>
    </Sheet>
  );
}

export default function WonFlow({ deal, onDone }) {
  const [phase, setPhase] = useState('celebrate');
  const [result, setResult] = useState(undefined);
  useEffect(() => { haptic('success'); }, []);
  useEffect(() => {
    if (result === undefined) return undefined;
    const t = setTimeout(() => onDone && onDone(result), 260);
    return () => clearTimeout(t);
  }, [result, onDone]);
  if (!deal) return null;
  return (
    <>
      {phase === 'celebrate' ? <WonCelebration deal={deal} onDismiss={() => setPhase('prompt')} /> : null}
      {phase !== 'celebrate' ? (
        <NetPrompt deal={deal} open={result === undefined} onDone={(r) => { if (result === undefined) setResult(r); }} />
      ) : null}
    </>
  );
}

// Imperative runner — mounts the flow in its own root (no shell edits needed),
// resolves with { commission?, closedAt? } or null.
let active = null;
export function runWonFlow(deal) {
  if (!deal) return Promise.resolve(null);
  if (active) return active;
  active = new Promise((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('data-km-won', '');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (res) => {
      resolve(res || null);
      active = null;
      setTimeout(() => { try { root.unmount(); } catch { /* noop */ } host.remove(); }, 0);
    };
    root.render(<WonFlow deal={deal} onDone={done} />);
  });
  return active;
}
