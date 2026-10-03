// AddPropertySheet — "Add to {First}'s portfolio" (RevMatch AddCarSheet +
// EntryMethodChooser, re-geared). Bucket (Owned · Rents · Sold · Watching),
// photos first, then three ways in:
//   • Paste a listing link — Zillow / Redfin / MLS / Compass / brokerage URL,
//     parsed from the URL itself (we never fetch the site) + AI cleanup
//   • Just describe it — live AI parse into firm (blue) / soft (amber) chips
//   • Fill it in by hand — the structured form
// Every save records its capture source (listing_link · described · manual).
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { parseCapture, createProperty } from '../../api/portfolio';
import { Seg, displayName } from '../client/clientKit';
import { PhotoStrip } from './Photos';
import PropertyForm from './PropertyForm';
import { REL_OPTS } from './portfolioKit';

function Method({ icon, ai, title, sub, on, onClick }) {
  return (
    <button type="button" className={`kc-method km-press ${on ? 'kc-method--on' : ''}`} onClick={onClick} aria-expanded={on}>
      <span className={`kc-method-ico ${ai ? 'kc-method-ico--ai' : ''}`}><Icon name={icon} size={17} stroke={2} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{sub}</span>
      </span>
      <Icon name="chevronRight" size={15} color="var(--faint)" style={{ transform: on ? 'rotate(90deg)' : 'none', transition: 'transform .25s var(--km-ease)' }} />
    </button>
  );
}

function Preview({ result, onAdd, onEdit, saving, onWishlist }) {
  if (!result) return null;
  if (result.error) return <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>{result.error}</div>;
  if (result.kind === 'search') {
    return (
      <div className="kc-dupe" style={{ marginTop: 12 }}>
        <Icon name="sparkle" size={16} color="var(--amber)" />
        <span style={{ flex: 1 }}>That sounds like something they <b>want</b>, not something they own.</span>
        <button type="button" className="kc-link" onClick={onWishlist}>Add to wishlist</button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 'var(--r-card)', background: 'var(--glass-fill)', border: 'var(--hairline) solid var(--hl-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="kc-tag kc-tag--mono kc-tag--violet" style={{ height: 19 }}>{result.source === 'ai' ? 'AI' : 'PARSED'}</span>
        <span className="kc-eyebrow" style={{ color: 'var(--dim)' }}>{result.portal ? `From ${result.portal}` : 'From your words'}</span>
      </div>
      {result.chips && result.chips.length ? (
        <div className="kc-chips-preview">
          {result.chips.map((c) => (
            <span key={c.key} className={`kc-pchip kc-pchip--${c.tone === 'firm' ? 'firm' : c.tone === 'danger' ? 'danger' : 'soft'}`}>
              {c.tone === 'firm' ? <Icon name="check" size={11} color="var(--bright)" stroke={2.6} /> : null}{c.label}
            </span>
          ))}
        </div>
      ) : <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 8 }}>Couldn’t read much from that — fill in the rest by hand.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="km-btn km-btn--sm" style={{ flex: 1.3 }} onClick={onAdd} disabled={saving}>{saving ? 'Adding…' : 'Looks right — add it'}</button>
        <button type="button" className="km-btn km-btn--sm km-btn--ghost" style={{ flex: 1 }} onClick={onEdit}>Edit details</button>
      </div>
    </div>
  );
}

