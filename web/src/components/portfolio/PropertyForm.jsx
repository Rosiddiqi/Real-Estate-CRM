// PropertyForm — structured add / edit for a Portfolio property (RevMatch
// EditVehicleForm, re-geared). Smart chips for the common picks, money
// inputs that speak RE shorthand ("8.5" = $8.5M), live ARM-reset readout
// (the server owns the date math), and only the sections that fit the
// relationship (owned · rents · sold · watching).
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { TextInput, TextArea, ChipSelect, Switch } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { createProperty, updateProperty, deleteProperty, portfolioSuggestions } from '../../api/portfolio';
import { Seg, ChipInput, MoneyInput, displayName } from '../client/clientKit';
import { PhotoStrip } from './Photos';
import {
  REL_OPTS, OCC_OPTS, TYPES, WATERFRONT, VIEWS, STYLES, FEATURE_SUGS, LOAN_TYPES, VALUE_SOURCES, TITLE_HOLDING, AREA_SUGS, ratePct,
} from './portfolioKit';

const ym = (d) => (d ? String(typeof d === 'string' ? d : new Date(d).toISOString()).slice(0, 7) : '');
const ymd = (d) => (d ? String(typeof d === 'string' ? d : new Date(d).toISOString()).slice(0, 10) : '');
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };

function toForm(p = {}, relationship) {
  const meta = p.meta || {};
  return {
    relationship: p.relationship || relationship || 'owns', occupancy: p.occupancy || '',
    street: p.street || '', unit: p.unit || '', city: p.city || '', state: p.state || 'FL', zip: p.zip || '',
    neighborhood: p.neighborhood || '', buildingName: p.buildingName || '',
    propertyType: p.propertyType || '', architecturalStyle: p.architecturalStyle || '',
    beds: p.beds ?? '', baths: p.baths ?? '', sqft: p.sqft ?? '', lotAcres: p.lotAcres ?? (p.lotSqft ? Math.round((p.lotSqft / 43560) * 100) / 100 : ''),
    yearBuilt: p.yearBuilt ?? '', waterfront: p.waterfront || '', waterFrontageFt: p.waterFrontageFt ?? '', dockLengthFt: p.dockLengthFt ?? '',
    views: p.views || [], features: Array.isArray(p.features) ? p.features : [],
    estValue: p.estValue ?? null, valueSource: p.valueSource || 'manual',
    purchasePrice: p.purchasePrice ?? null, purchasedAt: ym(p.purchasedAt), boughtWithMe: !!p.boughtWithMe,
    financed: p.loanType ? p.loanType !== 'cash' : (p.mortgageBalance ? true : false),
    loanType: p.loanType && p.loanType !== 'cash' ? p.loanType : 'fixed', lenderName: p.lenderName || '',
    ratePct: p.mortgageRate != null ? String(Math.round(ratePct(p.mortgageRate) * 1000) / 1000) : '',
    armFixedYears: meta.armFixedYears ?? 7, originatedAt: meta.originatedAt ? ym(meta.originatedAt) : '', termYears: meta.loanTermMonths ? meta.loanTermMonths / 12 : 30,
    mortgageBalance: p.mortgageBalance ?? null, monthlyPayment: meta.monthlyPayment ?? null, loanResetAt: ymd(p.loanResetAt),
    hoaMonthly: p.hoaMonthly ?? null, taxAnnual: p.taxAnnual ?? null, insuranceAnnual: meta.insuranceAnnual ?? null, titleHolding: p.titleHolding || '',
    rentAmount: p.rentAmount ?? null, leaseEndsAt: ymd(p.leaseEndsAt),
    soldPrice: p.soldPrice ?? null, soldAt: ym(p.soldAt), soldWithMe: !!p.soldWithMe, thinkingOfSelling: !!p.thinkingOfSelling,
    mlsNumber: p.mlsNumber || '', parcelNumber: p.parcelNumber || '', listingUrl: p.listingUrl || '', notes: p.notes || '', photos: p.photos || [],
  };
}

function resetReadout(f) {
  if (!f.financed || f.loanType !== 'arm' || !f.originatedAt || !f.armFixedYears) return null;
  const [y, m] = f.originatedAt.split('-').map(Number);
  if (!y || !m) return null;
  const d = new Date(Date.UTC(y + Number(f.armFixedYears), m - 1, 15));
  const days = Math.ceil((d - Date.now()) / 864e5);
  return { label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), days };
}

