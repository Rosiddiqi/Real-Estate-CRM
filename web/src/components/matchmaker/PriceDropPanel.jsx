// Matchmaker → Price Drops: homes whose list price came down recently (price
// bookkeeping: same-day falls merge, a rise clears). Each card: ↓ chip, struck
// old → new, −%, cumulative drop + DOM, and "Now in budget · N buyers" — the
// clients whose ceiling the new price just slipped under. Tap → the listing,
// where those buyers sort first and drafts quote only the two exact prices.
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { EmptyState } from '../ui/kit';
import { nav } from '../../lib/nav';
import { money, moneyCompact } from '../../lib/format';
import { LaneDot, statsLine } from '../listings/listingKit';
import { useMatchFeed } from './useMatchFeed';

function DropCard({ d, index }) {
  const budget = d.nowInBudget || [];
  return (
    <button type="button" className="mm-drop-card km-row-in" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }} onClick={() => nav.openListing(d.id)}>
      <div style={{ position: 'relative' }}>
        <PropertyPhoto src={d.photos && d.photos[0]} seed={d.id} label={d.neighborhood || d.city} ratio="16 / 10" />
        <span className="mm-drop-chip">↓ {moneyCompact(d.dropAmount)}</span>
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <div className="kl-source"><LaneDot color={d.laneColor} /><span className="kl-source-name">{d.sourceName}</span></div>
        <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.015em', marginTop: 6 }} className="km-truncate">{d.title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 2 }} className="km-truncate">{d.subtitle}</div>
        {statsLine(d) ? <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{statsLine(d)}</div> : null}
        <div className="mm-drop-prices">
          <span className="was">{money(d.previousPrice)}</span>
          <span className="now">{money(d.listPrice)}</span>
          <span className="pct">−{d.dropPct}%</span>
        </div>
        <div className="kl-eyebrow" style={{ marginTop: 6 }}>
          {d.cumulativeDrop && d.cumulativeDrop !== d.dropAmount ? `−${moneyCompact(d.cumulativeDrop)} since list · ` : ''}{d.dom != null ? `${d.dom} days on market` : ''}
        </div>
        {budget.length ? (
          <div className="mm-budget">
            <Icon name="trendingDown" size={15} color="var(--amber)" stroke={2.2} />
            <b>Now in budget · {budget.length} buyer{budget.length === 1 ? '' : 's'}</b>
            <span style={{ flex: 1 }} />
            <span className="mm-avstack">{budget.slice(0, 4).map((b) => <Avatar key={b.clientId} name={b.name} seed={b.clientId} size={24} style={{ boxShadow: '0 0 0 2px var(--surface)' }} />)}</span>
          </div>
        ) : d.matchCount ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--dim)' }}>
            <b style={{ color: 'var(--text)' }}>{d.matchCount} buyer{d.matchCount === 1 ? '' : 's'} ≥80</b>{d.topMatch ? ` · top ${d.topMatch.name} ${d.topMatch.score}` : ''}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export default function PriceDropPanel() {
  const { data, error, reload } = useMatchFeed('drops');
  const drops = data ? data.drops : [];
  return (
    <div className="mm-panel-in">
      {data && drops.length ? (
        <div style={{ fontSize: 13, color: 'var(--dim)', margin: '0 2px 14px' }}>
          {drops.length} home{drops.length === 1 ? '' : 's'} dropped in price in the last {data.windowDays === 21 ? '3 weeks' : `${data.windowDays} days`} — biggest cut first.
        </div>
      ) : null}
      {error && !data ? <div className="mm-error">Couldn't load price drops.<button type="button" onClick={reload}>Retry</button></div> : null}
      {!data && !error ? <div className="mm-stack" style={{ gap: 16 }}>{[0, 1].map((i) => <div key={i} className="km-skel" style={{ height: 300, borderRadius: 16 }} />)}</div> : null}
      {data && !drops.length ? (
        <EmptyState icon="trendingDown" title="No price drops lately" sub="When a list price comes down — from the MLS feed or your own status changes — the home lands here with the buyers it now fits." style={{ padding: '36px 20px' }} />
      ) : null}
      <div className="mm-drops">{drops.map((d, i) => <DropCard key={d.id} d={d} index={i} />)}</div>
    </div>
  );
}