export default function AddPropertySheet({ open, client, relationship = 'owns', onClose, onSaved, onWishlist }) {
  const [rel, setRel] = useState(relationship);
  const [method, setMethod] = useState('describe');
  const [photos, setPhotos] = useState([]);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState(null);
  const seq = useRef(0);
  const closeRef = useRef(null);

  useEffect(() => {
    if (open) { setRel(relationship || 'owns'); setMethod('describe'); setPhotos([]); setUrl(''); setText(''); setResult(null); setManual(null); }
  }, [open, relationship]);

  const run = async (payload) => {
    const my = ++seq.current;
    setParsing(true);
    try {
      const r = await parseCapture(payload);
      if (my === seq.current) setResult(r);
    } catch (e) {
      if (my === seq.current) setResult({ error: e.message || 'Couldn’t read that.' });
    }
    if (my === seq.current) setParsing(false);
  };

  // live parse for "describe it" (≥12 chars, 650ms debounce)
  useEffect(() => {
    if (method !== 'describe') return undefined;
    const t = text.trim();
    if (t.length < 12) { setResult(null); return undefined; }
    const timer = setTimeout(() => run({ text: t, target: 'auto' }), 650);
    return () => clearTimeout(timer);
  }, [text, method]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldsFor = () => {
    const f = { ...(result?.fields || {}) };
    const relationship = rel === 'owns' && f.relationship && f.relationship !== 'owns' && method === 'describe' ? f.relationship : rel;
    const merged = { ...f, relationship, photos: [...photos, ...(f.photos || [])] };
    merged.source = method === 'link' ? 'listing_link' : 'described';
    if (method === 'describe' && !merged.notes) merged.notes = text.trim();
    return merged;
  };

  const addParsed = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await createProperty({ ...fieldsFor(), clientId: client.id });
      toast.success('Added to portfolio');
      onSaved?.(r.property);
      closeRef.current?.();
    } catch (e) {
      toast.error(e.message || 'Couldn’t add — try editing the details');
    }
    setSaving(false);
  };

  const first = client.firstName || displayName(client);

  return (
    <>
      <Sheet open={open && !manual} onClose={onClose} title="Add a property" subtitle={`${first}’s portfolio`} zIndex={440} maxHeight="90%">
        {({ close }) => { closeRef.current = close; return (
          <div style={{ paddingBottom: 10 }}>
            <Seg value={rel} onChange={setRel} options={REL_OPTS} />
            <button type="button" className="kc-link" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5 }} onClick={() => onWishlist?.(text)}>
              <Icon name="sparkle" size={13} /> Something they want? Add a wishlist instead
            </button>

            <div style={{ marginTop: 14 }}>
              <PhotoStrip photos={photos} onChange={setPhotos} label="Photos" hint="Camera or roll — they save with the property whichever way you add it. First one is the cover." />
            </div>

            <div style={{ marginTop: 10 }}>
              <Method icon="link" title="Paste a listing link" sub="Zillow, Redfin, MLS, Compass, Sotheby’s — exact details" on={method === 'link'} onClick={() => { setMethod(method === 'link' ? null : 'link'); setResult(null); }} />
              {method === 'link' ? (
                <div style={{ padding: '10px 2px 4px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="km-input" type="url" inputMode="url" autoCapitalize="off" placeholder="https://www.zillow.com/homedetails/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) run({ url: url.trim(), target: 'property' }); }} style={{ flex: 1 }} />
                    <button type="button" className="km-btn" style={{ minHeight: 46 }} disabled={!url.trim() || parsing} onClick={() => run({ url: url.trim(), target: 'property' })}>
                      {parsing ? <Spinner size={16} /> : 'Read'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>We read the link itself — nothing is scraped. Every parsed field lands for you to confirm.</div>
                  <Preview result={result} saving={saving} onAdd={addParsed} onEdit={() => setManual(fieldsFor())} onWishlist={() => onWishlist?.(url)} />
                </div>
              ) : null}

              <Method icon="sparkle" ai title="Just describe it" sub="On the fly — AI turns your words into the record" on={method === 'describe'} onClick={() => { setMethod(method === 'describe' ? null : 'describe'); setResult(null); }} />
              {method === 'describe' ? (
                <div style={{ padding: '10px 2px 4px' }}>
                  <textarea
                    className="km-input"
                    rows={4}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="“Owns 4 Tahiti Beach Island Rd — bought Mar 2019 for 4.2, worth ~12.4 now. 7/1 ARM at 2.875% from Jun 2021 with First Republic, owes 3.1. Bay-front, 80 ft dock, thinking of selling.”"
                    style={{ minHeight: 120 }}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {parsing ? <><Spinner size={11} /> Reading…</> : 'Prices: “12.4” = $12.4M · “850” = $850K'}
                  </div>
                  <Preview result={result} saving={saving} onAdd={addParsed} onEdit={() => setManual(fieldsFor())} onWishlist={() => onWishlist?.(text)} />
                </div>
              ) : null}

              <Method icon="edit" title="Fill it in by hand" sub="Address, specs, value, mortgage, lease — every field" on={false} onClick={() => setManual({ relationship: rel, photos, source: 'manual' })} />
            </div>
          </div>
        ); }}
      </Sheet>
      <PropertyForm
        open={!!manual}
        client={client}
        prefill={manual || undefined}
        relationship={rel}
        onClose={() => { setManual(null); onClose?.(); }}
        onSaved={(p) => { onSaved?.(p); }}
      />
    </>
  );
}
