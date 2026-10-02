// PropertyTile — one Portfolio property (RevMatch GarageCarTile, re-geared):
// 4:3 photo with bucket + value blur pills, address/building + unit,
// neighborhood, spec line, money cells (value · equity / sold · held / rent ·
// lease), lifecycle badges, footer.
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { REL, relLabel, valuePill, propTitle, propSub, specLineP, waterLine, money, TONE_CLASS, photoOf, fmtMonthYear, featureList } from './portfolioKit';

function cells(p) {
  const d = p.derived || {};
  if (p.relationship === 'sold') {
    return [
      ['Sold', p.soldPrice ? money(p.soldPrice) : '—'],
      [d.appreciation != null ? 'Gain' : 'Held', d.appreciation != null ? `${d.appreciation >= 0 ? '+' : '−'}${money(Math.abs(d.appreciation))}` : d.heldYears != null ? `${d.heldYears} yrs` : '—'],
    ];
  }
  if (p.relationship === 'rents') {
    return [['Rent', p.rentAmount ? `${money(p.rentAmount)}/mo` : '—'], ['Lease ends', p.leaseEndsAt ? fmtMonthYear(p.leaseEndsAt) : '—']];
  }
  if (p.relationship === 'watching') {
    return [['Value', p.estValue ? money(p.estValue) : '—'], ['MLS #', p.mlsNumber || '—']];
  }
  const equity = d.equity != null ? `${money(d.equity)}${d.ltv != null && d.ltv > 0 ? ` · ${Math.round(d.ltv * 100)}% LTV` : d.freeAndClear ? ' · clear' : ''}` : '—';
  return [['Est. value', p.estValue ? money(p.estValue) : '—'], ['Equity', equity]];
}

function footLeft(p) {
  const d = p.derived || {};
  if (p.relationship === 'sold') return [p.soldAt ? `Sold ${new Date(p.soldAt).getFullYear()}` : 'Sold', d.heldYears ? `held ${d.heldYears} yrs` : null].filter(Boolean).join(' · ');
  if (p.relationship === 'rents') return d.daysToLeaseEnd != null && d.daysToLeaseEnd >= 0 ? `Lease ends in ${d.daysToLeaseEnd} days` : 'Renting';
  if (p.relationship === 'watching') return 'Watching for them';
  if (p.purchasedAt) return [`Bought ${new Date(p.purchasedAt).getFullYear()}`, p.purchasePrice ? money(p.purchasePrice) : null, d.heldYears ? `${d.heldYears} yrs` : null].filter(Boolean).join(' · ');
  return 'Purchase details not captured';
}

export default function PropertyTile({ p, onOpen }) {
  const rel = REL[p.relationship] || REL.owns;
  const vp = valuePill(p);
  const wl = waterLine(p);
  const spec = specLineP(p);
  return (
    <button type="button" className="kc-tile km-press" onClick={() => onOpen(p)}>
      <div className="kc-tile-photo">
        <PropertyPhoto src={photoOf(p)} seed={p.id} ratio="4 / 3" label={p.neighborhood || p.city || undefined} />
        <div className="kc-tl">
          <span className="kc-blurpill"><span className="kc-dot" style={{ background: rel.dot, boxShadow: `0 0 6px ${rel.dot}` }} />{relLabel(p)}</span>
          {p.boughtWithMe || p.soldWithMe ? <span className="kc-blurpill" style={{ fontFamily: 'var(--kc-mono)', fontSize: 9.5, letterSpacing: '0.12em' }}>{p.soldWithMe ? 'SOLD WITH YOU' : 'BOUGHT WITH YOU'}</span> : null}
        </div>
        {vp ? <div className="kc-br"><span className="kc-blurpill" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{vp}</span></div> : null}
      </div>
      <div className="kc-tile-body">
        <div className="kc-tile-title km-truncate">{propTitle(p)}</div>
        {propSub(p) ? <div className="kc-tile-sub km-truncate">{propSub(p)}</div> : null}
        {spec || wl ? <div className="kc-tile-sub km-truncate" style={{ color: 'var(--faint)' }}>{[spec, wl].filter(Boolean).join(' · ')}</div> : null}
        <div className="kc-cells">
          {cells(p).map(([l, v]) => (
            <div key={l} className="kc-cell">
              <div className="kc-cell-l">{l}</div>
              <div className="kc-cell-v">{v}</div>
            </div>
          ))}
        </div>
        {featureList(p).length ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, overflow: 'hidden' }}>
            {featureList(p).slice(0, 2).map((f) => (
              <span key={f.name} className={`kc-ochip ${f.confirmed ? 'kc-ochip--ok' : 'kc-ochip--soft'}`}>
                {f.confirmed ? <Icon name="check" size={10} color="var(--bright)" stroke={2.6} /> : null}{f.name}
              </span>
            ))}
            {featureList(p).length > 2 ? <span className="kc-ochip" style={{ color: 'var(--dim)' }}>+{featureList(p).length - 2}</span> : null}
          </div>
        ) : null}
        {(p.badges || []).filter((b) => !['bought', 'sold'].includes(b.key)).length ? (
          <div className="kc-badges">
            {p.badges.filter((b) => !['bought', 'sold'].includes(b.key)).map((b) => (
              <span key={b.key} className={`kc-tag ${TONE_CLASS[b.tone] || ''}`}>
                <Icon name={b.key === 'arm' || b.key === 'maturity' ? 'percent' : b.key === 'lease' ? 'key' : b.key === 'anniversary' ? 'cake' : b.key === 'selling' ? 'sign' : 'info'} size={11} stroke={2.2} />
                {b.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="kc-tile-foot">
          <span className="km-truncate" style={{ color: 'var(--dim)', fontWeight: 500 }}>{footLeft(p)}</span>
          <span style={{ color: 'var(--bright)', flexShrink: 0 }}>Open ›</span>
        </div>
      </div>
    </button>
  );
}
