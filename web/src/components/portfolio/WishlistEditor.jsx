// WishlistEditor — create / edit a BuyerSearch (RevMatch DreamEditor,
// re-geared). Describe it (or paste a listing link for "more like this") and
// AI fills the criteria; then fine-tune: areas, buildings, types, price band,
// beds/baths/size/lot, styles, water, views, must-haves (Must/Want + numeric
// mins like dock ≥ 80 ft), deal-breakers, timeline, financing — plus live
// matches with one-tap Send, and an optional waitlist join.
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { TextInput, TextArea, ChipSelect, Switch, Spinner, ScoreDial } from '../ui/kit';
import PropertyPhoto from '../ui/PropertyPhoto';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { createSearch, updateSearch, deleteSearch, parseCapture, portfolioSuggestions } from '../../api/portfolio';
import { listWaitlists, addWaitlistEntry } from '../../api/clients';
import { Seg, ChipInput, MoneyInput, TIMELINES, displayName } from '../client/clientKit';
import { TYPES, WATERFRONT, VIEWS, STYLES, FEATURE_SUGS, DEALBREAKER_SUGS, AREA_SUGS, money, featureLabel } from './portfolioKit';

const FINANCING_OPTS = [
  { value: 'cash', label: 'Cash' }, { value: 'jumbo', label: 'Jumbo' }, { value: '1031_exchange', label: '1031' },
  { value: 'bridge', label: 'Bridge' }, { value: 'preapproved', label: 'Pre-approved' }, { value: 'undecided', label: 'Undecided' },
];
const BEDS = ['Any', '1', '2', '3', '4', '5', '6', '7'];
const NUMERIC_HINT = /(dock|slip|frontage|garage|acre|ceiling)/i;

function toForm(s = {}) {
  const raw = s.criteriaRaw || {};
  return {
    name: s.name || '', bucket: s.bucket || 'active', status: s.status || 'active',
    neighborhoods: s.neighborhoods || [], buildings: s.buildings || [], markets: s.markets || [], propertyTypes: s.propertyTypes || [],
    priceMin: s.priceMin ?? null, priceMax: s.priceMax ?? null, budgetFlexible: !!s.budgetFlexible,
    bedsMin: s.bedsMin ?? null, bathsMin: s.bathsMin ?? '', sqftMin: s.sqftMin ?? '', lotAcresMin: s.lotSqftMin ? Math.round((s.lotSqftMin / 43560) * 100) / 100 : '',
    yearBuiltMin: s.yearBuiltMin ?? '', styles: s.styles || [], waterfront: s.waterfront || [], views: s.views || [],
    mustHaves: (Array.isArray(s.mustHaves) ? s.mustHaves : []).map((m) => ({ feature: m.feature, must: (m.importance ?? 1) >= 1, min: m.min ?? '', key: m.key || null, source: m.source || 'search' })),
    niceToHaves: s.niceToHaves || [], dealBreakers: s.dealBreakers || [], timeline: s.timeline || '', financing: s.financing || '',
    preApprovalAmount: raw.preApprovalAmount ?? null, notes: s.notes || '',
  };
}

