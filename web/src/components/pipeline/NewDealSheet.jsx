// New Deal sheet — the board's "+" (and the contract other surfaces open with
// nav.newDeal({ clientId, side, listingId, portfolioPropertyId, price })).
// Who → side → property → board (main / New Development) → stage → type →
// numbers with a live est. net. Creating directly at Closed runs the won flow.
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Spinner } from '../ui/kit';
import ClientPicker from '../client/ClientPicker';
import { api } from '../../api/client';
import { fullName, formatPhone, moneyCompact } from '../../lib/format';
import * as C from './commission';
import { AmountInput, DateInput, RateInput, StageDot, money0, pctOf } from './bits';
import { familyOf, stageForPhase, stagesFor, usePipelineConfig } from './config';
import { createDeal } from './dealStore';
import { afterCreate } from './actions';
import { listingRow, searchListings } from './ShortlistSheet';
import '../../styles/pipeline.css';

const SIDE_ORDER = ['buyer', 'listing', 'dual', 'lease_tenant', 'lease_landlord', 'referral_out', 'referral_in'];
const SIDE_SHORT = { buyer: 'Buyer', listing: 'Listing', dual: 'Dual', lease_tenant: 'Tenant', lease_landlord: 'Landlord', referral_out: 'Referral out', referral_in: 'Referral in' };

