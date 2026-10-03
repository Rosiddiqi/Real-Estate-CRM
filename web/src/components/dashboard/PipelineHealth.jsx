// Pipeline Health — open deals nobody has touched in 5+ days (stalest first),
// with the expected GCI they're holding hostage. Long-escrow new-development
// deals are excluded server-side. Tap → the deal on the pipeline board.
import Icon from '../ui/Icon';
import { Stars } from '../ui/kit';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';

const TIERS = [
  { min: 20e6, label: 'TROPHY', fg: '#FF7A6E' },
  { min: 10e6, label: 'ESTATE', fg: 'var(--violet)' },
  { min: 5e6, label: 'LUXURY', fg: 'var(--blue)' },
  { min: 2e6, label: 'PREMIER', fg: 'var(--bright)' },
  { min: 0, label: 'CORE', fg: 'var(--dim)' },
];
export function TierChip({ price }) {
  if (!price) return null;
  const t = TIERS.find((x) => price >= x.min);
  return (
    <span className="st-tier" style={{ color: t.fg, background: `color-mix(in srgb, ${t.fg} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${t.fg} 30%, transparent)` }}>{t.label}</span>
  );
}

export default function PipelineHealth({ deals = [], trapped = 0 }) {
  if (!deals.length) {
    return (
      <div style={{ padding: '0 20px' }}>
        <div className="st-plain" style={{ padding: '20px 16px', textAlign: 'center' }}>
          <Icon name="shield" size={20} color="var(--green)" />
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.4, color: 'var(--faint)', textTransform: 'uppercase', margin: '8px 0 6px' }}>No at-risk deals</div>
          <div style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: '17px' }}>Every active deal has been touched in the last 5 days. Good shape.</div>
        </div>
      </div>
    );
  }
  const stalest = deals.reduce((m, d) => Math.max(m, d.daysStale || 0), 0);
  return (
    <div style={{ padding: '0 20px' }}>
      <div className="st-plain" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: 'rgba(255,90,90,0.06)', border: '1px solid rgba(255,90,90,0.2)', borderRadius: 10, marginBottom: 6 }}>
          <Icon name="sparkle" size={13} color="var(--red)" stroke={2} style={{ marginTop: 2 }} />
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: '17px' }}>
            <strong>{moneyCompact(trapped)} GCI trapped</strong> across {deals.length} deal{deals.length === 1 ? '' : 's'} with no touch in 5+ days. The stalest has gone {stalest} days.
          </div>
        </div>
        {deals.map((d) => (
          <button key={d.id} type="button" className="st-row km-press" onClick={() => nav.openPipeline(d.id)}>
            <div style={{ width: 38, flexShrink: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: d.daysStale >= 14 ? 'var(--red)' : 'var(--amber)', letterSpacing: -0.4, lineHeight: 1 }}>{d.daysStale}d</div>
              <div style={{ fontSize: 8.5, color: 'var(--faint)', fontWeight: 600, letterSpacing: 1, marginTop: 2 }}>STALE</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, minWidth: 0 }}>
                <TierChip price={d.price} />
                {d.whale ? <Icon name="crown" size={12} color="var(--text)" /> : null}
                {d.stars ? <Stars value={d.stars} size={9} gap={1} /> : null}
              </div>
              <div className="km-truncate" style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: -0.2 }}>{d.clientName}</div>
              <div className="km-truncate" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{[d.stageLabel, d.property].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', letterSpacing: -0.3 }}>{moneyCompact(d.gci)}</div>
              <div style={{ fontSize: 8.5, color: 'var(--faint)', fontWeight: 600, letterSpacing: 0.8, marginTop: 1 }}>AT RISK</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
