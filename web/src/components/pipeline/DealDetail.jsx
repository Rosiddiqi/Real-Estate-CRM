// Expanded deal body — shared by the board card and the Deal sheet so the two
// can never drift. Sections (RevMatch §4.5 re-geared, spec §9.8):
//   Call / Text / Email (wired) · Rating + Whale · Shortlist · Note / Lost
//   DEAL: price · side rate % · est. net live (or COMMISSION · ENTERED) ·
//         co-agent split (50/50 · 60/40 · 70/30 + stepper) · closing date ·
//         contingency toggles · Save → "Saving… → ✓ Saved" → auto-collapse
//   STAGE dropdown · arm-then-confirm Delete
import { useState } from 'react';
import Icon from '../ui/Icon';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import PropertyPhoto from '../ui/PropertyPhoto';
import StageDropdown from './StageDropdown';
import ShortlistSheet from './ShortlistSheet';
import { AmountInput, Check, CompactDate, DateInput, Eyebrow, Field, RateInput, money0, pctOf, todayInput } from './bits';
import { familyOf, getConfigState } from './config';

const STATE_NEXT = { open: 'cleared', cleared: 'waived', waived: 'open' };
const STATE_LABEL = { open: 'Open', cleared: 'Cleared', waived: 'Waived' };

function ContactBtn({ icon, label, onClick, disabled }) {
  return (
    <button type="button" className="km-pl-cbtn km-press" disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Icon name={icon} size={13} color="var(--blue)" stroke={2} />
      {label}
    </button>
  );
}

