// PropertyDetail — one Portfolio property, nested PushPanel over the client
// card (RevMatch GarageCarDetail + the resurrected OwnershipSection):
// photos + lightbox, key facts, features, ownership & financing (equity, LTV
// bar, ARM reset), lease / sale heroes, source, photos & documents, notes,
// "Buyers who'd love this" (client-to-client, off-market), + Deal.
import { useCallback, useEffect, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import PropertyPhoto from '../ui/PropertyPhoto';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Skeleton, ScoreDial, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { mediaUrl } from '../../api/client';
import { uploadFiles } from '../../api/system';
import { getProperty, updateProperty, propertyBuyers } from '../../api/portfolio';
import { useSocket } from '../../hooks/useSocket';
import { copyText, displayName, SectionTitle } from '../client/clientKit';
import { PhotoStrip, PhotoLightbox } from './Photos';
import PropertyForm from './PropertyForm';
import {
  REL, OCC, TYPE_LABEL, WATER_LABEL, SOURCE_LABEL, TONE_CLASS, money, propTitle, photoOf, fmtMonthYear, featureList, fmtRate,
} from './portfolioKit';

function Header({ client, onEdit }) {
  const { requestClose } = usePanel();
  return (
    <div className="km-scroll-edge" style={{ position: 'relative', zIndex: 5, flexShrink: 0, padding: 'calc(var(--safe-top) + 8px) 14px 8px', display: 'flex', justifyContent: 'space-between' }}>
      <button type="button" className="km-lg km-lg--line km-press kc-pd-back" aria-label={`Back to ${client.firstName || displayName(client)}`} onClick={requestClose} style={{ height: 36, padding: '0 14px 0 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 15, fontWeight: 600, color: 'var(--lg-text)' }}>
        <Icon name="chevronLeft" size={20} stroke={2.2} /> {client.firstName || displayName(client)}
      </button>
      <button type="button" className="km-lg km-lg--line km-press" onClick={onEdit} style={{ height: 36, padding: '0 16px', borderRadius: 999, fontSize: 15, fontWeight: 600, color: 'var(--lg-text)' }}>Edit</button>
    </div>
  );
}

function Spec({ label, value, copy, mono }) {
  if (value == null || value === '') return null;
  return (
    <div className="kc-spec">
      <span className="kc-spec-l">{label}</span>
      <span className={`kc-spec-v km-selectable ${mono ? 'kc-mono' : ''}`} style={mono ? { fontSize: 13, letterSpacing: '0.04em' } : undefined}>{value}</span>
      {copy ? <button type="button" onClick={() => { copyText(copy); toast('Copied'); }} aria-label={`Copy ${label}`} style={{ display: 'flex', color: 'var(--faint)' }}><Icon name="copy" size={14} /></button> : null}
    </div>
  );
}

function Ownership({ p, client }) {
  const d = p.derived || {};
  const meta = p.meta || {};
  const mortgage = p.loanType && p.loanType !== 'cash' && (p.mortgageBalance || p.mortgageBalance === 0 ? p.mortgageBalance > 0 : true);
  const resetSoon = d.daysToReset != null && d.daysToReset >= 0 && d.daysToReset < 180;
  const rate = p.mortgageRate ? fmtRate(p.mortgageRate) : null;
  const loanLabel = p.loanType === 'arm' ? `${meta.armFixedYears ? `${meta.armFixedYears}/1 ` : ''}ARM` : p.loanType === 'interest_only' ? 'Interest-only' : p.loanType === 'balloon' ? 'Balloon' : 'Fixed';
  const pill = p.loanType === 'cash' || !mortgage ? ['FREE & CLEAR', 'kc-tag--green'] : p.titleHolding === 'trust' || p.titleHolding === 'llc' ? [`MORTGAGE · ${p.titleHolding.toUpperCase()}`, resetSoon ? 'kc-tag--amber' : 'kc-tag--blue'] : ['MORTGAGE', resetSoon ? 'kc-tag--amber' : 'kc-tag--blue'];
  const carrying = [p.hoaMonthly ? `HOA ${money(p.hoaMonthly)}/mo` : null, p.taxAnnual ? `Taxes ${money(p.taxAnnual)}/yr` : null, meta.insuranceAnnual ? `Ins. ${money(meta.insuranceAnnual)}/yr` : null].filter(Boolean).join(' · ');
  return (
    <>
      <SectionTitle action={<span className={`kc-tag kc-tag--mono ${pill[1]}`}>{pill[0]}</span>}>Ownership & financing</SectionTitle>
      <div className="kc-own-hero">
        {mortgage ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div className="kc-mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>EST. EQUITY</div>
                <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em', marginTop: 4, color: 'var(--green)', textShadow: '0 0 14px rgba(48,210,122,0.3)' }}>{d.equity != null ? money(d.equity) : '—'}</div>
              </div>
              {d.daysToReset != null && d.daysToReset >= 0 ? (
                <span className={`kc-tag ${resetSoon ? 'kc-tag--amber' : 'kc-tag--blue'}`}>{d.daysToReset} days to rate reset</span>
              ) : d.daysToMaturity != null && d.daysToMaturity >= 0 && ['balloon', 'interest_only'].includes(p.loanType) ? (
                <span className={`kc-tag ${d.daysToMaturity < 365 ? 'kc-tag--amber' : 'kc-tag--blue'}`}>{d.daysToMaturity} days to maturity</span>
              ) : null}
            </div>
            {d.ltv != null ? (
              <>
                <div className={`kc-ltv ${resetSoon ? 'kc-ltv--warn' : ''}`}><div style={{ width: `${Math.min(100, Math.round(d.ltv * 100))}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>
                  <span>{Math.round(d.ltv * 100)}% LTV</span>
                  <span>{meta.originatedAt ? fmtMonthYear(meta.originatedAt) : ''}{meta.originatedAt && (p.loanResetAt || p.loanMaturesAt) ? ' → ' : ''}{p.loanResetAt ? `resets ${fmtMonthYear(p.loanResetAt)}` : p.loanMaturesAt ? `matures ${fmtMonthYear(p.loanMaturesAt)}` : ''}</span>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="kc-mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>OWNED OUTRIGHT</div>
            <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em', marginTop: 4 }}>{p.estValue ? `${money(p.estValue)} est.` : 'Value not captured'}</div>
          </>
        )}
      </div>
      <div className="kc-specs" style={{ marginTop: 10 }}>
        {mortgage ? <Spec label="Rate" value={[rate, loanLabel].filter(Boolean).join(' · ')} /> : null}
        {mortgage ? <Spec label="Balance" value={p.mortgageBalance != null ? money(p.mortgageBalance) : null} /> : null}
        {mortgage ? <Spec label="Monthly" value={meta.monthlyPayment ? `${money(meta.monthlyPayment)}/mo PITI` : null} /> : null}
        {mortgage ? <Spec label="Lender" value={p.lenderName} /> : null}
        {mortgage && meta.loanTermMonths ? <Spec label="Term" value={`${Math.round(meta.loanTermMonths / 12)} yr`} /> : null}
        <Spec label="Purchased" value={[p.purchasedAt ? fmtMonthYear(p.purchasedAt) : null, p.purchasePrice ? money(p.purchasePrice) : null].filter(Boolean).join(' · ') || null} />
        <Spec label="Appreciation" value={d.appreciation != null ? `${d.appreciation >= 0 ? '+' : '−'}${money(Math.abs(d.appreciation))} · ${d.appreciationPct >= 0 ? '+' : ''}${Math.round(d.appreciationPct * 100)}%${d.cagr != null ? ` · ${(d.cagr * 100).toFixed(1)}%/yr` : ''}` : null} />
        <Spec label="Held" value={d.heldYears != null ? `${d.heldYears} yrs` : null} />
        <Spec label="Carrying" value={carrying || null} />
        <Spec label="Title" value={p.titleHolding ? p.titleHolding.toUpperCase() === 'LLC' ? 'LLC' : p.titleHolding.charAt(0).toUpperCase() + p.titleHolding.slice(1) : null} />
        {p.relationship === 'leased_out' ? <Spec label="Rent" value={p.rentAmount ? `${money(p.rentAmount)}/mo${p.leaseEndsAt ? ` · lease ends ${fmtMonthYear(p.leaseEndsAt)}` : ''}` : null} /> : null}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button type="button" className="km-btn km-btn--ghost" style={{ flex: 1 }} onClick={() => nav.openSerena('chat', `Refi & equity options for ${displayName(client)}'s ${propTitle(p)}: est. value ${p.estValue ? money(p.estValue) : 'unknown'}, balance ${p.mortgageBalance != null ? money(p.mortgageBalance) : 'unknown'}${rate ? `, rate ${rate} ${loanLabel}` : ''}${p.loanResetAt ? `, resets ${fmtMonthYear(p.loanResetAt)}` : ''}. What should I suggest?`)}>Refi & equity</button>
        <button type="button" className="km-btn" style={{ flex: 1.3 }} onClick={() => nav.newDeal({ clientId: client.id, side: 'listing', portfolioPropertyId: p.id, price: p.estValue || undefined })}>Plan next move</button>
      </div>
    </>
  );
}

function LeaseHero({ p }) {
  const d = p.derived || {};
  const days = d.daysToLeaseEnd;
  const pct = days != null ? Math.max(0, Math.min(1, 1 - days / 365)) : null;
  return (
    <>
      <SectionTitle>Their lease</SectionTitle>
      <div className="kc-own-hero">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div className="kc-mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>LEASE ENDS</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{p.leaseEndsAt ? new Date(p.leaseEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Not captured'}</div>
          </div>
          {days != null && days >= 0 ? <span className={`kc-tag ${days < 90 ? 'kc-tag--amber' : 'kc-tag--blue'}`}>{days} days left</span> : null}
        </div>
        {pct != null ? <div className={`kc-ltv ${days < 90 ? 'kc-ltv--warn' : ''}`}><div style={{ width: `${Math.round(pct * 100)}%` }} /></div> : null}
        {p.rentAmount ? <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 10 }}>{money(p.rentAmount)}/mo · that’s {money(p.rentAmount * 12)} a year toward someone else’s equity.</div> : null}
      </div>
    </>
  );
}

function SaleHero({ p }) {
  const d = p.derived || {};
  return (
    <>
      <SectionTitle action={p.soldWithMe ? <span className="kc-tag kc-tag--mono kc-tag--blue">Sold with you</span> : null}>Sale</SectionTitle>
      <div className="kc-own-hero">
        <div className="kc-mono" style={{ fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--faint)' }}>SOLD{p.soldAt ? ` · ${fmtMonthYear(p.soldAt).toUpperCase()}` : ''}</div>
        <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em', marginTop: 4 }}>{p.soldPrice ? money(p.soldPrice) : '—'}</div>
        <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6 }}>
          {[p.purchasePrice ? `Bought ${money(p.purchasePrice)}${p.purchasedAt ? ` in ${new Date(p.purchasedAt).getFullYear()}` : ''}` : null, d.heldYears ? `held ${d.heldYears} yrs` : null, d.appreciation != null ? `${d.appreciation >= 0 ? '+' : '−'}${money(Math.abs(d.appreciation))}` : null].filter(Boolean).join(' · ') || 'Purchase details not captured'}
        </div>
      </div>
    </>
  );
}

export default function PropertyDetail({ id, seed, client, onClose, onChanged }) {
  const [p, setP] = useState(seed || null);
  const [buyers, setBuyers] = useState(null);
  const [edit, setEdit] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [featureText, setFeatureText] = useState('');
  const [addingFeature, setAddingFeature] = useState(false);
  const [notes, setNotes] = useState(seed?.notes || '');
  const [notesState, setNotesState] = useState('idle');
  const [docBusy, setDocBusy] = useState(false);
  const notesTimer = useRef(null);
  const docInput = useRef(null);

  const load = useCallback(() => {
    getProperty(id).then((r) => { setP(r.property); setNotes((n) => (notesState === 'idle' ? r.property.notes || '' : n)); }).catch((e) => { if (e.status === 404) { toast('That property was removed'); onClose?.(); } });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!p || !['owns', 'leased_out'].includes(p.relationship)) return;
    propertyBuyers(id).then((r) => setBuyers(r.buyers || [])).catch(() => setBuyers([]));
  }, [id, p && p.relationship]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocket('client_updated', (x) => { if (x && x.id === client.id) load(); });
  useEffect(() => () => clearTimeout(notesTimer.current), []);

  const patch = async (body, msg) => {
    try {
      const r = await updateProperty(id, body);
      setP((cur) => ({ ...cur, ...r.property }));
      onChanged?.();
      if (msg) toast.success(msg);
    } catch (e) { toast.error(e.message || 'Couldn’t save'); }
  };

  const onNotes = (v) => {
    setNotes(v); setNotesState('typing');
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => { setNotesState('saving'); await patch({ notes: v.trim() || null }); setNotesState('saved'); }, 900);
  };

  const addFeature = () => {
    const v = featureText.trim();
    if (!v) { setAddingFeature(false); return; }
    const list = Array.isArray(p.features) ? p.features : [];
    if (!featureList(p).some((f) => f.name.toLowerCase() === v.toLowerCase())) patch({ features: [...list, { name: v, confirmed: false, importance: 'stated' }] });
    setFeatureText(''); setAddingFeature(false);
  };

  const addDocs = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setDocBusy(true);
    try {
      const up = await uploadFiles(files);
      const docs = [...(Array.isArray(p.documents) ? p.documents : []), ...up.map((u, i) => ({ url: u.url, name: files[i]?.name || u.fileName || 'Document', kind: /pdf/i.test(u.mimeType || files[i]?.type || '') ? 'pdf' : /image/i.test(u.mimeType || files[i]?.type || '') ? 'image' : 'file', addedAt: new Date().toISOString() }))];
      await patch({ documents: docs }, 'Document added');
    } catch (err) { toast.error(err.message || 'Couldn’t upload'); }
    setDocBusy(false);
  };

  if (!p) {
    return (
      <PushPanel onClose={onClose} zIndex={260} header={<Header client={client} onEdit={() => {}} />}>
        <div style={{ padding: 16 }}><Skeleton h={240} r={18} /><Skeleton w="60%" h={24} style={{ marginTop: 18 }} /><Skeleton h={200} r={16} style={{ marginTop: 18 }} /></div>
      </PushPanel>
    );
  }

  const rel = REL[p.relationship] || REL.owns;
  const photos = p.photos && p.photos.length ? p.photos : [];
  const owned = ['owns', 'leased_out'].includes(p.relationship);
  const d = p.derived || {};
  const features = featureList(p);
  const anyUnconfirmed = features.some((f) => !f.confirmed);
  const docs = Array.isArray(p.documents) ? p.documents : [];
  const eyebrow = `${client.firstName || displayName(client)}’s ${p.relationship === 'sold' ? 'sale history' : p.relationship === 'rents' ? 'rental' : p.relationship === 'watching' ? 'watch list' : 'portfolio'}${p.occupancy && OCC[p.occupancy] && owned ? ` · ${OCC[p.occupancy]}` : ''}`;
  const addressLine = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const value = p.relationship === 'sold' ? (p.soldPrice ? `Sold ${money(p.soldPrice)}` : null) : p.estValue ? `${money(p.estValue)}${p.estValueAt ? ` · as of ${fmtMonthYear(p.estValueAt)}` : ''}${p.valueSource ? ` · ${p.valueSource.toUpperCase()}` : ''}` : null;

  return (
    <PushPanel onClose={onClose} zIndex={260} header={<Header client={client} onEdit={() => setEdit(true)} />}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="kc-pd-hero">
          {photos.length > 1 ? (
            <div className="kc-carousel" data-hscroll="">
              {photos.map((u, i) => (
                <button key={u} type="button" onClick={() => setLightbox(i)} style={{ display: 'block' }}>
                  <PropertyPhoto src={u} seed={p.id} ratio="4 / 3" />
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => photos.length && setLightbox(0)} style={{ display: 'block', width: '100%' }}>
              <PropertyPhoto src={photoOf(p)} seed={p.id} ratio="4 / 3" label={p.neighborhood || p.city || undefined} />
            </button>
          )}
          <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, pointerEvents: 'none' }}>
            <span className="kc-blurpill"><span className="kc-dot" style={{ background: rel.dot, boxShadow: `0 0 6px ${rel.dot}` }} />{rel.label}</span>
          </div>
          {photos.length > 1 ? <span className="kc-blurpill kc-mono" style={{ position: 'absolute', top: 10, right: 10, fontSize: 10 }}>{photos.length} PHOTOS</span> : null}
        </div>

        <div style={{ padding: '14px 18px 0' }}>
          <div className="kc-eyebrow">{eyebrow}</div>
          <div className="kc-pd-h1 km-selectable">{propTitle(p)}</div>
          {addressLine || p.buildingName ? <div style={{ fontSize: 14, color: 'var(--dim)', marginTop: 4 }}>{[p.street && p.buildingName ? p.buildingName : null, p.neighborhood, addressLine].filter(Boolean).join(' · ')}</div> : null}
          {(p.badges || []).length ? (
            <div className="kc-badges">
              {p.badges.map((b) => <span key={b.key} className={`kc-tag ${TONE_CLASS[b.tone] || ''}`}>{b.label}</span>)}
            </div>
          ) : null}

          <SectionTitle>Key facts</SectionTitle>
          <div className="kc-specs">
            <Spec label="Type" value={[TYPE_LABEL[p.propertyType] || p.propertyType, p.architecturalStyle].filter(Boolean).join(' · ') || null} />
            <Spec label="Beds / baths" value={p.beds != null || p.baths != null ? `${p.beds ?? '—'} bd · ${p.baths ?? '—'} ba` : null} />
            <Spec label="Interior" value={p.sqft ? `${Number(p.sqft).toLocaleString('en-US')} sq ft${p.estValue && p.sqft ? ` · $${Math.round(p.estValue / p.sqft).toLocaleString('en-US')}/sf` : ''}` : null} />
            <Spec label="Lot" value={p.lotAcres ? `${p.lotAcres} acres` : p.lotSqft ? `${Number(p.lotSqft).toLocaleString('en-US')} sq ft` : null} />
            <Spec label="Year built" value={p.yearBuilt} />
            <Spec label="Waterfront" value={p.waterfront && p.waterfront !== 'none' ? [WATER_LABEL[p.waterfront] || p.waterfront, p.waterFrontageFt ? `${p.waterFrontageFt} ft frontage` : null, p.dockLengthFt ? `${p.dockLengthFt} ft dock` : null].filter(Boolean).join(' · ') : null} />
            <Spec label="Views" value={(p.views || []).length ? p.views.map((v) => v.charAt(0).toUpperCase() + v.slice(1)).join(', ') : null} />
            <Spec label={p.relationship === 'sold' ? 'Sale' : p.relationship === 'rents' ? 'Rent' : 'Value'} value={p.relationship === 'rents' ? (p.rentAmount ? `${money(p.rentAmount)}/mo` : null) : value} />
            <Spec label="MLS #" value={p.mlsNumber} copy={p.mlsNumber} mono />
            <Spec label="Parcel" value={p.parcelNumber} copy={p.parcelNumber} mono />
            {p.listingUrl ? (
              <a className="kc-spec" href={p.listingUrl} target="_blank" rel="noreferrer" style={{ background: 'rgba(46,139,255,0.06)', color: 'var(--bright)', fontWeight: 600, fontSize: 13.5, justifyContent: 'center', gap: 6 }}>
                Open this listing <Icon name="arrowUpRight" size={14} stroke={2.2} />
              </a>
            ) : null}
          </div>

          <SectionTitle action={<span className="kc-eyebrow">{features.length ? `${features.filter((f) => f.confirmed).length} confirmed` : ''}</span>}>Features</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {features.map((f) => (
              <span key={f.name} className={`kc-ochip ${f.confirmed ? 'kc-ochip--ok' : 'kc-ochip--soft'}`} style={{ fontSize: 12.5, padding: '5px 11px' }}>
                {f.confirmed ? <Icon name="check" size={11} color="var(--bright)" stroke={2.6} /> : null}{f.name}
              </span>
            ))}
            {addingFeature ? (
              <input autoFocus className="km-input" value={featureText} onChange={(e) => setFeatureText(e.target.value)} onBlur={addFeature} onKeyDown={(e) => { if (e.key === 'Enter') addFeature(); }} placeholder="Wine cellar" style={{ width: 170, minHeight: 32, padding: '4px 12px', borderRadius: 999 }} />
            ) : (
              <button type="button" className="kc-ochip km-press" style={{ borderStyle: 'dashed', fontSize: 12.5, padding: '5px 11px', color: 'var(--bright)' }} onClick={() => setAddingFeature(true)}>+ Add feature</button>
            )}
          </div>
          {anyUnconfirmed ? <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10, lineHeight: 1.4 }}>Amber features came from your description — they’ll verify against the listing sheet on a match.</div> : null}

          {owned ? <Ownership p={p} client={client} /> : p.relationship === 'rents' ? <LeaseHero p={p} /> : p.relationship === 'sold' ? <SaleHero p={p} /> : null}

          <SectionTitle>Source</SectionTitle>
          <div className="kc-specs">
            <div className="kc-spec">
              <span className="kc-method-ico" style={{ width: 32, height: 32 }}><Icon name={p.source === 'listing_link' ? 'link' : p.source === 'described' ? 'sparkle' : p.source === 'document' ? 'file' : 'edit'} size={15} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{SOURCE_LABEL[p.source] || 'Entered by hand'}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>{({ described: 'AI-parsed from your words — verify on a match', listing_link: 'Exact — parsed from the listing link', document: 'Confirmed — parsed from a document', public_record: 'From county records', mls: 'Pulled from the MLS', import: 'Imported with your book' })[p.source] || 'Your record'}{p.boughtWithMe ? ' · bought with you' : ''}</span>
              </span>
              <button type="button" className="km-btn km-btn--sm km-btn--ghost" style={{ minHeight: 30 }} onClick={() => docInput.current?.click()}>{docBusy ? <Spinner size={13} /> : 'Add doc'}</button>
            </div>
          </div>

          <SectionTitle>Photos</SectionTitle>
          <PhotoStrip label={null} photos={photos} onChange={(next) => patch({ photos: next, heroPhoto: next[0] || null })} />

          <SectionTitle action={<button type="button" className="kc-link" onClick={() => docInput.current?.click()}>{docBusy ? 'Uploading…' : '+ Add'}</button>}>Documents</SectionTitle>
          {docs.length ? (
            <div className="kc-specs">
              {docs.map((doc, i) => (
                <a key={`${doc.url}${i}`} className="kc-spec" href={mediaUrl(doc.url)} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                  <Icon name={doc.kind === 'image' ? 'image' : 'file'} size={17} color="var(--bright)" />
                  <span style={{ flex: 1, minWidth: 0 }} className="km-truncate">{doc.name || 'Document'}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{doc.addedAt ? new Date(doc.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                </a>
              ))}
            </div>
          ) : <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>Deeds, closing statements, surveys, floor plans — keep them with the home.</div>}
          <input ref={docInput} type="file" multiple hidden accept="application/pdf,image/*,.doc,.docx" onChange={addDocs} />

          <SectionTitle action={<span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : ''}</span>}>Notes</SectionTitle>
          <textarea className="km-input km-selectable" rows={3} value={notes} onChange={(e) => onNotes(e.target.value)} placeholder="Renovations, quirks, what they’d need to sell…" />

          {owned ? (
            <>
              <SectionTitle action={<span className="kc-eyebrow">score ≥ 65</span>}>Buyers who’d love this</SectionTitle>
              {buyers === null ? <Skeleton h={56} r={12} /> : buyers.length === 0 ? (
                <div style={{ fontSize: 13.5, color: 'var(--faint)', lineHeight: 1.45 }}>No client demand at 65+ yet. As wishlists grow, this home gets re-checked automatically.</div>
              ) : (
                <div className="km-list" style={{ padding: '0 14px' }}>
                  {buyers.map((b, i) => (
                    <button key={b.client.id} type="button" className="km-row km-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.openClient(b.client.id)}>
                      <Avatar name={displayName(b.client)} seed={b.client.id} src={b.client.avatarUrl} size={38} channel={b.client.deviceMode || undefined} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600 }}>
                          <span className="km-truncate">{displayName(b.client)}</span>
                          {i === 0 ? <span className="kc-tag kc-tag--mono kc-tag--blue" style={{ height: 18 }}>Call first</span> : null}
                          {b.client.isWhale ? <span className="kc-tag kc-tag--mono kc-tag--amber" style={{ height: 18 }}>Whale</span> : null}
                        </span>
                        <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Wants it · {b.search.title}{b.summary ? ` · ${b.summary}` : ''}</span>
                      </span>
                      <ScoreDial value={b.score} size={38} stroke={3.5} />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          <button
            type="button"
            className="km-btn km-btn--block km-btn--lg"
            style={{ marginTop: 26 }}
            onClick={() => nav.newDeal({ clientId: client.id, side: owned ? 'listing' : 'buyer', portfolioPropertyId: p.id, price: (owned ? p.estValue : p.estValue) || undefined })}
          >
            <Icon name="plus" size={17} stroke={2.4} /> {owned ? 'Deal from this property' : p.relationship === 'rents' ? 'Start a buy conversation' : p.relationship === 'sold' ? 'Log a deal for this sale' : 'Start a buyer deal'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', marginTop: 8 }}>
            {owned ? `Opens the opportunity — ${client.firstName || 'client'} × ${propTitle(p)} — on the list side` : 'Creates the opportunity in your pipeline'}
          </div>
        </div>
      </div>

      <PropertyForm open={edit} client={client} property={p} onClose={() => setEdit(false)} onSaved={(np) => { if (!np) { onChanged?.(); onClose?.(); return; } setP((cur) => ({ ...cur, ...np })); onChanged?.(); load(); }} zIndex={470} />
      {lightbox != null ? <PhotoLightbox photos={photos} index={lightbox} onClose={() => setLightbox(null)} /> : null}
    </PushPanel>
  );
}
