// Add / edit a listing — My listing · Pocket / Coming soon · Whisper · New
// development. Paste a listing link or the remarks (or drop a whisper) → AI
// reads it (deterministic parser underneath, links are never fetched) → fields
// fill with AI / VERIFY badges by confidence → photos (cover first) → save →
// scored against the book immediately, top buyers shown.
//   nav.newListing({ lane })        new, preselected mode
//   nav.newListing({ id })          edit
//   nav.newListing({ ...fields })   prefilled (e.g. from a client's owned home)
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PillTabs from '../ui/PillTabs';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Button, Spinner, Switch, ScoreDial, Skeleton } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { uploadFiles } from '../../api/system';
import { createListing, updateListing, getListing, parseListingText } from '../../api/listings';
import ClientPicker from '../client/ClientPicker';
import { TYPE_OPTIONS, WATERFRONT_OPTIONS, VIEW_OPTIONS, AMENITY_OPTIONS, cap } from './listingKit';
import '../../styles/listings.css';
import '../../styles/matchmaker.css';

const MODES = [
  { id: 'mine', label: 'My listing' },
  { id: 'pocket', label: 'Pocket' },
  { id: 'whisper', label: 'Whisper' },
  { id: 'newdev', label: 'New dev' },
];
const STYLE_SUGGESTIONS = ['Contemporary', 'Modern', 'Mediterranean', 'Mediterranean Revival', 'Spanish Revival', 'British West Indies', 'Coastal', 'Traditional', 'Transitional', 'Mid-Century Modern', 'Art Deco', 'Tuscan', 'Georgian', 'Farmhouse'];
const SOURCES = [['agent', 'Agent'], ['developer', 'Developer'], ['owner', 'Owner'], ['broker_open', 'Broker open']];
const NUM_FIELDS = ['listPrice', 'priceGuide', 'beds', 'bathsTotal', 'livingAreaSqft', 'lotAcres', 'yearBuilt', 'hoaFee', 'dockLengthFt'];

const EMPTY = {
  street: '', unitNumber: '', buildingName: '', neighborhood: '', city: '', state: '', postalCode: '', developmentName: '',
  listPrice: '', priceGuide: '', beds: '', bathsTotal: '', livingAreaSqft: '', lotAcres: '', yearBuilt: '', hoaFee: '', dockLengthFt: '',
  propertyType: '', architecturalStyle: '', waterfront: '', views: [], amenities: [], status: '', eta: '', whisperSource: '',
  mlsNumber: '', description: '', listingUrl: '', hideAddress: null, hasFeatureSheet: false, ownerClientId: null, ownerName: '', coop: false,
};

function fromListing(l) {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (l[k] != null && k !== 'views' && k !== 'amenities') f[k] = typeof l[k] === 'number' ? String(l[k]) : l[k];
  f.bathsTotal = l.baths != null ? String(l.baths) : '';
  f.livingAreaSqft = l.sqft ? String(l.sqft) : '';
  f.lotAcres = l.lotAcres ? String(l.lotAcres) : '';
  f.priceGuide = l.priceGuideRaw ? String(l.priceGuideRaw) : '';
  f.views = l.views || [];
  f.amenities = l.amenities || [];
  f.waterfront = l.waterfront && l.waterfront !== 'none' ? l.waterfront : '';
  f.hideAddress = !!l.hideAddress;
  f.hasFeatureSheet = !!l.hasFeatureSheet;
  f.ownerName = l.owner ? l.owner.name : '';
  f.coop = l.lane === 'mls';
  return f;
}

const digits = (v) => String(v || '').replace(/[^\d.]/g, '');
const pretty = (v) => { const d = String(v || '').replace(/[^\d]/g, ''); return d ? Number(d).toLocaleString('en-US') : ''; };

function Conf({ c }) {
  if (c == null) return null;
  if (c >= 0.85) return <span className="kl-conf kl-conf--ai">AI</span>;
  if (c >= 0.5) return <span className="kl-conf kl-conf--verify">VERIFY</span>;
  return null;
}

