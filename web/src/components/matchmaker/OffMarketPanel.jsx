// Matchmaker → Off-Market (RM C2C): a home one client OWNS fits another
// client's search — a private, double-ended deal. Seller-likelihood triggers
// (tenure, loan events, stated plans, expired listing, second home) decide
// active vs watching. Two private drafts — to the owner and to the buyer —
// neither reveals the other.
import { useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { ScoreDial, Spinner, EmptyState } from '../ui/kit';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import { ListingThumb } from '../listings/listingKit';
import { BucketChip, WhaleChip, WhyRating, useDraftText, dismissMatch, firstOf } from './MatchUI';
import { useMatchFeed } from './useMatchFeed';

const TRIGGER_ICON = { tenure: 'clock', loan_event: 'percent', stated_intent: 'quote', prior_listing: 'sign', second_home: 'house' };

function Triggers({ triggers }) {
  if (!triggers || !triggers.length) return <div className="mm-triggers"><span className="mm-trigger">No sell signal yet</span></div>;
  return (
    <div className="mm-triggers">
      {triggers.slice(0, 3).map((t) => (
        <span key={`${t.kind}-${t.label}`} className={`mm-trigger ${t.status === 'active' ? 'mm-trigger--active' : ''}`} title={t.quote || ''}>
          <Icon name={TRIGGER_ICON[t.kind] || 'flag'} size={11} stroke={2.2} />{t.label}
        </span>
      ))}
    </div>
  );
}

function PairCard({ p, first, onDismiss }) {
  const [open, setOpen] = useState(false);
  const { draft, isBusy } = useDraftText();
  const ownerBusy = isBusy(p.owner.clientId, p.property.id, 'offmarket_owner');
  const buyerBusy = isBusy(p.buyer.clientId, p.property.id, 'offmarket_buyer');
  const active = p.status === 'active';
  return (
    <div className={`mm-pair ${active ? 'mm-pair--active' : ''} km-row-in`}>
      {first && active ? <div className="mm-callfirst mm-pair-callfirst">CALL TODAY</div> : null}
      <div className="mm-pair-grid" style={{ paddingTop: first && active ? 22 : 14 }}>
        <div className="mm-party">
          <span className="mm-party-k" style={{ color: '#C08BFF' }}>Owns</span>
          <button type="button" className="mm-party-name" onClick={() => nav.openClient(p.owner.clientId)}>
            <Avatar name={p.owner.name} seed={p.owner.clientId} src={p.owner.avatarUrl} size={26} />
            <span className="km-truncate">{p.owner.name}</span>
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ListingThumb src={p.property.photo} seed={p.property.id} w={44} h={32} radius={7} />
            <div style={{ minWidth: 0 }}>
              <div className="mm-party-sub km-truncate" style={{ color: 'var(--text)', fontWeight: 600 }}>{p.property.label}</div>
              {p.property.estValue ? <div className="mm-party-sub">est. {moneyCompact(p.property.estValue)}</div> : null}
            </div>
          </div>
          <Triggers triggers={p.triggers} />
        </div>
        <div className="mm-swap">
          <span className="mm-swap-line" />
          <ScoreDial value={p.score} size={44} stroke={3} fontSize={14} label={`${p.score}${p.buyer.verifyHold ? '*' : ''}`} />
          <Icon name="arrowRight" size={14} color="var(--faint)" />
          <span className="mm-swap-line" />
        </div>
        <div className="mm-party" style={{ alignItems: 'flex-end', textAlign: 'right' }}>
          <span className="mm-party-k" style={{ color: 'var(--bright)' }}>Wants</span>
          <button type="button" className="mm-party-name" style={{ justifyContent: 'flex-end' }} onClick={() => nav.openClient(p.buyer.clientId)}>
            <span className="km-truncate">{p.buyer.name}</span>
            <Avatar name={p.buyer.name} seed={p.buyer.clientId} src={p.buyer.avatarUrl} size={26} />
          </button>
          <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <BucketChip bucket={p.buyer.bucket} />{p.buyer.whale ? <WhaleChip /> : null}
          </div>
          <div className="mm-party-sub km-clamp-2">{p.buyer.searchSummary || p.buyer.summary}</div>
        </div>
      </div>
      <div className="mm-narr">“{p.narrative}”</div>
      <button type="button" className="mm-collapse" style={{ padding: '10px 14px 0' }} onClick={() => setOpen((v) => !v)}>
        <span className="mm-eyebrow">Why it fits</span><span className="rule" />
        <Icon name="chevronDown" size={15} className={`mm-chev ${open ? '' : 'mm-chev--closed'}`} />
      </button>
      {open ? <div style={{ padding: '0 14px' }}><WhyRating result={p.buyer} signals={p.buyer.signals} title="Fit to their search" /></div> : null}
      <div className="mm-pair-btns">
        <button type="button" className="mm-ghost" disabled={ownerBusy} onClick={() => draft({ clientId: p.owner.clientId, name: p.owner.name, propertyId: p.property.id, mode: 'offmarket_owner' })}>
          {ownerBusy ? <Spinner size={14} /> : <Icon name="message" size={15} stroke={1.9} />} Text {firstOf(p.owner.name)}
        </button>
        <button type="button" className="mm-draft" style={{ minHeight: 40 }} disabled={buyerBusy} onClick={() => draft({ clientId: p.buyer.clientId, name: p.buyer.name, propertyId: p.property.id, mode: 'offmarket_buyer' })}>
          {buyerBusy ? <Spinner size={14} color="#fff" /> : <Icon name="message" size={15} stroke={1.9} />} Text {firstOf(p.buyer.name)}
        </button>
        <button type="button" className="mm-icon-btn" style={{ width: 40, height: 40 }} aria-label="Not a fit" onClick={() => onDismiss(p)}><Icon name="eyeOff" size={16} stroke={1.9} /></button>
      </div>
    </div>
  );
}

export default function OffMarketPanel() {
  const { data, error, reload, patch } = useMatchFeed('offmarket');
  const pairs = data ? data.pairs : [];
  const active = pairs.filter((p) => p.status === 'active');
  const watching = pairs.filter((p) => p.status !== 'active');
  const onDismiss = (p) => {
    const snapshot = data;
    dismissMatch({ clientId: p.buyer.clientId, propertyId: p.property.id, matchId: p.matchId, score: p.score, name: p.buyer.name }, {
      onRemove: () => patch((d) => ({ ...d, pairs: d.pairs.filter((x) => x.id !== p.id) })),
      onRestore: () => { patch(() => snapshot); reload(); },
    });
  };
  return (
    <div className="mm-panel-in">
      <div className="mm-status-strip">
        <span className="mm-live-dot" />
        <span style={{ flex: 1 }}>{data ? `Watching ${data.counts.ownedHomes} owned home${data.counts.ownedHomes === 1 ? '' : 's'} · ${active.length} active · ${watching.length} watching` : 'Checking your clients’ homes…'}</span>
      </div>
      <p className="mm-blurb" style={{ marginTop: 12 }}>When one client owns exactly what another is searching for: a private, double-ended deal. Neither text reveals the other side.</p>
      {error && !data ? <div className="mm-error">Couldn't load pairs.<button type="button" onClick={reload}>Retry</button></div> : null}
      {!data && !error ? <div className="mm-stack">{[0, 1].map((i) => <div key={i} className="km-skel" style={{ height: 190, borderRadius: 16 }} />)}</div> : null}
      {data && !pairs.length ? (
        <EmptyState icon="handshake" title="No private pairings yet" sub="Record the homes your clients own (Portfolio on their card). When one fits another client's search at 80%+, the pairing shows up here." style={{ padding: '30px 20px' }} />
      ) : null}
      {active.length ? (
        <>
          <div className="mm-section-row" style={{ margin: '6px 0 10px' }}><span className="mm-eyebrow" style={{ color: '#C08BFF' }}>Private deals to make</span><span style={{ flex: 1 }} /><span className="mm-eyebrow">{active.length}</span></div>
          <div className="mm-stack" style={{ gap: 12 }}>{active.map((p, i) => <PairCard key={p.id} p={p} first={i === 0} onDismiss={onDismiss} />)}</div>
        </>
      ) : null}
      {watching.length ? (
        <>
          <div className="mm-section-row" style={{ margin: '22px 0 10px' }}><span className="mm-eyebrow">Also watching</span><span style={{ flex: 1 }} /><span className="mm-eyebrow">{watching.length}</span></div>
          <div className="mm-stack" style={{ gap: 12 }}>{watching.map((p) => <PairCard key={p.id} p={p} onDismiss={onDismiss} />)}</div>
        </>
      ) : null}
    </div>
  );
}
