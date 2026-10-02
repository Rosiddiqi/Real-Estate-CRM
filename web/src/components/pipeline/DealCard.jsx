// Deal card — compact face (spec §9.8) + phase pills + expanded detail.
//   Row 1  grip · photo 46×34 · client + whale + stale/DOM badge · price + caption · advance · chevron
//   Row 2  address / unit — or "+ Set the property · N shortlisted" · stars
//   Row 3  side + type chips · side-specific stage name
//   Row 4  SELLING {linked home} · MLS #
//   Under Contract → contingency pills + closing countdown · Listed → status pills
//   New Dev Reserved → dates box + deposit pills
import { memo, useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import DealDetail from './DealDetail';
import ShortlistSheet from './ShortlistSheet';
import { GripDots, MiniStars, shortDate, toDateInput } from './bits';
import { labelFor } from './config';

function SubPills({ deal, cfg, onUpdate }) {
  if (!cfg || deal.stage === 'lost') return null;
  if (deal.phase === 'under_contract') {
    const cont = deal.contingencies || {};
    const steps = cfg.subStatuses.under_contract;
    const active = deal.subStatus;
    const c = deal.closing;
    return (
      <div className="km-pl-subbox" onClick={(e) => e.stopPropagation()}>
        <div className="km-pl-pills">
          {steps.map((s) => {
            const done = cont[s.id] === 'cleared' || cont[s.id] === 'waived';
            const on = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`km-pl-pill ${on ? 'km-pl-pill--on' : done ? 'km-pl-pill--done' : ''}`}
                onClick={() => onUpdate({ subStatus: on ? null : s.id })}
                aria-pressed={on}
                aria-label={s.label}
                title={s.label}
              >
                {done && !on ? <Icon name="check" size={9} stroke={3} /> : null}
                {s.short || s.label}
              </button>
            );
          })}
        </div>
        {c ? (
          <div className={`km-pl-countdown ${c.overdue ? 'km-pl-countdown--late' : ''}`}>
            Closing · {shortDate(c.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {c.overdue ? `${Math.abs(c.days)}d past` : c.days === 0 ? 'today' : `${c.days}d`}
          </div>
        ) : (
          <div className="km-pl-countdown" style={{ opacity: 0.7 }}>Set the closing date to start the countdown</div>
        )}
      </div>
    );
  }
  if (deal.phase === 'active' && deal.family === 'listing') {
    const list = cfg.subStatuses.listing_active;
    return (
      <div className="km-pl-subbox km-pl-subbox--listing" onClick={(e) => e.stopPropagation()}>
        <div className="km-pl-pills">
          {list.map((s) => (
            <button key={s.id} type="button" title={s.label} aria-label={s.label} className={`km-pl-pill ${deal.subStatus === s.id ? 'km-pl-pill--on' : ''}`} onClick={() => onUpdate({ subStatus: s.id })} aria-pressed={deal.subStatus === s.id}>
              {s.short || s.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (deal.stage === 'reserved') {
    const dep = deal.depositSchedule;
    const arr = Array.isArray(dep) && dep.length ? dep : null;
    const steps = arr
      ? arr.map((x, i) => ({
        id: `i${i}`,
        label: /balance/i.test(x.label || '') ? 'Balance' : `Dep ${i + 1}`,
        title: [x.label, x.amount ? moneyCompact(x.amount) : null, x.dueAt ? `due ${shortDate(x.dueAt)}` : null].filter(Boolean).join(' · '),
        paid: !!x.paidAt,
      }))
      : cfg.depositSteps.map((x) => {
        const v = (dep || {})[x.id];
        return { id: x.id, label: x.id === 'balance' ? 'Balance' : x.label.replace('Deposit ', 'Dep '), title: x.label, paid: !!(v && (v === true || v.paid)) };
      });
    const nextDue = arr ? arr.find((x) => !x.paidAt) : null;
    const toggle = (s, i) => {
      if (arr) {
        const next = arr.map((x, j) => (j === i ? { ...x, paidAt: x.paidAt ? null : new Date().toISOString() } : x));
        onUpdate({ depositSchedule: next });
      } else {
        onUpdate({ depositSchedule: { [s.id]: s.paid ? null : { paid: true, at: new Date().toISOString() } } });
      }
    };
    return (
      <div className="km-pl-subbox km-pl-subbox--dates" onClick={(e) => e.stopPropagation()}>
        <div className="km-pl-dates">
          <label>
            <span>Finish selections due</span>
            <input type="date" value={toDateInput(deal.finishSelectionDue)} onChange={(e) => onUpdate({ finishSelectionDue: e.target.value || null })} />
          </label>
          <label>
            <span>Est. completion (TCO)</span>
            <input type="date" value={toDateInput(deal.estCompletion)} onChange={(e) => onUpdate({ estCompletion: e.target.value || null })} />
          </label>
        </div>
        <div className="km-pl-pills" style={{ marginTop: 7 }}>
          {steps.map((s, i) => (
            <button key={s.id} type="button" title={s.title} className={`km-pl-pill ${s.paid ? 'km-pl-pill--on' : ''}`} onClick={() => toggle(s, i)} aria-pressed={s.paid}>
              {s.paid ? <Icon name="check" size={9} stroke={3} /> : null}
              {s.label}
            </button>
          ))}
        </div>
        {nextDue ? (
          <div className="km-pl-countdown" style={{ color: 'rgba(90,200,250,0.85)' }}>
            Next · {nextDue.label}{nextDue.amount ? ` · ${moneyCompact(nextDue.amount)}` : ''}{nextDue.dueAt ? ` · ${shortDate(nextDue.dueAt)}` : ''}
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

// The grip lives near the screen's left edge, where PushPanel's edge-swipe-back
// listens for touchstart on <body>. Stop the native touchstart at the grip so a
// long-press drag can never turn into a swipe-back (pointer events unaffected).
function useGripIsolation() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const stop = (e) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    return () => { el.removeEventListener('touchstart', stop); el.removeEventListener('touchmove', stop); };
  }, []);
  return ref;
}

function DealCard({
  deal, cfg, expanded, onToggle, onUpdate, onSave, onAdvance, onStageChange, onRequestLost, onDelete,
  dragging, landed, onGripPointerDown, onCardPointerDown, flash,
}) {
  const [shortOpen, setShortOpen] = useState(false);
  const gripRef = useGripIsolation();
  const c = deal.client || {};
  const next = deal.next;
  const nextLabel = next && cfg ? labelFor(cfg, next, deal.side).label : null;
  const shortlist = Array.isArray(deal.shortlist) ? deal.shortlist : [];
  const sideTone = deal.group === 'leases' ? 'km-pl-tag--lease' : deal.side.startsWith('referral') ? 'km-pl-tag--ref' : 'km-pl-tag--side';
  const lost = deal.stage === 'lost';
  const priceShown = deal.side === 'lease_tenant' || deal.side === 'lease_landlord' ? deal.monthlyRent : deal.price;
  const mls = deal.mlsNumber;
  const linked = deal.extras && deal.extras.linkedLabel;

  return (
    <div
      data-deal-id={deal.id}
      className={[
        'km-pl-card',
        expanded ? 'km-pl-card--expanded' : '',
        deal.stale && !expanded ? 'km-pl-card--stale' : '',
        dragging ? 'km-pl-card--dragging' : '',
        landed ? 'km-pl-card--landed' : '',
        flash ? 'km-deal-flash' : '',
      ].join(' ')}
    >
      <div
        className="km-pl-card-main"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        onPointerDown={onCardPointerDown}
      >
        <div className="km-pl-row1">
          {onGripPointerDown ? (
            <div ref={gripRef} className="km-pl-grip" data-drag-handle onPointerDown={onGripPointerDown} onClick={(e) => e.stopPropagation()} aria-label="Drag to another stage" role="button" tabIndex={-1}>
              <GripDots />
            </div>
          ) : null}
          {deal.photo || deal.listingId || deal.address ? (
            <PropertyPhoto src={deal.photo} seed={deal.listingId || deal.address || deal.id} className="km-pl-thumb" height={34} radius={8} style={{ width: 46 }} />
          ) : null}
          <div className="km-pl-namebox">
            {expanded ? (
              <button type="button" className="km-pl-namebtn km-press" onClick={(e) => { e.stopPropagation(); nav.openClient(deal.clientId); }}>
                <span className="km-pl-name" style={{ color: 'var(--blue)' }}>{deal.name}</span>
                <Icon name="chevronRight" size={12} color="var(--blue)" stroke={2.4} />
              </button>
            ) : (
              <span className="km-pl-name">{deal.name}</span>
            )}
            {c.whale ? <Icon name="diamond" size={13} color="var(--bright)" stroke={2} title="Whale" /> : null}
            {lost ? <span className="km-pl-badge km-pl-badge--lost">LOST</span>
              : deal.stale ? <span className="km-pl-badge km-pl-badge--stale" title={`${deal.staleDays} days in this stage`}>{deal.staleDays}d</span> : null}
          </div>
          {priceShown > 0 && !lost ? (
            <div className="km-pl-price">
              <div className="km-pl-price-v">{moneyCompact(priceShown)}{deal.group === 'leases' ? <span style={{ fontSize: 10, fontWeight: 600 }}>/mo</span> : null}</div>
              <div className="km-pl-price-c">{deal.priceCaption}</div>
            </div>
          ) : null}
          {next ? (
            <button
              type="button"
              className="km-pl-adv"
              title={`Move to ${nextLabel}`}
              aria-label={`Move ${deal.name} to ${nextLabel}`}
              onClick={(e) => { e.stopPropagation(); onAdvance(deal, next); }}
            >
              <Icon name="chevronRight" size={15} stroke={2.4} />
            </button>
          ) : null}
          <div className={`km-pl-chev ${expanded ? 'km-pl-chev--open' : ''}`}><Icon name="chevronDown" size={15} /></div>
        </div>

        <div className="km-pl-row2">
          {deal.address ? (
            <span className="km-pl-addr" title={deal.address}>
              <b>{deal.address}</b>{deal.addressLine2 ? ` · ${deal.addressLine2}` : deal.propertyLabel && deal.propertyLabel !== deal.address ? ` · ${deal.propertyLabel}` : ''}
            </span>
          ) : deal.propertyLabel ? (
            <span className="km-pl-addr" title={deal.propertyLabel}>{deal.propertyLabel}</span>
          ) : (
            <button type="button" className="km-pl-setprop" onClick={(e) => { e.stopPropagation(); setShortOpen(true); }}>
              {shortlist.length ? `Set the property · ${shortlist.length} shortlisted` : '+ Set the property'}
            </button>
          )}
          <MiniStars value={c.rating || 0} />
        </div>

        <div className="km-pl-row3">
          <span className={`km-pl-tag ${sideTone}`}>{deal.sideChip}</span>
          {deal.side !== 'referral_out' && deal.group !== 'leases' ? <span className="km-pl-tag">{deal.inventoryChip || 'RESALE'}</span> : null}
          {deal.splitShare < 1 ? <span className="km-pl-tag">{Math.round(deal.splitShare * 100)}% SPLIT</span> : null}
          {deal.dom != null ? <span className="km-pl-tag km-pl-tag--side" title="Days on market">{deal.dom} DOM</span> : null}
          {!deal.address && deal.phase !== 'closed' && !lost && !deal.side.startsWith('referral') && (shortlist.length || !deal.propertyLabel) ? (
            <button type="button" className="km-pl-tag km-pl-tag--side" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setShortOpen(true); }}>
              {shortlist.length ? `${shortlist.length} SHORTLISTED` : '+ PROPERTY'}
            </button>
          ) : null}
          <span className="km-pl-stagename" style={{ color: deal.color }}>{deal.label}</span>
        </div>

        {linked || mls ? (
          <div className="km-pl-row4">
            {linked ? <><b>SELLING</b><span className="km-truncate">{linked}</span></> : null}
            {mls ? <span style={{ marginLeft: linked ? 'auto' : 0 }}>MLS {mls}</span> : null}
          </div>
        ) : null}
      </div>

      <SubPills deal={deal} cfg={cfg} onUpdate={onUpdate} />

      {expanded ? (
        <DealDetail
          deal={deal}
          cfg={cfg}
          onUpdate={onUpdate}
          onSave={onSave}
          onStageChange={(s) => onStageChange(deal, s)}
          onRequestLost={() => onRequestLost(deal)}
          onDelete={() => onDelete(deal)}
          onCollapse={onToggle}
        />
      ) : null}

      <ShortlistSheet deal={deal} open={shortOpen} onClose={() => setShortOpen(false)} onUpdate={onUpdate} />
    </div>
  );
}

export default memo(DealCard);