export default function PropertyForm({ open, client, property, prefill, relationship, onClose, onSaved, zIndex = 460 }) {
  const editing = !!(property && property.id);
  const [f, setF] = useState(() => toForm(property || prefill || {}, relationship));
  const [sugs, setSugs] = useState(null);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => { if (open) setF(toForm(property || prefill || {}, relationship)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !sugs) portfolioSuggestions().then(setSugs).catch(() => {}); }, [open, sugs]);

  const rel = f.relationship;
  const owned = rel === 'owns' || rel === 'leased_out';
  const reset = useMemo(() => resetReadout(f), [f]);
  const featureNames = f.features.map((x) => x.name);
  const hoodSugs = [...new Set([...(sugs?.neighborhoods || []), ...AREA_SUGS])].slice(0, 30);

  const payload = () => {
    const out = {
      relationship: rel, occupancy: owned ? (f.occupancy || null) : null,
      street: f.street.trim() || null, unit: f.unit.trim() || null, city: f.city.trim() || null, state: f.state.trim() || null, zip: f.zip.trim() || null,
      neighborhood: f.neighborhood.trim() || null, buildingName: f.buildingName.trim() || null,
      propertyType: f.propertyType || null, architecturalStyle: f.architecturalStyle || null,
      beds: num(f.beds), baths: num(f.baths), sqft: num(f.sqft), yearBuilt: num(f.yearBuilt),
      lotAcres: num(f.lotAcres), lotSqft: num(f.lotAcres) != null ? Math.round(num(f.lotAcres) * 43560) : null,
      waterfront: f.waterfront || null, waterFrontageFt: num(f.waterFrontageFt), dockLengthFt: num(f.dockLengthFt),
      views: f.views, features: f.features,
      estValue: f.estValue, valueSource: f.estValue ? f.valueSource : null,
      purchasePrice: f.purchasePrice, purchasedAt: f.purchasedAt || null, boughtWithMe: f.boughtWithMe,
      mlsNumber: f.mlsNumber.trim() || null, parcelNumber: f.parcelNumber.trim() || null, listingUrl: f.listingUrl.trim() || null,
      notes: f.notes.trim() || null, photos: f.photos, thinkingOfSelling: f.thinkingOfSelling,
    };
    if (owned) {
      out.titleHolding = f.titleHolding || null;
      out.hoaMonthly = f.hoaMonthly; out.taxAnnual = f.taxAnnual;
      if (f.financed) {
        out.loanType = f.loanType; out.lenderName = f.lenderName.trim() || null;
        out.mortgageRate = num(f.ratePct) != null ? num(f.ratePct) / 100 : null;
        out.mortgageBalance = f.mortgageBalance;
        out.meta = {
          originatedAt: f.originatedAt ? `${f.originatedAt}-15` : null,
          armFixedYears: f.loanType === 'arm' ? num(f.armFixedYears) : null,
          loanTermMonths: num(f.termYears) ? Math.round(num(f.termYears) * 12) : null,
          monthlyPayment: f.monthlyPayment, insuranceAnnual: f.insuranceAnnual,
        };
        if (f.loanResetAt && !(f.loanType === 'arm' && f.originatedAt)) out.loanResetAt = f.loanResetAt;
        if (f.loanType !== 'arm') out.loanResetAt = null;
      } else {
        out.loanType = 'cash'; out.mortgageBalance = 0; out.mortgageRate = null; out.lenderName = null; out.loanResetAt = null; out.loanMaturesAt = null;
        out.meta = { originatedAt: null, armFixedYears: null, loanTermMonths: null, monthlyPayment: null, insuranceAnnual: f.insuranceAnnual };
      }
    }
    if (rel === 'rents' || rel === 'leased_out') { out.rentAmount = f.rentAmount; out.leaseEndsAt = f.leaseEndsAt || null; }
    if (rel === 'sold') { out.soldPrice = f.soldPrice; out.soldAt = f.soldAt || null; out.soldWithMe = f.soldWithMe; }
    if (!editing) {
      out.clientId = client.id;
      if (prefill && prefill.source) out.source = prefill.source;
      if (prefill && prefill.meta && prefill.meta.exact) out.meta = { ...(out.meta || {}), exact: prefill.meta.exact };
    }
    return out;
  };

  const save = async () => {
    if (saving) return;
    if (!f.street.trim() && !f.buildingName.trim() && !f.neighborhood.trim() && !f.city.trim()) { toast.error('Add an address, building or neighborhood.'); return; }
    setSaving(true);
    try {
      const body = payload();
      const r = editing ? await updateProperty(property.id, body) : await createProperty(body);
      toast.success(editing ? 'Property updated' : 'Added to portfolio');
      onSaved?.(r.property);
      closeRef.current?.();
    } catch (e) {
      toast.error(e.message || 'Couldn’t save');
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this property?', message: 'It leaves their portfolio. This can’t be undone.', confirmLabel: 'Delete property', destructive: true }))) return;
    try {
      await deleteProperty(property.id);
      toast('Property removed');
      onSaved?.(null);
      closeRef.current?.();
    } catch (e) { toast.error(e.message || 'Couldn’t delete'); }
  };

  const sec = (t) => <span className="kc-eyebrow" style={{ display: 'block', margin: '22px 2px 10px' }}>{t}</span>;

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit property' : 'Add a property'} subtitle={`${client.firstName || displayName(client)}’s portfolio`} zIndex={zIndex} maxHeight="92%" right={{ label: saving ? 'Saving…' : 'Save', onClick: save, disabled: saving }}>
      {({ close }) => { closeRef.current = close; return (
        <div style={{ paddingBottom: 12 }}>
          <Seg value={rel} onChange={(v) => set({ relationship: v })} options={editing && rel === 'leased_out' ? [{ value: 'leased_out', label: 'Rental' }, ...REL_OPTS] : REL_OPTS} />
          {owned ? (
            <div style={{ marginTop: 10 }}>
              <ChipSelect multi={false} options={[...OCC_OPTS, { value: 'leased_out', label: 'Rented out' }]} value={rel === 'leased_out' ? ['leased_out'] : f.occupancy ? [f.occupancy] : []} onChange={(v) => { if (v[0] === 'leased_out') set({ relationship: 'leased_out', occupancy: 'rental' }); else set({ relationship: 'owns', occupancy: v[0] || '' }); }} />
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <PhotoStrip photos={f.photos} onChange={(photos) => set({ photos })} label="Photos" hint="First photo is the cover." />
          </div>

          {sec('Address')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px', gap: 10 }}>
              <TextInput label="Street" value={f.street} onChange={(e) => set({ street: e.target.value })} placeholder="4 Tahiti Beach Island Rd" />
              <TextInput label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="PH5" />
            </div>
            <TextInput label="Building / community" value={f.buildingName} onChange={(e) => set({ buildingName: e.target.value })} placeholder="Four Seasons Surf Club" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 92px', gap: 10 }}>
              <TextInput label="City" value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="Coral Gables" />
              <TextInput label="State" value={f.state} onChange={(e) => set({ state: e.target.value.toUpperCase().slice(0, 2) })} />
              <TextInput label="ZIP" inputMode="numeric" value={f.zip} onChange={(e) => set({ zip: e.target.value.slice(0, 10) })} />
            </div>
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Neighborhood</span>
              <ChipInput value={f.neighborhood ? [f.neighborhood] : []} onChange={(v) => set({ neighborhood: v[v.length - 1] || '' })} suggestions={hoodSugs.slice(0, 10)} max={1} placeholder="Gables Estates" />
            </div>
          </div>

          {sec('The home')}
          <ChipSelect multi={false} options={TYPES} value={f.propertyType ? [f.propertyType] : []} onChange={(v) => set({ propertyType: v[0] || '' })} />
          <div className="kc-grid3" style={{ marginTop: 12 }}>
            <TextInput label="Beds" inputMode="numeric" value={f.beds} onChange={(e) => set({ beds: e.target.value.replace(/[^\d]/g, '') })} />
            <TextInput label="Baths" inputMode="decimal" value={f.baths} onChange={(e) => set({ baths: e.target.value.replace(/[^\d.]/g, '') })} />
            <TextInput label="Interior sf" inputMode="numeric" value={f.sqft} onChange={(e) => set({ sqft: e.target.value.replace(/[^\d]/g, '') })} />
          </div>
          <div className="kc-grid3" style={{ marginTop: 10 }}>
            <TextInput label="Lot (acres)" inputMode="decimal" value={f.lotAcres} onChange={(e) => set({ lotAcres: e.target.value.replace(/[^\d.]/g, '') })} />
            <TextInput label="Year built" inputMode="numeric" value={f.yearBuilt} onChange={(e) => set({ yearBuilt: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} />
            <TextInput label="Style" value={f.architecturalStyle} onChange={(e) => set({ architecturalStyle: e.target.value })} list="kc-styles" />
          </div>
          <datalist id="kc-styles">{[...new Set([...(sugs?.styles || []), ...STYLES])].map((s) => <option key={s} value={s} />)}</datalist>

          {sec('Water & views')}
          <ChipSelect multi={false} options={WATERFRONT} value={f.waterfront ? [f.waterfront] : []} onChange={(v) => set({ waterfront: v[0] || '' })} />
          {f.waterfront ? (
            <div className="kc-grid2" style={{ marginTop: 10 }}>
              <TextInput label="Frontage (ft)" inputMode="numeric" value={f.waterFrontageFt} onChange={(e) => set({ waterFrontageFt: e.target.value.replace(/[^\d]/g, '') })} />
              <TextInput label="Dock (ft)" inputMode="numeric" value={f.dockLengthFt} onChange={(e) => set({ dockLengthFt: e.target.value.replace(/[^\d]/g, '') })} />
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}><ChipSelect options={VIEWS} value={f.views} onChange={(v) => set({ views: v })} /></div>

          {sec('Features')}
          <ChipInput
            value={featureNames}
            onChange={(names) => set({ features: names.map((n) => f.features.find((x) => x.name === n) || { name: n, confirmed: false, importance: 'stated' }) })}
            suggestions={[...new Set([...FEATURE_SUGS, ...((sugs?.features) || [])])]}
            placeholder="Pool, dock, wine cellar…"
          />

          {rel !== 'rents' ? (
            <>
              {sec(rel === 'watching' ? 'Price' : 'Value')}
              <div className="kc-grid2">
                <MoneyInput label={rel === 'watching' ? 'List price' : 'Est. value'} value={f.estValue} onChange={(v) => set({ estValue: v })} placeholder="12.4" />
                {rel !== 'watching' ? (
                  <label className="km-field">
                    <span className="km-field-label">Source</span>
                    <select className="km-input" value={f.valueSource} onChange={(e) => set({ valueSource: e.target.value })}>{VALUE_SOURCES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>
                  </label>
                ) : <TextInput label="MLS #" value={f.mlsNumber} onChange={(e) => set({ mlsNumber: e.target.value })} />}
              </div>
            </>
          ) : null}

          {owned || rel === 'sold' ? (
            <>
              {sec('Purchase')}
              <div className="kc-grid2">
                <MoneyInput label="Purchase price" value={f.purchasePrice} onChange={(v) => set({ purchasePrice: v })} placeholder="4.2" />
                <TextInput label="Bought" type="month" value={f.purchasedAt} onChange={(e) => set({ purchasedAt: e.target.value })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <span style={{ fontSize: 15 }}>Bought with me</span>
                <Switch checked={f.boughtWithMe} onChange={(v) => set({ boughtWithMe: v })} label="Bought with me" />
              </label>
            </>
          ) : null}

          {owned ? (
            <>
              {sec('Ownership & financing')}
              <Seg value={f.financed ? 'mortgage' : 'clear'} onChange={(v) => set({ financed: v === 'mortgage' })} options={[{ value: 'clear', label: 'Free & clear' }, { value: 'mortgage', label: 'Mortgage' }]} />
              {f.financed ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  <Seg value={f.loanType} onChange={(v) => set({ loanType: v })} options={LOAN_TYPES} />
                  <div className="kc-grid2">
                    <TextInput label="Lender" value={f.lenderName} onChange={(e) => set({ lenderName: e.target.value })} list="kc-lenders" placeholder="Private bank" />
                    <TextInput label="Rate %" inputMode="decimal" value={f.ratePct} onChange={(e) => set({ ratePct: e.target.value.replace(/[^\d.]/g, '') })} placeholder="6.125" />
                  </div>
                  <datalist id="kc-lenders">{(sugs?.lenders || []).map((s) => <option key={s} value={s} />)}</datalist>
                  <div className="kc-grid3">
                    <TextInput label="Originated" type="month" value={f.originatedAt} onChange={(e) => set({ originatedAt: e.target.value })} />
                    {f.loanType === 'arm' ? (
                      <label className="km-field"><span className="km-field-label">Fixed for</span>
                        <select className="km-input" value={f.armFixedYears} onChange={(e) => set({ armFixedYears: Number(e.target.value) })}>{[3, 5, 7, 10].map((y) => <option key={y} value={y}>{y} yrs ({y}/1)</option>)}</select>
                      </label>
                    ) : <TextInput label="Term (yrs)" inputMode="numeric" value={f.termYears} onChange={(e) => set({ termYears: e.target.value.replace(/[^\d]/g, '') })} />}
                    <MoneyInput label="Balance" value={f.mortgageBalance} onChange={(v) => set({ mortgageBalance: v })} placeholder="3.1" />
                  </div>
                  {f.loanType === 'arm' ? (
                    <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--tint)', border: '1px solid rgba(46,139,255,0.3)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="percent" size={15} color="var(--bright)" />
                      {reset ? <span>Rate resets <b>{reset.label}</b> · {reset.days >= 0 ? `in ${reset.days} days` : `${-reset.days} days ago`}</span> : <span style={{ color: 'var(--dim)' }}>Enter the origination month to see the reset date</span>}
                    </div>
                  ) : null}
                  {f.loanType === 'arm' && !f.originatedAt ? <TextInput label="…or the reset date" type="date" value={f.loanResetAt} onChange={(e) => set({ loanResetAt: e.target.value })} /> : null}
                  <MoneyInput label="Monthly PITI" value={f.monthlyPayment} onChange={(v) => set({ monthlyPayment: v })} placeholder="38,400" />
                </div>
              ) : null}
              <div className="kc-grid3" style={{ marginTop: 12 }}>
                <MoneyInput label="HOA /mo" value={f.hoaMonthly} onChange={(v) => set({ hoaMonthly: v })} />
                <MoneyInput label="Taxes /yr" value={f.taxAnnual} onChange={(v) => set({ taxAnnual: v })} />
                <MoneyInput label="Insurance /yr" value={f.insuranceAnnual} onChange={(v) => set({ insuranceAnnual: v })} />
              </div>
              <div style={{ marginTop: 12 }}>
                <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Title held as</span>
                <ChipSelect multi={false} options={TITLE_HOLDING} value={f.titleHolding ? [f.titleHolding] : []} onChange={(v) => set({ titleHolding: v[0] || '' })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                <span style={{ fontSize: 15 }}>Thinking of selling</span>
                <Switch checked={f.thinkingOfSelling} onChange={(v) => set({ thinkingOfSelling: v })} label="Thinking of selling" />
              </label>
            </>
          ) : null}

          {rel === 'rents' || rel === 'leased_out' ? (
            <>
              {sec(rel === 'rents' ? 'Their lease' : 'Tenant lease')}
              <div className="kc-grid2">
                <MoneyInput label="Rent /mo" value={f.rentAmount} onChange={(v) => set({ rentAmount: v })} placeholder="25,000" />
                <TextInput label="Lease ends" type="date" value={f.leaseEndsAt} onChange={(e) => set({ leaseEndsAt: e.target.value })} />
              </div>
            </>
          ) : null}

          {rel === 'sold' ? (
            <>
              {sec('Sale')}
              <div className="kc-grid2">
                <MoneyInput label="Sold for" value={f.soldPrice} onChange={(v) => set({ soldPrice: v })} placeholder="7.1" />
                <TextInput label="Sold" type="month" value={f.soldAt} onChange={(e) => set({ soldAt: e.target.value })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <span style={{ fontSize: 15 }}>Sold with me</span>
                <Switch checked={f.soldWithMe} onChange={(v) => set({ soldWithMe: v })} label="Sold with me" />
              </label>
            </>
          ) : null}

          {sec('Records')}
          <div className="kc-grid2">
            <TextInput label="MLS #" value={f.mlsNumber} onChange={(e) => set({ mlsNumber: e.target.value })} />
            <TextInput label="Parcel / folio" value={f.parcelNumber} onChange={(e) => set({ parcelNumber: e.target.value })} />
          </div>
          <TextInput style={{ marginTop: 10 }} label="Listing link" type="url" autoCapitalize="off" value={f.listingUrl} onChange={(e) => set({ listingUrl: e.target.value })} placeholder="https://" />
          <TextArea style={{ marginTop: 10 }} label="Notes" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Full gut reno in 2022; wants out of the HOA…" />

          <button type="button" className="km-btn km-btn--block km-btn--lg" style={{ marginTop: 20 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add to portfolio'}</button>
          {editing ? (
            <button type="button" className="km-btn km-btn--block" style={{ marginTop: 10, background: 'transparent', boxShadow: 'none', border: '1px solid rgba(255,90,90,0.45)', color: 'var(--red)' }} onClick={remove}>
              Delete property
            </button>
          ) : null}
        </div>
      ); }}
    </Sheet>
  );
}
