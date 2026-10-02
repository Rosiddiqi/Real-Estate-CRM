// "Get set up" checklist sheet + the collapsed Home banner.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { nav } from '../../lib/nav';
import { BRAND } from '../../brand';

const SEEN_KEY = 'km-onboarding-autoopen';

function go(target) {
  if (target === 'clients') { nav.go('clients'); setTimeout(() => nav.newClient(), 250); }
  else if (target === 'inbox') { nav.go('inbox'); setTimeout(() => nav.compose({}), 250); }
  else if (target === 'pipeline') { nav.openPipeline(); }
  else if (target === 'payPlan') { nav.openPayPlan(); }
}

function Ring({ done, total, size = 28 }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(c * done) / total} ${c}`} />
    </svg>
  );
}

export default function OnboardingChecklist({ state, act, showBanner }) {
  const [open, setOpen] = useState(false);
  const active = state && !state.complete && !state.grandfathered;

  useEffect(() => {
    if (!active || state.dismissedAt) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch { /* ignore */ }
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, [active, state?.dismissedAt]);

  useEffect(() => {
    if (state && state.doneCount === state.total && !state.completedAt) act('complete');
  }, [state, act]);

  if (!active) return null;
  const nextIdx = state.tasks.findIndex((t) => !t.done);

  return (
    <>
      {showBanner ? (
        <button
          type="button"
          className="km-press"
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', zIndex: 320, left: 16, right: 16, maxWidth: 520, margin: '0 auto',
            bottom: 'calc(var(--tabbar-clearance) + var(--safe-bottom) - 26px)',
            height: 56, borderRadius: 14, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 12,
            background: 'var(--surfaceHi)', border: '1px solid var(--lineHi)', boxShadow: '0 16px 40px -16px rgba(0,0,0,0.7)',
          }}
        >
          <Ring done={state.doneCount} total={state.total} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>Finish setting up</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)' }}>{state.doneCount} of {state.total} done</span>
          </span>
          <Icon name="chevronRight" size={18} color="var(--faint)" />
        </button>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="Get set up" left={false} right={{ label: 'Not now', onClick: () => { act('dismiss'); setOpen(false); } }}>
        <div style={{ fontSize: 14, color: 'var(--dim)', margin: '0 2px 14px' }}>
          Five things and {BRAND.name} is yours. {state.doneCount} of {state.total} done.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {state.tasks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className="km-press"
              disabled={t.done}
              onClick={() => { setOpen(false); setTimeout(() => go(t.target), 200); }}
              style={{
                minHeight: 56, padding: '10px 12px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                background: i === nextIdx ? 'var(--tint)' : 'transparent', border: `1px solid ${i === nextIdx ? 'rgba(46,139,255,0.3)' : 'transparent'}`,
              }}
            >
              <span style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.done ? 'var(--green)' : 'transparent', border: t.done ? 'none' : '1.5px solid var(--faint)' }}>
                {t.done ? <Icon name="check" size={14} color="#fff" stroke={3} /> : null}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 16, fontWeight: t.done ? 400 : 600, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--dim)' : 'var(--text)' }}>{t.label}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--faint)', marginTop: 2 }}>{t.sub}</span>
              </span>
              {i === nextIdx ? <Icon name="chevronRight" size={16} color="var(--bright)" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