function mergeParsed(f, p) {
  const u = (a, b) => [...new Set([...(a || []), ...(b || [])])];
  const out = { ...f };
  out.neighborhoods = u(f.neighborhoods, p.neighborhoods);
  out.buildings = u(f.buildings, p.buildings);
  out.markets = u(f.markets, p.markets);
  out.propertyTypes = u(f.propertyTypes, p.propertyTypes);
  if (p.priceMin && !f.priceMin) out.priceMin = p.priceMin;
  if (p.priceMax && !f.priceMax) out.priceMax = p.priceMax;
  if (p.budgetFlexible) out.budgetFlexible = true;
  if (p.bedsMin && !f.bedsMin) out.bedsMin = p.bedsMin;
  if (p.bathsMin && !f.bathsMin) out.bathsMin = p.bathsMin;
  if (p.sqftMin && !f.sqftMin) out.sqftMin = p.sqftMin;
  if (p.lotSqftMin && !f.lotAcresMin) out.lotAcresMin = Math.round((p.lotSqftMin / 43560) * 100) / 100;
  if (p.yearBuiltMin && !f.yearBuiltMin) out.yearBuiltMin = p.yearBuiltMin;
  out.styles = u(f.styles, (p.styles || []).map((s) => String(s).replace(/\b\w/g, (m) => m.toUpperCase())));
  out.waterfront = u(f.waterfront, p.waterfront);
  out.views = u(f.views, p.views);
  const have = new Set(f.mustHaves.map((m) => m.feature.toLowerCase()));
  out.mustHaves = [...f.mustHaves, ...(p.mustHaves || []).filter((m) => !have.has(String(m.feature).toLowerCase())).map((m) => ({ feature: m.feature, must: (m.importance ?? 1) >= 1, min: m.min ?? '', key: m.key || null, source: 'text' }))];
  out.niceToHaves = u(f.niceToHaves, p.niceToHaves);
  out.dealBreakers = u(f.dealBreakers, p.dealBreakers);
  if (p.timeline && !f.timeline) out.timeline = p.timeline;
  if (p.financing && !f.financing) out.financing = p.financing;
  if (p.criteriaRaw && p.criteriaRaw.preApprovalAmount && !f.preApprovalAmount) out.preApprovalAmount = p.criteriaRaw.preApprovalAmount;
  if (p.bucket === 'dream' && !f.name) out.bucket = 'dream';
  return out;
}