// A div, not a <label>: several fields hold pill buttons, and a label would
// forward stray clicks to its first button.
function F({ label, conf, children, full, hint }) {
  return (
    <div className={`km-field ${full ? 'full' : ''}`} role="group" aria-label={label}>
      <span className="km-field-label kl-label-row">{label}<Conf c={conf} /></span>
      {children}
      {hint ? <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hint}</span> : null}
    </div>
  );
}

function Pills({ options, value, onChange, multi = false }) {
  const set = new Set(multi ? value : [value]);
  return (
    <div className="kl-fchips" style={{ paddingBottom: 0 }}>
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? cap(o) : o.label;
        const on = set.has(id);
        return (
          <button key={id} type="button" className={`kl-fchip ${on ? 'kl-fchip--on' : ''}`} onClick={() => {
            if (!multi) return onChange(on ? '' : id);
            const next = new Set(value);
            if (on) next.delete(id); else next.add(id);
            return onChange([...next]);
          }}>
            {on && multi ? <Icon name="check" size={13} stroke={2.4} /> : null}{label}
          </button>
        );
      })}
    </div>
  );
}

export default function AddListingSheet({ prefill = {}, onClose }) {
  const editId = prefill.id || null;
  const [loading, setLoading] = useState(!!editId);
  const [mode, setMode] = useState(['mine', 'pocket', 'whisper', 'newdev'].includes(prefill.lane) ? prefill.lane : prefill.lane === 'mls' ? 'mine' : 'mine');
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(prefill).filter(([k]) => k in EMPTY)), coop: prefill.lane === 'mls' }));
  const [conf, setConf] = useState({});
  const [paste, setPaste] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedNote, setParsedNote] = useState(null);
  const [photos, setPhotos] = useState(prefill.photoUrls || []);
  const [cover, setCover] = useState(prefill.heroPhoto || null);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [picker, setPicker] = useState(false);
  const [customAmenity, setCustomAmenity] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!editId) return;
    getListing(editId).then((r) => {
      const l = r.listing;
      setForm(fromListing(l));
      setMode(l.lane === 'mls' ? 'mine' : l.lane);
      setPhotos(l.photos || []);
      setCover(l.photos && l.photos[0] ? l.photos[0] : null);
      setConf(l.confidence || {});
      setLoading(false);
    }).catch((err) => { toast.error(err.message || "Couldn't load that listing"); onClose(); });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setConf((c) => (c[k] != null ? { ...c, [k]: undefined } : c)); };
  const isWhisper = mode === 'whisper';
  const hideAddress = form.hideAddress == null ? (mode === 'pocket' || isWhisper) : form.hideAddress;
  const placeable = !!(form.street || form.buildingName || form.neighborhood || form.city || form.developmentName);
  const canSave = placeable && !uploading && !saving;

  const read = async () => {
    const text = paste.trim();
    if (!text || parsing) return;
    setParsing(true);
    setParsedNote(null);
    try {
      const isUrl = /^https?:\/\/\S+$/i.test(text);
      const r = await parseListingText({ text: isUrl ? null : text, url: isUrl ? text : null, mode: isWhisper ? 'whisper' : 'listing' });
      const f = r.fields || {};
      const next = {};
      for (const [k, v] of Object.entries(f)) {
        if (k === 'lotSqft') { next.lotAcres = String(Math.round((v / 43560) * 100) / 100); continue; }
        if (k === 'views' || k === 'amenities') { next[k] = [...new Set([...(form[k] || []), ...v])]; continue; }
        if (k === 'status') { next.status = v; continue; }
        if (k in EMPTY) next[k] = typeof v === 'number' ? String(v) : v;
      }
      setForm((cur) => ({ ...cur, ...next, ...(isWhisper && !cur.description ? { description: text } : {}) }));
      const c = { ...(r.confidence || {}) };
      if (c.lotSqft != null) c.lotAcres = c.lotSqft;
      setConf((cur) => ({ ...cur, ...c }));
      const n = Object.keys(next).length;
      setParsedNote(n ? `${r.ai ? 'AI read' : 'Read'} ${n} field${n === 1 ? '' : 's'}${r.source === 'url' ? ' from the link (pages aren\'t opened — add the rest)' : ''}. Check anything marked VERIFY.` : "Couldn't pick out any details — fill them in below.");
      haptic('light');
    } catch (err) {
      setParsedNote(null);
      toast.error(err.message || "Couldn't read that");
    } finally {
      setParsing(false);
    }
  };

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setUploading((n) => n + files.length);
    try {
      const up = await uploadFiles(files);
      const urls = up.filter((u) => u.kind === 'image' || /^image\//.test(u.mimeType || '')).map((u) => u.url);
      setPhotos((p) => [...p, ...urls]);
      setCover((c) => c || urls[0] || null);
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading((n) => Math.max(0, n - files.length));
    }
  };

  const buildBody = () => {
    const body = {};
    for (const [k, v] of Object.entries(form)) {
      if (['ownerName', 'coop', 'hideAddress'].includes(k)) continue;
      if (NUM_FIELDS.includes(k)) { const d = digits(v); if (d !== '') body[k] = Number(d); else if (editId) body[k] = null; continue; }
      if (Array.isArray(v)) { body[k] = v; continue; }
      if (typeof v === 'boolean') { body[k] = v; continue; }
      if (v === null || v === undefined) continue;
      const t = String(v).trim();
      if (t) body[k] = t; else if (editId) body[k] = null;
    }
    if (isWhisper) delete body.listPrice; else delete body.priceGuide;
    if (!body.status) delete body.status;
    if (mode === 'pocket' && !body.status && !editId) body.status = 'coming_soon';
    body.hideAddress = hideAddress;
    if (form.waterfront === '') body.waterfront = editId ? 'none' : undefined;
    if (body.waterfront === undefined) delete body.waterfront;
    const ordered = cover ? [cover, ...photos.filter((p) => p !== cover)] : photos;
    body.photoUrls = ordered;
    body.heroPhoto = ordered[0] || null;
    if (!editId) body.lane = mode === 'mine' && form.coop ? 'mls' : mode;
    if (body.lane === 'mls') body.isOwnListing = false;
    if (form.ownerClientId) body.ownerClientId = form.ownerClientId;
    return body;
  };

  const save = async (close) => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = buildBody();
      if (editId) {
        await updateListing(editId, body);
        toast.success('Listing saved — rescoring buyers');
        close();
      } else {
        const r = await createListing(body);
        setResult(r);
        haptic('success');
      }
    } catch (err) {
      toast.error(err.message || "Couldn't save the listing");
    } finally {
      setSaving(false);
    }
  };

  const title = editId ? 'Edit listing' : result ? 'Added' : isWhisper ? 'New whisper' : 'New listing';
  const shownBuyers = result && result.buyers ? result.buyers.shown || [] : [];

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={title}
        left={result ? false : undefined}
        maxHeight="92%"
        footer={result ? ({ close }) => (
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="ghost" block onClick={close}>Done</Button>
            <Button block onClick={() => { const id = result.listing.id; close(); setTimeout(() => nav.openListing(id), 160); }}>View listing</Button>
          </div>
        ) : ({ close }) => (
          <Button block size="lg" loading={saving} disabled={!canSave} onClick={() => save(close)}>
            {uploading ? 'Uploading photos…' : editId ? 'Save changes' : isWhisper ? 'Save whisper & find buyers' : 'Add listing'}
          </Button>
        )}
      >
        {result ? (
          <div style={{ paddingTop: 6 }}>
            <div className="kl-success">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="checkCircle" size={22} color="var(--green)" stroke={2} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{result.listing.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>Scored against every buyer search in your book</div>
                </div>
              </div>
            </div>
            <div className="kl-eyebrow" style={{ margin: '18px 2px 10px', color: 'var(--bright)' }}>
              {shownBuyers.length ? `${shownBuyers.length} buyer${shownBuyers.length === 1 ? '' : 's'} at ${result.buyers.threshold}%+` : 'No buyer at 80%+ yet'}
            </div>
            {shownBuyers.length ? (
              <div className="km-list" style={{ padding: '0 14px' }}>
                {shownBuyers.slice(0, 5).map((b) => (
                  <div key={b.clientId} className="km-row">
                    <Avatar name={b.name} seed={b.clientId} src={b.avatarUrl} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }} className="km-truncate">{b.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--dim)' }} className="km-truncate">{b.summary}</div>
                    </div>
                    <ScoreDial value={b.score} size={40} stroke={3} fontSize={13} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.5, padding: '0 2px' }}>
                It's in Listings and the Matchmaker now — the moment a client's search fits, it shows up there.
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}><Skeleton h={40} r={20} /><Skeleton h={120} r={16} /><Skeleton h={46} /><Skeleton h={46} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
            {!editId ? <PillTabs size="sm" items={MODES} value={mode} onChange={(m) => { setMode(m); setForm((f) => ({ ...f, hideAddress: null })); }} /> : null}

            <div className="kl-paste">
              <div className="kl-paste-in">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span className="kl-dot" style={{ width: 7, height: 7, background: isWhisper ? 'var(--green)' : 'var(--blue)', boxShadow: `0 0 8px ${isWhisper ? 'var(--green)' : 'var(--glow)'}` }} />
                  <span className="kl-eyebrow" style={{ color: isWhisper ? 'var(--green)' : 'var(--bright)' }}>
                    {isWhisper ? 'Heard about one quietly coming to market?' : 'Paste a listing link or the remarks'}
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={isWhisper ? 'e.g. “5BR bayfront on Sunset Islands, modern, around $13M, quietly after the holidays”' : 'https://www.zillow.com/homedetails/… or paste the MLS remarks'}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--faint)', lineHeight: 1.4 }}>{parsedNote || (isWhisper ? 'Never quoted: the price guide, the owner, the address.' : 'Links aren\'t opened — the address and IDs are read from the link itself.')}</span>
                  <button type="button" className="mm-cta" style={{ height: 38, fontSize: 13.5 }} disabled={!paste.trim() || parsing} onClick={read}>
                    {parsing ? <Spinner size={15} color="currentColor" /> : <Icon name="sparkle" size={15} stroke={2} />} {parsing ? 'Reading…' : 'Read it'}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <div className="kl-label-row" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
                <span className="kl-eyebrow">Photos{photos.length ? ` · ${photos.length}` : ''}</span>
                {photos.length > 1 ? <span className="kl-eyebrow" style={{ fontSize: 8.5 }}>Tap to set the cover</span> : null}
              </div>
              <div className="kl-photo-strip">
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: 'none' }} />
                <button type="button" className="kl-photo-add" onClick={() => fileRef.current && fileRef.current.click()}>
                  {uploading ? <Spinner size={16} /> : <Icon name="camera" size={18} stroke={1.9} />}{uploading ? 'Uploading' : 'Add'}
                </button>
                {photos.map((p) => (
                  <div key={p} className={`kl-photo ${cover === p ? 'kl-photo--cover' : ''}`} onClick={() => setCover(p)} role="button" tabIndex={0}>
                    <PropertyPhoto src={p} seed={p} style={{ position: 'absolute', inset: 0, height: '100%' }} />
                    {cover === p ? <span className="kl-photo-tag">COVER</span> : null}
                    <button type="button" className="kl-photo-x" aria-label="Remove photo" onClick={(e) => { e.stopPropagation(); setPhotos((x) => x.filter((y) => y !== p)); if (cover === p) setCover(photos.find((y) => y !== p) || null); }}><Icon name="x" size={11} stroke={2.6} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="kl-form-grid">
              {mode === 'newdev' ? <F label="Development" conf={conf.developmentName} full><input className="km-input" value={form.developmentName} onChange={(e) => set('developmentName', e.target.value)} placeholder="The Residences at…" /></F> : null}
              <F label={isWhisper ? 'Address (private — never shared)' : 'Street address'} conf={conf.street} full>
                <input className="km-input km-selectable" value={form.street} onChange={(e) => set('street', e.target.value)} placeholder={isWhisper ? 'If you know it' : '1250 Old Cutler Rd'} autoComplete="off" />
              </F>
              <F label="Unit" conf={conf.unitNumber}><input className="km-input" value={form.unitNumber} onChange={(e) => set('unitNumber', e.target.value)} placeholder="PH-4" /></F>
              <F label="Building" conf={conf.buildingName}><input className="km-input" value={form.buildingName} onChange={(e) => set('buildingName', e.target.value)} placeholder="Oceana" /></F>
              <F label="Neighborhood" conf={conf.neighborhood}><input className="km-input" value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} placeholder="Bal Harbour" /></F>
              <F label="City" conf={conf.city}><input className="km-input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Miami Beach" /></F>
              {isWhisper ? (
                <F label="Price guide (never quoted)" conf={conf.priceGuide} full><input className="km-input" inputMode="numeric" value={pretty(form.priceGuide)} onChange={(e) => set('priceGuide', digits(e.target.value))} placeholder="$13,500,000" /></F>
              ) : (
                <F label="List price" conf={conf.listPrice} full><input className="km-input" inputMode="numeric" value={pretty(form.listPrice)} onChange={(e) => set('listPrice', digits(e.target.value))} placeholder="$9,450,000" /></F>
              )}
              <F label="Beds" conf={conf.beds}><input className="km-input" inputMode="numeric" value={form.beds} onChange={(e) => set('beds', digits(e.target.value))} placeholder="5" /></F>
              <F label="Baths" conf={conf.bathsTotal}><input className="km-input" inputMode="decimal" value={form.bathsTotal} onChange={(e) => set('bathsTotal', digits(e.target.value))} placeholder="6.5" /></F>
              <F label="Interior sq ft" conf={conf.livingAreaSqft}><input className="km-input" inputMode="numeric" value={pretty(form.livingAreaSqft)} onChange={(e) => set('livingAreaSqft', digits(e.target.value))} placeholder="7,850" /></F>
              <F label="Lot (acres)" conf={conf.lotAcres}><input className="km-input" inputMode="decimal" value={form.lotAcres} onChange={(e) => set('lotAcres', digits(e.target.value))} placeholder="0.42" /></F>
              <F label="Year built" conf={conf.yearBuilt}><input className="km-input" inputMode="numeric" value={form.yearBuilt} onChange={(e) => set('yearBuilt', digits(e.target.value).slice(0, 4))} placeholder="2019" /></F>
              <F label="HOA / month" conf={conf.hoaFee}><input className="km-input" inputMode="numeric" value={pretty(form.hoaFee)} onChange={(e) => set('hoaFee', digits(e.target.value))} placeholder="—" /></F>
            </div>

            <F label="Property type" conf={conf.propertyType}><Pills options={TYPE_OPTIONS} value={form.propertyType} onChange={(v) => set('propertyType', v)} /></F>
            <F label="Architectural style" conf={conf.architecturalStyle}>
              <input className="km-input" list="kl-style-list" value={form.architecturalStyle} onChange={(e) => set('architecturalStyle', e.target.value)} placeholder="Contemporary" />
              <datalist id="kl-style-list">{STYLE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            </F>
            <F label="Waterfront" conf={conf.waterfront}><Pills options={WATERFRONT_OPTIONS} value={form.waterfront} onChange={(v) => set('waterfront', v)} /></F>
            {form.waterfront ? <F label="Dock length (ft)" conf={conf.dockLengthFt}><input className="km-input" inputMode="numeric" value={form.dockLengthFt} onChange={(e) => set('dockLengthFt', digits(e.target.value))} placeholder="80" /></F> : null}
            <F label="Views" conf={conf.views}><Pills multi options={VIEW_OPTIONS} value={form.views} onChange={(v) => set('views', v)} /></F>
            <F label="Amenities" conf={conf.amenities}>
              <Pills multi options={[...new Set([...AMENITY_OPTIONS, ...form.amenities])]} value={form.amenities} onChange={(v) => set('amenities', v)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input className="km-input" value={customAmenity} onChange={(e) => setCustomAmenity(e.target.value)} placeholder="Add an amenity…" onKeyDown={(e) => { if (e.key === 'Enter' && customAmenity.trim()) { e.preventDefault(); set('amenities', [...new Set([...form.amenities, customAmenity.trim()])]); setCustomAmenity(''); } }} />
                <Button variant="ghost" size="sm" disabled={!customAmenity.trim()} onClick={() => { set('amenities', [...new Set([...form.amenities, customAmenity.trim()])]); setCustomAmenity(''); }}>Add</Button>
              </div>
            </F>
            <div className="km-list" style={{ padding: '0 14px' }}>
              <div className="km-row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15 }}>Verified from a feature sheet</div>
                  <div style={{ fontSize: 12, color: 'var(--faint)' }}>Amenities count as confirmed for must-haves</div>
                </div>
                <Switch checked={form.hasFeatureSheet} onChange={(v) => set('hasFeatureSheet', v)} label="Verified from a feature sheet" />
              </div>
              {!isWhisper ? (
                <div className="km-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15 }}>Show exact address on the client page</div>
                    <div style={{ fontSize: 12, color: 'var(--faint)' }}>Off: the showcase reads “Private Residence”</div>
                  </div>
                  <Switch checked={!hideAddress} onChange={(v) => setForm((f) => ({ ...f, hideAddress: !v }))} label="Show exact address" />
                </div>
              ) : null}
              {mode === 'mine' && !editId ? (
                <div className="km-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15 }}>Another agent's listing</div>
                    <div style={{ fontSize: 12, color: 'var(--faint)' }}>Files it under MLS Feed instead of My Listings</div>
                  </div>
                  <Switch checked={!!form.coop} onChange={(v) => setForm((f) => ({ ...f, coop: v }))} label="Another agent's listing" />
                </div>
              ) : null}
              <button type="button" className="km-row km-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => setPicker(true)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15 }}>{isWhisper ? 'Owner (if they\'re your client)' : 'Seller · your client'}</div>
                  <div style={{ fontSize: 12, color: 'var(--faint)' }}>{form.ownerName || 'Never matched to their own home'}</div>
                </div>
                {form.ownerClientId ? <button type="button" className="kl-search-clear" onClick={(e) => { e.stopPropagation(); setForm((f) => ({ ...f, ownerClientId: null, ownerName: '' })); }} aria-label="Clear owner"><Icon name="x" size={11} stroke={2.6} /></button> : <Icon name="chevronRight" size={16} color="var(--faint)" />}
              </button>
            </div>

            {isWhisper ? (
              <>
                <F label="When (as you heard it)" conf={conf.eta}><input className="km-input" value={form.eta} onChange={(e) => set('eta', e.target.value)} placeholder="after the holidays" /></F>
                <F label="Heard from" conf={conf.whisperSource}><Pills options={SOURCES.map(([value, label]) => ({ value, label }))} value={form.whisperSource} onChange={(v) => set('whisperSource', v)} /></F>
              </>
            ) : (
              <>
                {mode === 'pocket' ? <F label="Status"><Pills options={[{ value: 'coming_soon', label: 'Coming soon' }, { value: 'active', label: 'Pocket · active' }]} value={form.status || 'coming_soon'} onChange={(v) => set('status', v || 'coming_soon')} /></F> : null}
                <div className="kl-form-grid">
                  <F label="MLS #" conf={conf.mlsNumber}><input className="km-input" value={form.mlsNumber} onChange={(e) => set('mlsNumber', e.target.value.toUpperCase())} placeholder="A11500123" /></F>
                  <F label="Listing link" conf={conf.listingUrl}><input className="km-input" inputMode="url" value={form.listingUrl} onChange={(e) => set('listingUrl', e.target.value)} placeholder="https://" /></F>
                </div>
              </>
            )}
            <F label={isWhisper ? 'What you heard' : 'Description'} conf={conf.description}>
              <textarea className="km-input km-selectable" rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={isWhisper ? 'The whisper, in your words' : 'Remarks for the client page'} />
            </F>
            {!placeable ? <div style={{ fontSize: 12.5, color: 'var(--faint)', textAlign: 'center' }}>Add a street, building, neighborhood or city so it can be matched.</div> : null}
          </div>
        )}
      </Sheet>
      <ClientPicker open={picker} onClose={() => setPicker(false)} kind="client" title={isWhisper ? 'Who owns it?' : 'Who is selling?'}
        onPick={(c) => { setForm((f) => ({ ...f, ownerClientId: c.id, ownerName: c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') })); setPicker(false); }} />
    </>
  );
}