export default function NewDealSheet({ prefill = {}, onClose }) {
  const { cfg, plan, capYtd } = usePipelineConfig();
  const closeRef = useRef(null);
  const [client, setClient] = useState(null);
  const [pickClient, setPickClient] = useState(false);
  const [side, setSide] = useState(SIDE_ORDER.includes(prefill.side) ? prefill.side : 'buyer');
  const [track, setTrack] = useState(prefill.track === 'new_dev' ? 'new_dev' : 'main');
  const [stage, setStage] = useState(prefill.stage || null);
  const [inventoryType, setInventoryType] = useState(prefill.inventoryType || null);
  const [listing, setListing] = useState(null);
  const [property, setProperty] = useState(null);
  const [address, setAddress] = useState(prefill.propertyAddress || '');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [props, setProps] = useState([]);
  const [price, setPrice] = useState(prefill.price ?? null);
  const [rate, setRate] = useState(null);
  const [closingDate, setClosingDate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // prefill: client, listing, portfolio property
  useEffect(() => {
    if (!prefill.clientId) return;
    api.get(`/clients/${prefill.clientId}`).then((r) => setClient(r.client)).catch(() => {});
  }, [prefill.clientId]);
  useEffect(() => {
    if (!prefill.listingId) return;
    api.get(`/listings/${prefill.listingId}`).then((r) => {
      const l = r.listing || r;
      if (l && l.id) { setListing(listingRow(l)); if (prefill.price == null && (l.listPrice || l.price)) setPrice(l.listPrice || l.price); }
    }).catch(() => {});
  }, [prefill.listingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!client) { setProps([]); return; }
    const ps = client.properties || client.portfolio;
    const apply = (list) => {
      const rows = (list || []).filter((p) => p.relationship !== 'sold');
      setProps(rows);
      if (prefill.portfolioPropertyId) {
        const p = rows.find((x) => x.id === prefill.portfolioPropertyId);
        if (p) setProperty(p);
      }
    };
    if (ps) apply(ps);
    else api.get(`/clients/${client.id}`).then((r) => apply(r.client && (r.client.properties || r.client.portfolio))).catch(() => {});
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // listing search
  useEffect(() => {
    if (listing) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setHits(null);
      searchListings(q, 5).then((r) => { if (alive) { setHits(r.rows); setUnavailable(r.unavailable); } });
    }, q ? 260 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, listing]);

  const fam = cfg ? familyOf(cfg, side) : 'buyer';
  const lease = side === 'lease_tenant' || side === 'lease_landlord';
  const stages = useMemo(() => (cfg ? stagesFor(cfg, { side, track }) : []), [cfg, side, track]);
  const effStage = stage && stages.some((s) => s.key === stage) ? stage : (stages[0] && stages[0].key);
  useEffect(() => {
    // keep the chosen phase when switching side (touring ↔ active)
    if (!cfg || !stage || track !== 'main') return;
    const ph = cfg.keyPhase[stage];
    if (ph) { const k = stageForPhase(cfg, ph, side); if (k !== stage) setStage(k); }
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageInfo = stages.find((s) => s.key === effStage);
  const priceField = lease ? 'monthlyRent' : effStage === 'closed' ? 'salePrice' : effStage === 'under_contract' ? 'contractPrice' : fam === 'listing' ? 'listPrice' : 'price';

  const preview = useMemo(() => {
    if (!cfg) return null;
    const d = { side, stage: effStage, [priceField]: price, sideRate: rate };
    const e = C.estimate(d, plan || C.preparePlan({}), capYtd);
    return e;
  }, [cfg, side, effStage, priceField, price, rate, plan, capYtd]);

  const defaultRate = plan ? (side === 'dual' ? plan.defaultListingRate + plan.defaultBuyerRate : fam === 'listing' ? plan.defaultListingRate : plan.defaultBuyerRate) : null;
  const propertyLabel = listing ? listing.label : property ? [property.street, property.unit ? `#${property.unit}` : null].filter(Boolean).join(' ') || property.buildingName || 'Their property' : address.trim();
  const canCreate = client && cfg && !saving;

  const create = async () => {
    if (!canCreate) return;
    setSaving(true); setErr('');
    try {
      const body = {
        clientId: client.id,
        side,
        track,
        stage: effStage,
        ...(inventoryType ? { inventoryType } : track === 'new_dev' ? { inventoryType: 'pre_construction' } : {}),
        ...(listing ? { listingId: listing.listingId } : {}),
        ...(property ? { portfolioPropertyId: property.id } : {}),
        ...(!listing && !property && address.trim() ? { propertyAddress: address.trim() } : {}),
        ...(price != null ? { [priceField]: price } : {}),
        ...(rate != null && !lease ? { sideRate: rate } : {}),
        ...(closingDate ? (track === 'new_dev' ? { estCompletion: closingDate } : { closingDate }) : {}),
      };
      const deal = await createDeal(body);
      if (closeRef.current) closeRef.current(); else onClose();
      afterCreate(deal);
    } catch (e) {
      setErr(e && e.message ? e.message : 'Couldn’t create the deal');
      setSaving(false);
    }
  };

  const footer = ({ close }) => { closeRef.current = close; return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
          {stageInfo ? <StageDot color={stageInfo.color} glow /> : null}
          <span className="km-truncate">{stageInfo ? stageInfo.label : 'Stage'}</span>
          {price ? <span style={{ color: 'var(--blue)' }}>· {moneyCompact(price)}{lease ? '/mo' : ''}</span> : null}
        </div>
        <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
          {client ? fullName(client) : 'Choose a client'}{propertyLabel ? ` · ${propertyLabel}` : ''}
        </div>
      </div>
      <button type="button" className="km-btn km-press" style={{ minHeight: 48, padding: '0 20px' }} disabled={!canCreate} onClick={create} aria-label="Add deal">
        {saving ? <Spinner size={16} color="currentColor" /> : <Icon name={effStage === 'closed' ? 'key' : 'plus'} size={17} stroke={2.2} />}
        {saving ? 'Adding…' : effStage === 'closed' ? 'Add & close' : 'Add to pipeline'}
      </button>
    </div>
  ); };

  return (
    <Sheet open onClose={onClose} title="New deal" subtitle={client ? fullName(client) : undefined} footer={footer} maxHeight="90%" zIndex={430}>
      {!cfg ? <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner /></div> : (
        <>
          <div className="km-pl-label">Who</div>
          {client ? (
            <button type="button" className="km-pl-pickrow km-press" onClick={() => setPickClient(true)}>
              <Avatar name={fullName(client)} seed={client.id} src={client.avatarUrl} size={38} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{fullName(client)}</span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)' }}>{[formatPhone(client.phone), client.neighborhood].filter(Boolean).join(' · ') || 'Client'}</span>
              </span>
              <span style={{ color: 'var(--blue)', fontSize: 13, fontWeight: 500 }}>Change</span>
            </button>
          ) : (
            <button type="button" className="km-pl-pickrow km-press" onClick={() => setPickClient(true)}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', color: 'var(--blue)' }}>
                <Icon name="userPlus" size={18} />
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--blue)' }}>Choose a client</span>
              <Icon name="chevronRight" size={16} color="var(--faint)" />
            </button>
          )}

          <div className="km-pl-label">Side</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SIDE_ORDER.map((id) => (
              <button key={id} type="button" className={`km-pill km-press ${side === id ? 'km-pill--on' : ''}`} onClick={() => setSide(id)}>
                {SIDE_SHORT[id]}
              </button>
            ))}
          </div>

          <div className="km-pl-label">{fam === 'listing' ? 'Their property' : 'Property'} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· optional</span></div>
          {listing ? (
            <div className="km-pl-pickrow">
              <PropertyPhoto src={listing.photo} seed={listing.key} radius={8} height={40} style={{ width: 54, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{listing.label}</span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>{[listing.price ? moneyCompact(listing.price) : null, listing.sub, listing.mlsNumber ? `MLS ${listing.mlsNumber}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="km-icon-btn km-icon-btn--sm" aria-label="Clear listing" onClick={() => setListing(null)}><Icon name="x" size={15} /></button>
            </div>
          ) : property ? (
            <div className="km-pl-pickrow">
              <PropertyPhoto src={property.heroPhoto} seed={property.id} radius={8} height={40} style={{ width: 54, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{propertyLabel}</span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>{[property.relationship, property.estValue ? `est. ${moneyCompact(property.estValue)}` : null, property.neighborhood].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="km-icon-btn km-icon-btn--sm" aria-label="Clear property" onClick={() => setProperty(null)}><Icon name="x" size={15} /></button>
            </div>
          ) : (
            <>
              {props.length ? (
                <div className="km-pl-optlist" style={{ marginBottom: 8 }}>
                  {props.slice(0, 4).map((p) => (
                    <button key={p.id} type="button" className="km-pl-opt" onClick={() => { setProperty(p); if (price == null && p.estValue && fam === 'listing') setPrice(p.estValue); }}>
                      <PropertyPhoto src={p.heroPhoto} seed={p.id} radius={6} height={26} style={{ width: 34, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{[p.street, p.unit ? `#${p.unit}` : null].filter(Boolean).join(' ') || p.buildingName || 'Property'}</span>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)' }}>{[p.relationship, p.estValue ? moneyCompact(p.estValue) : null, p.neighborhood].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Icon name="plus" size={15} color="var(--blue)" />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="km-search km-lg km-lg--line" style={{ marginBottom: 8 }}>
                <Icon name="search" size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings — address, building, MLS #" />
              </div>
              {unavailable ? null : hits === null ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}><Spinner size={16} /></div>
              ) : hits.length ? (
                <div className="km-pl-optlist" style={{ marginBottom: 8 }}>
                  {hits.map((h) => (
                    <button key={h.key} type="button" className="km-pl-opt" onClick={() => { setListing(h); if (price == null && h.price) setPrice(h.price); }}>
                      <PropertyPhoto src={h.photo} seed={h.key} radius={6} height={26} style={{ width: 34, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{h.label}</span>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)' }}>{[h.price ? moneyCompact(h.price) : null, h.sub].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Icon name="plus" size={15} color="var(--blue)" />
                    </button>
                  ))}
                </div>
              ) : null}
              <input className="km-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="…or type an address / building" />
            </>
          )}

          <div className="km-pl-label">Board</div>
          <div className="km-pl-seg">
            {[['main', 'Main pipeline', 'Client journey'], ['new_dev', 'New Development', 'Pre-construction lane']].map(([id, l, sub]) => (
              <button key={id} type="button" className={`km-press ${track === id ? 'on' : ''}`} onClick={() => { setTrack(id); setStage(null); }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: track === id ? 'var(--blue)' : 'var(--text)' }}>{l}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{sub}</span>
              </button>
            ))}
          </div>

          <div className="km-pl-label">Stage</div>
          <div className="km-pl-optlist">
            {stages.map((s) => (
              <button key={s.key} type="button" className={`km-pl-opt ${effStage === s.key ? 'km-pl-opt--on' : ''}`} onClick={() => setStage(s.key)} aria-pressed={effStage === s.key}>
                <StageDot color={s.color} size={9} glow={effStage === s.key} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>{s.label}</span>
                <span className="km-truncate" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{s.key === 'closed' ? 'Books it · celebrates' : s.sub}</span>
                {effStage === s.key ? <Icon name="check" size={14} color="var(--blue)" stroke={2.6} /> : null}
              </button>
            ))}
          </div>

          {!lease && side !== 'referral_out' ? (
            <>
              <div className="km-pl-label">Type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cfg.inventoryTypes.map((t) => {
                  const on = (inventoryType || (track === 'new_dev' ? 'pre_construction' : 'resale')) === t.id;
                  return <button key={t.id} type="button" className={`km-pill km-press ${on ? 'km-pill--on' : ''}`} onClick={() => setInventoryType(t.id)}>{t.label}</button>;
                })}
              </div>
            </>
          ) : null}

          <div className="km-pl-label">Numbers</div>
          <div className="km-pl-optlist" style={{ padding: '10px 12px 2px' }}>
            <div className="km-pl-field">
              <span className="km-pl-field-l" style={{ fontSize: 13.5, color: 'var(--text)' }}>{lease ? 'Monthly rent' : priceField === 'listPrice' ? 'List price' : priceField === 'contractPrice' ? 'Contract price' : priceField === 'salePrice' ? 'Sale price' : 'Price / budget'}</span>
              <AmountInput ariaLabel="Price" value={price} onChange={setPrice} />
            </div>
            {!lease ? (
              <div className="km-pl-field">
                <span className="km-pl-field-l" style={{ fontSize: 13.5, color: 'var(--text)' }}>{side === 'dual' ? 'Combined rate' : side === 'referral_out' ? 'Partner side rate' : 'Side rate'}</span>
                <RateInput ariaLabel="Rate" value={rate} placeholder={defaultRate != null ? pctOf(defaultRate, 3) : '—'} onChange={setRate} />
              </div>
            ) : null}
            {effStage !== 'closed' ? (
              <div className="km-pl-field">
                <span className="km-pl-field-l" style={{ fontSize: 13.5, color: 'var(--text)' }}>{track === 'new_dev' ? 'Est. completion' : 'Expected closing'}</span>
                <DateInput ariaLabel="Expected closing" value={closingDate} onChange={setClosingDate} />
              </div>
            ) : null}
            <div className="km-pl-readout" style={{ paddingTop: 4 }}>
              <span className="km-pl-eyebrow">Est. net{preview && preview.split < 1 ? ` · ${Math.round(preview.split * 100)}% split` : ''}</span>
              <span className="km-pl-readout-v">{preview && preview.net ? money0(preview.estimatedNet ?? preview.net) : '—'}</span>
            </div>
          </div>
          {err ? <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{err}</div> : null}
          <div style={{ fontSize: 12, color: 'var(--faint)', margin: '12px 2px 4px', lineHeight: 1.45 }}>
            Estimates use your pay plan and never count as earned — the real number is what you enter at closing.
          </div>
        </>
      )}
      <ClientPicker open={pickClient} onClose={() => setPickClient(false)} onPick={(c) => setClient(c)} kind="client" title="Who’s the deal for?" />
    </Sheet>
  );
}