export default function DealDetail({
  deal, cfg, onUpdate, onSave, onStageChange, onRequestLost, onDelete, onCollapse, onReopen,
  stageDirection = 'up', showContact = true,
}) {
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [armDelete, setArmDelete] = useState(false);
  const [shortOpen, setShortOpen] = useState(false);
  const [editBooked, setEditBooked] = useState(false);
  const plan = getConfigState().plan;
  const c = deal.client || {};
  const side = deal.side;
  const fam = familyOf(cfg, side);
  const lease = side === 'lease_tenant' || side === 'lease_landlord';
  const referral = side === 'referral_out';
  const lost = deal.stage === 'lost';
  const closed = deal.stage === 'closed';
  const uc = deal.phase === 'under_contract';
  const newDev = deal.track === 'new_dev';
  const ex = deal.extras || {};
  const share = deal.splitShare != null ? deal.splitShare : 1;
  const split = share < 1;

  const update = (partial) => {
    setDirty(true);
    setSaveState('idle');
    onUpdate(partial);
  };
  const save = async (e) => {
    e.stopPropagation();
    if (saveState === 'saving') return;
    setSaveState('saving');
    const ok = await Promise.resolve(onSave()).catch(() => false);
    if (ok === false) { setSaveState('idle'); return; }
    setDirty(false);
    setSaveState('saved');
    setTimeout(() => { setSaveState('idle'); if (onCollapse) onCollapse(); }, 900);
  };

  // price field + label for this moment of the deal
  const pf = deal.priceField || 'price';
  const priceLabel = lease ? 'Monthly rent'
    : pf === 'listPrice' ? 'List price'
      : pf === 'contractPrice' ? 'Contract price'
        : pf === 'salePrice' ? 'Sale price' : referral ? 'Purchase price' : 'Price';
  const priceValue = lease ? deal.monthlyRent : pf === 'price' ? (deal.rawPrice !== undefined ? deal.rawPrice : deal.price) : (deal[pf] ?? deal.price ?? null);
  const defaultRate = plan ? (fam === 'listing' && side !== 'dual' ? plan.defaultListingRate : side === 'dual' ? plan.defaultListingRate + plan.defaultBuyerRate : plan.defaultBuyerRate) : null;
  const est = deal.estimates || {};
  const shortlist = Array.isArray(deal.shortlist) ? deal.shortlist : [];
  const hasProperty = !!(deal.listingId || deal.address || deal.portfolioPropertyId);

  const breakdown = [
    est.gci ? `GCI ${moneyCompact(est.gci)}` : null,
    est.referralOut ? `referral −${moneyCompact(est.referralOut)}` : null,
    est.coopBonus ? `co-op +${moneyCompact(est.coopBonus)}` : null,
    est.franchise ? `royalty −${moneyCompact(est.franchise)}` : null,
    est.companyDollar ? `brokerage −${moneyCompact(est.companyDollar)}` : null,
    est.team ? `team −${moneyCompact(est.team)}` : null,
    est.fee ? `fee −${money0(est.fee)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="km-pl-x" onClick={(e) => e.stopPropagation()}>
      {showContact ? (
        <div className="km-pl-contact">
          <ContactBtn icon="phone" label="Call" disabled={!c.phone} onClick={() => nav.call({ clientId: deal.clientId, phone: c.phone, name: c.name })} />
          <ContactBtn icon="message" label="Text" onClick={() => nav.openThread({ clientId: deal.clientId, name: c.name })} />
          <ContactBtn icon="mail" label="Email" disabled={!c.email} onClick={() => { window.location.href = `mailto:${c.email}`; }} />
        </div>
      ) : null}

      <div className="km-pl-ratingrow">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="km-pl-eyebrow">Rating</span>
          <span style={{ display: 'inline-flex', gap: 1 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                style={{ padding: 2, display: 'flex' }}
                onClick={() => onUpdate({ client: { rating: (c.rating || 0) === n ? n - 1 : n } })}
              >
                <Icon name="star" size={15} stroke={2} color={n <= (c.rating || 0) ? 'var(--pl-gold)' : 'var(--faint)'} style={{ fill: n <= (c.rating || 0) ? 'var(--pl-gold)' : 'none' }} />
              </button>
            ))}
          </span>
        </div>
        <button type="button" className={`km-pl-whale km-press ${c.whale ? 'km-pl-whale--on' : ''}`} onClick={() => onUpdate({ client: { isWhale: !c.isWhale } })} aria-pressed={!!c.isWhale}>
          <Icon name="diamond" size={13} stroke={2} />
          <span>WHALE</span>
        </button>
      </div>

      {(!hasProperty || shortlist.length > 0) && !lost ? (
        <div className="km-pl-sect">
          <Eyebrow trailing={<button type="button" className="km-pl-link" onClick={() => setShortOpen(true)}>{shortlist.length ? '+ Add / manage' : '+ Add'}</button>}>
            {fam === 'listing' ? 'Property' : 'Shortlist'}
          </Eyebrow>
          {shortlist.length ? shortlist.slice(0, 4).map((s) => {
            const one = (s.listingId && s.listingId === deal.listingId) || (!s.listingId && s.address && s.address === deal.address);
            return (
              <div className="km-pl-short" key={s.key}>
                <PropertyPhoto src={s.photo} seed={s.key} radius={6} height={26} style={{ width: 34, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="km-truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                  {s.price ? <div style={{ fontSize: 11, color: 'var(--faint)' }}>{moneyCompact(s.price)}</div> : null}
                </div>
                {one ? <span className="km-pl-theone">✓ THE ONE</span> : (
                  <button
                    type="button"
                    className="km-pl-mini km-press"
                    onClick={() => update({
                      listingId: s.listingId || null,
                      propertyAddress: s.listingId ? null : s.address,
                      ...(s.portfolioPropertyId ? { portfolioPropertyId: s.portfolioPropertyId } : {}),
                      ...(s.price && !deal.price ? { [pf]: s.price } : {}),
                    })}
                  >
                    Make it the one
                  </button>
                )}
              </div>
            );
          }) : (
            <div className="km-pl-dashed">No properties yet — add the ones they’re weighing, then make one the one.</div>
          )}
        </div>
      ) : null}

      {lost ? (
        <div className="km-pl-note km-selectable">
          <span className="km-pl-eyebrow" style={{ color: 'var(--red)', marginRight: 6 }}>LOST</span>
          {deal.lostReason || 'No reason given'}
          {deal.lostNote ? <div style={{ marginTop: 4, fontStyle: 'italic' }}>{deal.lostNote}</div> : null}
        </div>
      ) : deal.notes ? (
        <div className="km-pl-note km-selectable" style={{ fontStyle: 'italic' }}>{deal.notes}</div>
      ) : null}

      {lost ? (
        onReopen ? (
          <button type="button" className="km-pl-save km-pl-save--dirty km-press" onClick={onReopen}>Reopen deal</button>
        ) : null
      ) : (
        <>
          <Eyebrow>Deal</Eyebrow>
          <Field label={priceLabel}>
            <AmountInput
              ariaLabel={priceLabel}
              value={priceValue}
              onChange={(v) => update(lease ? { monthlyRent: v } : { [pf]: v })}
            />
          </Field>
          {lease ? (
            <Field label="Fee · months of rent">
              <AmountInput ariaLabel="Months of rent" prefix="" suffix="mo" value={ex.leaseFeeMonths ?? null} placeholder="1" onChange={(v) => update({ extras: { leaseFeeMonths: v } })} />
            </Field>
          ) : referral ? (
            <>
              <Field label="Partner’s side rate">
                <RateInput ariaLabel="Partner side rate" value={deal.sideRate} placeholder={pctOf(plan ? plan.defaultBuyerRate : 0.025)} onChange={(v) => update({ sideRate: v })} />
              </Field>
              <Field label="Referral fee you receive">
                <RateInput ariaLabel="Referral fee percent" value={ex.referralFeePct ?? deal.referralOutPct ?? null} placeholder="25" onChange={(v) => update(ex.referralFeePct != null ? { extras: { referralFeePct: v } } : { referralOutPct: v })} />
              </Field>
            </>
          ) : (
            <Field label={side === 'dual' ? 'Combined rate (both sides)' : 'Side rate'}>
              <RateInput ariaLabel="Side rate percent" value={deal.sideRate} placeholder={defaultRate != null ? pctOf(defaultRate, 3) : '—'} onChange={(v) => update({ sideRate: v })} />
            </Field>
          )}

          {deal.booked ? (
            editBooked ? (
              <Field label="Net received">
                <AmountInput ariaLabel="Net received" value={deal.commission} onChange={(v) => update({ commission: v })} />
              </Field>
            ) : (
              <div className="km-pl-readout">
                <span className="km-pl-eyebrow">Commission · entered</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="km-pl-readout-v">{money0(deal.commission)}</span>
                  <button type="button" className="km-pl-link" onClick={() => setEditBooked(true)}>Edit</button>
                </span>
              </div>
            )
          ) : (
            <>
              <div className="km-pl-readout">
                <span className="km-pl-eyebrow">{closed ? 'Est. net · not entered' : 'Est. net'}{est.capped ? ' · capped' : ''}</span>
                <span className="km-pl-readout-v">{est.net ? money0(est.net) : '—'}</span>
              </div>
              {breakdown ? <div className="km-pl-breakdown">{breakdown}</div> : null}
              {closed ? (
                <Field label="Net received">
                  <AmountInput ariaLabel="Net received" value={null} placeholder="Enter actual" onChange={(v) => update({ commission: v })} />
                </Field>
              ) : null}
            </>
          )}

          <button type="button" className={`km-pl-toggle km-press ${split ? 'km-pl-toggle--on' : ''}`} onClick={() => update({ splitShare: split ? 1 : 0.5 })}>
            <Check on={split} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>Split with a co-agent</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dim)', marginTop: 1 }}>
                {split
                  ? (deal.booked
                    ? `Counts as ${Math.round(share * 100)}% of the side. The commission above is what you entered — never re-split.`
                    : `You keep ${Math.round(share * 100)}% — sides and the estimate are split too.`)
                  : 'Sharing the side with a team or co-listing agent'}
              </span>
            </span>
          </button>
          {split ? (
            <div style={{ animation: 'km-pl-expand 0.18s ease' }}>
              <div className="km-pl-presets">
                {[[0.5, '50/50'], [0.6, '60/40'], [0.7, '70/30']].map(([v, l]) => (
                  <button key={l} type="button" className={`km-pl-preset km-press ${Math.abs(share - v) < 0.001 ? 'km-pl-preset--on' : ''}`} onClick={() => update({ splitShare: v })}>{l}</button>
                ))}
                <div className="km-pl-stepper">
                  <button type="button" aria-label="Less" onClick={() => update({ splitShare: Math.max(0.05, Math.round((share - 0.05) * 100) / 100) })}>−</button>
                  <span>{Math.round(share * 100)}%</span>
                  <button type="button" aria-label="More" onClick={() => update({ splitShare: Math.min(0.95, Math.round((share + 0.05) * 100) / 100) })}>+</button>
                </div>
              </div>
              <div className="km-pl-field" style={{ marginTop: 8 }}>
                <span className="km-pl-field-l">Co-agent</span>
                <div className="km-pl-amt" style={{ paddingLeft: 0 }}>
                  <input
                    type="text"
                    aria-label="Co-agent name"
                    defaultValue={deal.coAgentName || ''}
                    placeholder="Name"
                    style={{ width: 150, textAlign: 'left', paddingLeft: 9 }}
                    onBlur={(e) => { if ((e.target.value || null) !== (deal.coAgentName || null)) update({ coAgentName: e.target.value || null }); }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div style={{ height: 10 }} />
          {closed ? (
            <Field label="Closed on">
              <DateInput ariaLabel="Closed on" value={deal.closedAt} max={todayInput()} onChange={(v) => v && update({ closedAt: v })} />
            </Field>
          ) : newDev ? (
            <Field label="Est. completion (TCO)">
              <DateInput ariaLabel="Estimated completion" value={deal.estCompletion} onChange={(v) => update({ estCompletion: v })} />
            </Field>
          ) : (
            <Field label="Expected closing">
              <DateInput ariaLabel="Expected closing" value={deal.closingDate} onChange={(v) => update({ closingDate: v })} />
            </Field>
          )}

          {uc && cfg ? (
            <div className="km-pl-sect" style={{ marginTop: 6 }}>
              <Eyebrow>Contingencies</Eyebrow>
              {cfg.subStatuses.under_contract.filter((x) => x.deadlineField).map((x) => {
                const st = (deal.contingencies || {})[x.id] || 'open';
                return (
                  <div className="km-pl-conting" key={x.id}>
                    <span className="km-pl-conting-l">{x.label}</span>
                    <CompactDate
                      ariaLabel={`${x.label} deadline`}
                      value={deal[x.deadlineField]}
                      placeholder="Deadline"
                      tone={st === 'open' && deal[x.deadlineField] && new Date(deal[x.deadlineField]) < new Date() ? 'late' : undefined}
                      onChange={(v) => update({ [x.deadlineField]: v })}
                    />
                    <button type="button" className={`km-pl-state km-press km-pl-state--${st}`} onClick={() => update({ contingencies: { [x.id]: STATE_NEXT[st] || 'cleared' } })}>
                      {STATE_LABEL[st] || 'Open'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={saveState === 'saving' || (!dirty && saveState !== 'saved')}
            className={`km-pl-save ${saveState === 'saved' ? 'km-pl-save--saved' : saveState === 'saving' ? 'km-pl-save--saving' : dirty ? 'km-pl-save--dirty' : ''}`}
          >
            {saveState === 'saved' ? <><Icon name="check" size={14} stroke={2.6} /> Saved</> : saveState === 'saving' ? 'Saving…' : dirty ? 'Save deal' : 'Saved'}
          </button>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <Eyebrow>Stage</Eyebrow>
        <StageDropdown deal={deal} cfg={cfg} direction={stageDirection} onChange={onStageChange} onLost={onRequestLost} />
      </div>

      {onDelete ? (
        <button
          type="button"
          className={`km-pl-delete ${armDelete ? 'km-pl-delete--armed' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!armDelete) { setArmDelete(true); setTimeout(() => setArmDelete(false), 3500); return; }
            setArmDelete(false);
            onDelete();
          }}
          onMouseLeave={() => setArmDelete(false)}
        >
          {armDelete ? 'Tap again to delete' : 'Delete deal'}
        </button>
      ) : null}

      <ShortlistSheet deal={deal} open={shortOpen} onClose={() => setShortOpen(false)} onUpdate={(p) => onUpdate(p)} />
    </div>
  );
}