export default function WishlistEditor({ open, client, search, prefillText, matches, onClose, onSaved }) {
  const editing = !!(search && search.id);
  const [f, setF] = useState(() => toForm(search || {}));
  const [describe, setDescribe] = useState('');
  const [link, setLink] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedFrom, setParsedFrom] = useState(null);
  const [sugs, setSugs] = useState(null);
  const [waitlists, setWaitlists] = useState(null);
  const [joinWl, setJoinWl] = useState('');
  const [mustText, setMustText] = useState('');
  const [saving, setSaving] = useState(false);
  const closeRef = useRef(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (!open) return;
    setF(toForm(search || {})); setDescribe(prefillText || ''); setLink(''); setParsedFrom(null); setJoinWl(''); setMustText('');
    if (!sugs) portfolioSuggestions().then(setSugs).catch(() => {});
    listWaitlists().then((r) => setWaitlists(r.waitlists || [])).catch(() => setWaitlists([]));
    if (!editing && prefillText && prefillText.trim().length >= 8) fill({ text: prefillText.trim() });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fill(payload) {
    if (parsing) return;
    setParsing(true);
    try {
      const r = await parseCapture({ ...payload, target: 'search' });
      if (r.error) toast.error(r.error);
      else {
        setF((x) => {
          const m = mergeParsed(x, r.fields || {});
          if (payload.text && !x.notes) m.notes = payload.text;
          return m;
        });
        setParsedFrom(r.source === 'ai' ? 'AI' : 'parsed');
      }
    } catch (e) { toast.error(e.message || 'Couldn’t read that'); }
    setParsing(false);
  }

  const addMust = (raw) => {
    const v = String(raw || '').trim();
    if (!v || f.mustHaves.some((m) => m.feature.toLowerCase() === v.toLowerCase())) { setMustText(''); return; }
    const n = /(\d{2,4})/.exec(v);
    set({ mustHaves: [...f.mustHaves, { feature: v, must: true, min: n && NUMERIC_HINT.test(v) ? Number(n[1]) : '', key: null, source: 'search' }] });
    setMustText('');
  };

  const body = () => ({
    name: f.name.trim() || null, bucket: f.bucket, status: f.status,
    neighborhoods: f.neighborhoods, buildings: f.buildings, markets: f.markets, propertyTypes: f.propertyTypes,
    priceMin: f.priceMin, priceMax: f.priceMax, budgetFlexible: f.budgetFlexible,
    bedsMin: f.bedsMin || null, bathsMin: f.bathsMin === '' ? null : Number(f.bathsMin), sqftMin: f.sqftMin === '' ? null : Number(f.sqftMin),
    lotSqftMin: f.lotAcresMin === '' || f.lotAcresMin == null ? null : Math.round(Number(f.lotAcresMin) * 43560),
    yearBuiltMin: f.yearBuiltMin === '' ? null : Number(f.yearBuiltMin),
    styles: f.styles, waterfront: f.waterfront, views: f.views,
    mustHaves: f.mustHaves.map((m) => ({ feature: m.feature, importance: m.must ? 1 : 0.5, source: m.source || 'search', ...(m.min !== '' && m.min != null ? { min: Number(m.min) } : {}), ...(m.key ? { key: m.key } : {}) })),
    niceToHaves: f.niceToHaves, dealBreakers: f.dealBreakers, timeline: f.timeline || null, financing: f.financing || null,
    notes: f.notes.trim() || null,
    criteriaRaw: { preApprovalAmount: f.preApprovalAmount || null, ...(describe.trim() ? { freeText: describe.trim() } : {}) },
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = editing ? await updateSearch(search.id, body()) : await createSearch({ ...body(), clientId: client.id });
      if (joinWl) {
        try { await addWaitlistEntry(joinWl, { clientId: client.id, notes: r.search?.title ? `Wishlist: ${r.search.title}` : null }); }
        catch (e) { if (e.status !== 409) toast.error(e.message || 'Couldn’t join the waitlist'); }
      }
      toast.success(editing ? 'Wishlist updated' : f.bucket === 'dream' ? 'Added to their wishlist' : 'Search started — matching now');
      onSaved?.(r.search);
      closeRef.current?.();
    } catch (e) {
      toast.error(e.message || 'Couldn’t save');
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this search?', confirmLabel: 'Delete search', destructive: true }))) return;
    try { await deleteSearch(search.id); toast('Search removed'); onSaved?.(null); closeRef.current?.(); } catch (e) { toast.error(e.message || 'Couldn’t delete'); }
  };

  const sec = (t, extra) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 2px 10px' }}>
      <span className="kc-eyebrow">{t}</span>{extra || null}
    </div>
  );
  const areaSugs = [...new Set([...(sugs?.neighborhoods || []), ...AREA_SUGS])];
  const first = client.firstName || displayName(client);

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit search' : 'New search'} subtitle={`${first}’s wishlist`} zIndex={440} maxHeight="92%" right={{ label: saving ? 'Saving…' : 'Save', onClick: save, disabled: saving }}>
      {({ close }) => { closeRef.current = close; return (
        <div style={{ paddingBottom: 12 }}>
          <div style={{ padding: 14, borderRadius: 'var(--r-card)', background: 'var(--glass-fill)', border: 'var(--hairline) solid var(--hl-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="sparkle" size={14} color="var(--violet)" stroke={2.2} />
              <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: 1.3, color: 'var(--violet)' }}>DESCRIBE IT</span>
              {parsedFrom ? <span className="kc-tag kc-tag--mono kc-tag--violet" style={{ height: 18, marginLeft: 'auto' }}>Filled · {parsedFrom}</span> : null}
            </div>
            <textarea className="km-input" rows={3} style={{ marginTop: 8, minHeight: 84 }} value={describe} onChange={(e) => setDescribe(e.target.value)}
              placeholder="“Bay-front in Gables Estates or Cocoplum, 6+ beds, modern, needs a dock for a 70' boat, around 9 up to 11, no HOA, by August”" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="km-btn km-btn--sm" disabled={describe.trim().length < 6 || parsing} onClick={() => fill({ text: describe.trim() })}>
                {parsing ? <Spinner size={14} /> : <Icon name="sparkle" size={14} stroke={2.2} />} Fill the criteria
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="km-input" type="url" autoCapitalize="off" placeholder="…or paste a listing link — “more like this”" value={link} onChange={(e) => setLink(e.target.value)} style={{ flex: 1, minHeight: 40, padding: '8px 12px' }} />
              <button type="button" className="km-btn km-btn--sm km-btn--ghost" disabled={!link.trim() || parsing} onClick={() => fill({ url: link.trim() })}>Read</button>
            </div>
          </div>

          {sec('Search')}
          <TextInput value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name it (optional) — e.g. Bay-front estate · Gables" />
          <div style={{ marginTop: 10 }}>
            <Seg value={f.bucket} onChange={(v) => set({ bucket: v })} options={[{ value: 'active', label: 'Actively searching' }, { value: 'dream', label: 'Dream / someday' }]} />
          </div>
          {editing ? (
            <div style={{ marginTop: 8 }}>
              <Seg value={f.status} onChange={(v) => set({ status: v })} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'found', label: 'Found it' }]} />
            </div>
          ) : null}

          {sec('Where')}
          <ChipInput value={f.neighborhoods} onChange={(v) => set({ neighborhoods: v })} suggestions={areaSugs} placeholder="Add every area they’d live in" />
          <div style={{ marginTop: 10 }}>
            <ChipInput value={f.buildings} onChange={(v) => set({ buildings: v })} suggestions={(sugs?.buildings || []).slice(0, 12)} placeholder="Buildings (optional)" />
          </div>
          <div style={{ marginTop: 10 }}>
            <ChipInput value={f.markets} onChange={(v) => set({ markets: v })} suggestions={(sugs?.cities || []).slice(0, 8)} placeholder="Markets / cities (optional)" />
          </div>

          {sec('What')}
          <ChipSelect options={TYPES} value={f.propertyTypes} onChange={(v) => set({ propertyTypes: v })} />

          {sec('Budget', (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dim)' }}>Flexible <Switch checked={f.budgetFlexible} onChange={(v) => set({ budgetFlexible: v })} label="Flexible budget" /></span>
          ))}
          <div className="kc-grid2">
            <MoneyInput label="From" value={f.priceMin} onChange={(v) => set({ priceMin: v })} placeholder="8 = $8M" />
            <MoneyInput label="Up to" value={f.priceMax} onChange={(v) => set({ priceMax: v })} placeholder="11" />
          </div>

          {sec('Size')}
          <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Bedrooms</span>
          <ChipSelect multi={false} options={BEDS.map((b) => ({ value: b, label: b === 'Any' ? 'Any' : `${b}+` }))} value={[f.bedsMin ? String(f.bedsMin) : 'Any']} onChange={(v) => set({ bedsMin: !v[0] || v[0] === 'Any' ? null : Number(v[0]) })} />
          <div className="kc-grid2" style={{ marginTop: 10 }}>
            <TextInput label="Baths min" inputMode="decimal" value={f.bathsMin} onChange={(e) => set({ bathsMin: e.target.value.replace(/[^\d.]/g, '') })} />
            <TextInput label="Interior sf min" inputMode="numeric" value={f.sqftMin} onChange={(e) => set({ sqftMin: e.target.value.replace(/[^\d]/g, '') })} />
          </div>
          <div className="kc-grid2" style={{ marginTop: 10 }}>
            <TextInput label="Lot min (acres)" inputMode="decimal" value={f.lotAcresMin} onChange={(e) => set({ lotAcresMin: e.target.value.replace(/[^\d.]/g, '') })} />
            <TextInput label="Built after" inputMode="numeric" value={f.yearBuiltMin} onChange={(e) => set({ yearBuiltMin: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} />
          </div>

          {sec('Style, water & views')}
          <ChipSelect options={STYLES} value={f.styles} onChange={(v) => set({ styles: v })} />
          <div style={{ marginTop: 10 }}><ChipSelect options={WATERFRONT} value={f.waterfront} onChange={(v) => set({ waterfront: v })} /></div>
          <div style={{ marginTop: 10 }}><ChipSelect options={VIEWS} value={f.views} onChange={(v) => set({ views: v })} /></div>

          {sec('Must-haves')}
          {f.mustHaves.map((m, i) => (
            <div key={m.feature} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--kc-hair)' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 500 }} className="km-truncate">{featureLabel(m.feature)}</span>
              {NUMERIC_HINT.test(m.feature) || m.min !== '' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--dim)' }}>
                  ≥ <input className="km-input" inputMode="numeric" value={m.min} onChange={(e) => set({ mustHaves: f.mustHaves.map((x, j) => (j === i ? { ...x, min: e.target.value.replace(/[^\d.]/g, '') } : x)) })} style={{ width: 64, minHeight: 34, padding: '6px 8px' }} />
                </span>
              ) : null}
              <div className="kc-seg" style={{ padding: 2 }}>
                {[['must', 'Must'], ['want', 'Want']].map(([k, l]) => (
                  <button key={k} type="button" className={(k === 'must') === m.must ? 'kc-on' : ''} style={{ height: 28, fontSize: 12, padding: '0 9px' }} onClick={() => set({ mustHaves: f.mustHaves.map((x, j) => (j === i ? { ...x, must: k === 'must' } : x)) })}>{l}</button>
                ))}
              </div>
              <button type="button" aria-label="Remove" onClick={() => set({ mustHaves: f.mustHaves.filter((_, j) => j !== i) })} style={{ display: 'flex', color: 'var(--faint)', padding: 4 }}><Icon name="x" size={15} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input className="km-input" value={mustText} onChange={(e) => setMustText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMust(mustText); } }} placeholder="Dock ≥ 80 ft, pool, guest house…" style={{ flex: 1 }} />
            <button type="button" className="km-btn km-btn--ghost" style={{ minHeight: 46 }} disabled={!mustText.trim()} onClick={() => addMust(mustText)}>Add</button>
          </div>
          <div className="kc-sugs">
            {FEATURE_SUGS.filter((s) => !f.mustHaves.some((m) => m.feature.toLowerCase() === s.toLowerCase())).slice(0, 10).map((s) => (
              <button key={s} type="button" className="kc-sug km-press" onClick={() => addMust(s === 'Dock' ? 'Dock ≥ 60 ft' : s)}>+ {s}</button>
            ))}
          </div>

          {sec('Nice to have')}
          <ChipInput value={f.niceToHaves} onChange={(v) => set({ niceToHaves: v })} suggestions={FEATURE_SUGS} placeholder="Wine cellar, elevator…" />

          {sec('Deal-breakers')}
          <ChipInput value={f.dealBreakers} onChange={(v) => set({ dealBreakers: v })} suggestions={DEALBREAKER_SUGS} placeholder="HOA, flood zone, busy road…" />

          {sec('Timing & money')}
          <Seg value={f.timeline} onChange={(v) => set({ timeline: v === f.timeline ? '' : v })} options={TIMELINES} />
          <div style={{ marginTop: 10 }}><ChipSelect multi={false} options={FINANCING_OPTS} value={f.financing ? [f.financing] : []} onChange={(v) => set({ financing: v[0] || '' })} /></div>
          <MoneyInput style={{ marginTop: 10 }} label="Pre-approved for" value={f.preApprovalAmount} onChange={(v) => set({ preApprovalAmount: v })} />

          {sec('Notes')}
          <TextArea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Motivation, deadlines, what they loved and hated on tours…" />

          {waitlists && waitlists.length ? (
            <>
              {sec('Add to a waitlist?')}
              <select className="km-input" value={joinWl} onChange={(e) => setJoinWl(e.target.value)}>
                <option value="">Skip</option>
                {waitlists.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.waitingCount} waiting</option>)}
              </select>
            </>
          ) : null}

          <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 16, lineHeight: 1.4, display: 'flex', gap: 6 }}>
            <Icon name="shield" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            Criteria are property attributes and named places only — never people-based preferences (Fair Housing).
          </div>

          {editing && matches && matches.length ? (
            <>
              {sec('Live matches')}
              {matches.slice(0, 6).map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--kc-hair)' }}>
                  <PropertyPhoto src={m.photo} seed={m.id} height={44} radius={10} style={{ width: 58, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{m.title}</span>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--dim)' }}>{[m.price ? money(m.price) : null, m.summary].filter(Boolean).join(' · ')}</span>
                  </span>
                  {m.score ? <ScoreDial value={m.score} size={34} stroke={3} /> : null}
                  <button type="button" className="km-btn km-btn--sm" style={{ minHeight: 30, padding: '0 12px' }} onClick={() => { close(); nav.openThread({ clientId: client.id, draft: `${first}, this one fits your search — ${[m.title, m.neighborhood, m.price ? money(m.price) : null].filter(Boolean).join(' · ')}.${m.url ? ` ${m.url}` : ''} Want to see it?` }); }}>Send</button>
                </div>
              ))}
            </>
          ) : null}

          <button type="button" className="km-btn km-btn--block km-btn--lg" style={{ marginTop: 22 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save search' : f.bucket === 'dream' ? 'Add to wishlist' : 'Start searching'}</button>
          {editing ? <button type="button" className="km-btn km-btn--block" style={{ marginTop: 10, background: 'transparent', boxShadow: 'none', border: '1px solid rgba(255, 107, 94, 0.45)', color: 'var(--red)' }} onClick={remove}>Delete search</button> : null}
        </div>
      ); }}
    </Sheet>
  );
}
