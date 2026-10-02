// Listing detail — photography-forward push panel: hero carousel + lightbox,
// price + history, specs, IDs, verified amenities, water, views, description,
// map card, listing agent, and the scored "Interested buyers" (why-this-rating,
// must-haves, Draft text in the agent's voice). Actions: share the private
// showcase link, edit, change status (price-drop bookkeeping server-side),
// add to a deal, schedule a showing.
import { useCallback, useEffect, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import Sheet from '../ui/Sheet';
import GlassButton from '../ui/GlassButton';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { EmptyState, Button, Skeleton, TextInput, Spinner } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { money, moneyCompact, num, formatDate } from '../../lib/format';
import { getListing, shareListing, setListingStatus, deleteListing, showcaseUrl } from '../../api/listings';
import { getListingBuyers } from '../../api/matchmaker';
import { haptic } from '../../lib/native';
import {
  PhotoCarousel, Lightbox, SourceLine, STATUS_OPTIONS, listedLine, cap, acresLabel, useListingsLive, WhisperConfidence,
} from './listingKit';
import { BuyersList, dismissMatch, draftModeFor } from '../matchmaker/MatchUI';
import '../../styles/listings.css';
import '../../styles/matchmaker.css';

function Spec({ k, v, small, sub }) {
  if (v == null || v === '' || v === false) return null;
  return (
    <div className="kl-spec">
      <div className="kl-eyebrow">{k}</div>
      <div className="v">{v}{small ? <small> {small}</small> : null}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function hoaLine(l) {
  if (!l.hoaFee) return null;
  const f = String(l.hoaFrequency || 'monthly').toLowerCase();
  const per = /year|annual/.test(f) ? '/yr' : /quarter/.test(f) ? '/qtr' : '/mo';
  return `${moneyCompact(l.hoaFee)}${per}`;
}

async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
    haptic('light');
  } catch {
    toast.error("Couldn't copy — long-press to select it instead");
  }
}

// amenity state: verified (flag true / authoritative list), unverified, confirmed absent
function amenityState(l, a) {
  const flags = l.amenityFlags || {};
  const key = String(a).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  const hit = Object.keys(flags).find((k) => key.includes(k) || k.includes(key));
  if (hit && flags[hit] === true) return 'ok';
  if (hit && flags[hit] === false) return 'no';
  if (l.lane === 'whisper' && !l.hasFeatureSheet) return 'verify';
  return 'ok';
}

function DetailTop({ l, scrolled, onShare, onMore }) {
  const { requestClose } = usePanel();
  return (
    <div className="kl-detail-top">
      <div className="km-scroll-edge kl-detail-top-bg" style={{ opacity: scrolled ? 1 : 0 }} />
      <GlassButton icon="chevronLeft" onClick={requestClose} label="Back" className={scrolled ? '' : 'km-lg--clear km-lg--dim'} />
      <div className="kl-detail-top-title km-truncate" style={{ opacity: scrolled ? 1 : 0 }}>{l ? l.title : ''}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {l && l.lane !== 'whisper' ? <GlassButton icon="share" onClick={onShare} label="Share private link" className={scrolled ? '' : 'km-lg--clear km-lg--dim'} /> : null}
        {l ? <GlassButton icon="more" onClick={onMore} label="More" className={scrolled ? '' : 'km-lg--clear km-lg--dim'} /> : null}
      </div>
    </div>
  );
}

function StatusSheet({ open, onClose, l, onDone }) {
  const [status, setStatus] = useState(l ? l.status : 'active');
  const [price, setPrice] = useState('');
  const [closePrice, setClosePrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && l) { setStatus(l.status); setPrice(l.listPrice ? String(l.listPrice) : ''); setClosePrice(''); }
  }
  if (!l) return null;
  const parsedPrice = Number(String(price).replace(/[^\d]/g, '')) || null;
  const changedPrice = parsedPrice && parsedPrice !== l.listPrice;
  const save = async (close) => {
    setBusy(true);
    try {
      const body = { status };
      if (changedPrice) body.listPrice = parsedPrice;
      if (status === 'sold' && closePrice) body.closePrice = Number(String(closePrice).replace(/[^\d]/g, ''));
      const r = await setListingStatus(l.id, body);
      onDone(r.listing);
      if (changedPrice && parsedPrice < (l.listPrice || 0)) toast.success(`Price reduced ${moneyCompact((l.listPrice || 0) - parsedPrice)} — rescoring buyers`);
      else toast.success('Listing updated');
      close();
    } catch (err) {
      toast.error(err.message || "Couldn't update the listing");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Status & price" footer={({ close }) => (
      <Button block size="lg" loading={busy} onClick={() => save(close)} disabled={status === l.status && !changedPrice}>Save changes</Button>
    )}>
      <div className="kl-fchips" style={{ paddingTop: 4 }}>
        {STATUS_OPTIONS.map((s) => (
          <button key={s.id} type="button" className={`kl-fchip ${status === s.id ? 'kl-fchip--on' : ''}`} onClick={() => setStatus(s.id)}>{s.label}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
        <TextInput label="List price" inputMode="numeric" prefix="$" value={price ? Number(String(price).replace(/[^\d]/g, '') || 0).toLocaleString('en-US') : ''} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
          hint={changedPrice && parsedPrice < (l.listPrice || 0) ? `A ${moneyCompact(l.listPrice - parsedPrice)} reduction — buyers it now fits will surface in Price Drops.` : 'Lower it to log a price reduction.'} />
        {status === 'sold' ? <TextInput label="Sold price" inputMode="numeric" prefix="$" value={closePrice ? Number(closePrice).toLocaleString('en-US') : ''} onChange={(e) => setClosePrice(e.target.value.replace(/[^\d]/g, ''))} /> : null}
      </div>
    </Sheet>
  );
}

function MoreSheet({ open, onClose, l, onStatus, onDelete }) {
  if (!l) return null;
  const go = (fn, close) => { close(); setTimeout(fn, 140); };
  return (
    <Sheet open={open} onClose={onClose} title={l.title} left={false}>
      {({ close }) => (
        <div className="km-list" style={{ padding: 0 }}>
          {[
            ['edit', 'Edit listing', () => nav.newListing({ id: l.id })],
            ['flag', 'Change status or price', onStatus],
            ['calendarCheck', 'Schedule a showing', () => nav.newAppointment({ listingId: l.id, type: 'showing' })],
            ['handshake', "Add to a client's deal", () => nav.newDeal({ listingId: l.id, side: 'buyer', price: l.listPrice || undefined })],
            ...(l.listingUrl ? [['globe', 'Open listing page', () => window.open(l.listingUrl, '_blank', 'noopener')]] : []),
          ].map(([icon, label, fn]) => (
            <button key={label} type="button" className="km-row km-press" style={{ width: '100%', padding: '14px 14px', textAlign: 'left' }} onClick={() => go(fn, close)}>
              <Icon name={icon} size={19} color="var(--bright)" stroke={1.9} />
              <span style={{ flex: 1, fontSize: 16 }}>{label}</span>
              <Icon name="chevronRight" size={16} color="var(--faint)" />
            </button>
          ))}
          <button type="button" className="km-row km-press" style={{ width: '100%', padding: '14px 14px', textAlign: 'left', color: 'var(--red)' }} onClick={() => go(onDelete, close)}>
            <Icon name="trash" size={19} stroke={1.9} />
            <span style={{ flex: 1, fontSize: 16 }}>Remove listing</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

export default function ListingDetail({ id, onClose }) {
  const [l, setL] = useState(null);
  const [error, setError] = useState(null);
  const [buyers, setBuyers] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (!id) return;
    getListing(id).then((r) => { if (alive.current) { setL(r.listing); setError(null); } })
      .catch((err) => { if (alive.current) setError(err.status === 404 ? 'This listing was removed.' : (err.message || 'Could not load')); });
    getListingBuyers(id).then((r) => { if (alive.current) setBuyers(r); }).catch(() => { if (alive.current) setBuyers((b) => b || { shown: [], hiddenCount: 0, threshold: 80, error: true }); });
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useListingsLive(load);

  const onScroll = (e) => setScrolled(e.currentTarget.scrollTop > 220);

  const share = async () => {
    if (!l || sharing) return;
    setSharing(true);
    try {
      const r = l.publicSlug ? { slug: l.publicSlug } : await shareListing(l.id);
      const url = showcaseUrl(r.slug);
      setL((x) => ({ ...x, publicSlug: r.slug }));
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ title: l.title, url }); } catch { /* cancelled */ }
      } else {
        await copy(url, 'Private link copied');
      }
    } catch (err) {
      toast.error(err.message || "Couldn't create the link");
    } finally {
      setSharing(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Remove this listing?', message: 'Its matches and share link go with it.', confirmLabel: 'Remove listing', destructive: true });
    if (!ok) return;
    try {
      await deleteListing(l.id);
      toast('Listing removed');
      onClose();
    } catch (err) { toast.error(err.message || "Couldn't remove it"); }
  };

  const onDismiss = (b) => {
    const before = buyers;
    dismissMatch({ clientId: b.clientId, listingId: l.id, matchId: b.matchId, score: b.score, name: b.name }, {
      onRemove: () => setBuyers((x) => ({ ...x, shown: x.shown.filter((y) => y.clientId !== b.clientId) })),
      onRestore: () => setBuyers(before),
    });
  };

  if (error && !l) {
    return (
      <PushPanel onClose={onClose} title="Listing">
        <EmptyState icon="estate" title={error} sub="It may have been removed or retired from the feed." action={<Button variant="ghost" size="sm" onClick={load}>Try again</Button>} />
      </PushPanel>
    );
  }

  const photos = l ? l.photos || [] : [];
  const subject = l ? { listingId: l.id, lane: l.lane, kind: l.lane === 'whisper' ? 'whisper' : 'listing', dropAmount: l.dropAmount, priceDroppedAt: l.priceDroppedAt } : null;
  const drop = l && l.dropAmount ? l : null;
  const desc = l && l.description ? String(l.description) : '';

  return (
    <PushPanel onClose={onClose} header={<DetailTop l={l} scrolled={scrolled} onShare={share} onMore={() => setSheet('more')} />} scroll={false}>
      <div className="km-scroll" style={{ position: 'absolute', inset: 0, paddingBottom: 'calc(var(--tabbar-clearance) + var(--safe-bottom) + 24px)' }} onScroll={onScroll}>
        <div className="kl-hero">
          {l ? (
            <PhotoCarousel photos={photos} seed={l.id} label={l.neighborhood || l.city} ratio="4 / 3.4" onTap={(i) => setLightbox(i)} arrows countPos="bottom">
              <div className="kl-hero-shade" />
            </PhotoCarousel>
          ) : <div className="km-skel" style={{ aspectRatio: '4 / 3.4', borderRadius: 0 }} />}
        </div>
        <div className="kl-detail-body" style={{ maxWidth: 760, margin: '0 auto' }}>
          {!l ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton w="35%" h={10} /><Skeleton w="80%" h={22} /><Skeleton w="50%" h={13} /><Skeleton w="40%" h={28} />
            </div>
          ) : (
            <>
              <SourceLine l={l} right={l.statusLabel && l.status !== 'active' ? <span className="kl-badge kl-badge--amber">{l.statusLabel}</span> : null} />
              <div className="kl-detail-title km-selectable">
                {l.hideAddress ? <Icon name="lock" size={17} color="var(--faint)" stroke={2} style={{ marginRight: 6, verticalAlign: -1 }} /> : null}
                {l.title}
              </div>
              <div className="kl-detail-sub">
                <span>{l.subtitle}</span>
                {l.hideAddress && l.street ? <span className="km-selectable" style={{ color: 'var(--faint)' }}>· {l.street}{l.unitNumber ? ` #${l.unitNumber}` : ''} (private)</span> : null}
              </div>
              <div className="kl-price-row">
                <span className="kl-price-big">{l.listPrice ? money(l.listPrice) : l.lane === 'whisper' && l.priceGuide ? `~${moneyCompact(l.priceGuide)}` : 'Price on request'}</span>
                {drop ? <span className="kl-price-was">{money(drop.previousPrice)}</span> : null}
                {drop ? <span className="kl-price-drop">↓ {moneyCompact(drop.dropAmount)} · −{drop.dropPct}%</span> : null}
              </div>
              <div className="kl-eyebrow" style={{ marginTop: 6 }}>
                {l.lane === 'whisper' ? `Price guide · never quoted${l.eta ? ` · ${l.eta}` : ''}` : listedLine(l)}
                {l.cumulativeDrop && (!drop || l.cumulativeDrop !== drop.dropAmount) ? ` · −${moneyCompact(l.cumulativeDrop)} since list` : ''}
              </div>
              {(l.priceEvents || []).filter((e) => e.fromPrice > 0).length ? (
                <div className="kl-history">
                  {(l.priceEvents || []).filter((e) => e.fromPrice > 0).slice(0, 4).map((e) => {
                    const pct = Math.round(((e.toPrice - e.fromPrice) / e.fromPrice) * 1000) / 10;
                    return (
                      <div key={e.id || e.changedAt} className="kl-history-row">
                        <span className="d">{formatDate(e.changedAt, { month: 'short', day: 'numeric' })}</span>
                        <span className="p">{moneyCompact(e.fromPrice)} → <b>{moneyCompact(e.toPrice)}</b></span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: pct < 0 ? '#34C759' : 'var(--amber)' }}>{pct > 0 ? '+' : ''}{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="kl-actions">
                {l.lane !== 'whisper' ? (
                  <button type="button" className="kl-action" onClick={share} disabled={sharing}>{sharing ? <Spinner size={19} /> : <Icon name="link" size={19} stroke={1.9} />}Share link</button>
                ) : (
                  <button type="button" className="kl-action" onClick={() => nav.newListing({ id: l.id })}><Icon name="edit" size={19} stroke={1.9} />Verify</button>
                )}
                <button type="button" className="kl-action" onClick={() => nav.newAppointment({ listingId: l.id, type: 'showing' })}><Icon name="calendarCheck" size={19} stroke={1.9} />Showing</button>
                <button type="button" className="kl-action" onClick={() => nav.newDeal({ listingId: l.id, side: 'buyer', price: l.listPrice || undefined })}><Icon name="handshake" size={19} stroke={1.9} />Add deal</button>
                <button type="button" className="kl-action" onClick={() => setSheet('status')}><Icon name="flag" size={19} stroke={1.9} />Status</button>
              </div>

              {l.lane === 'whisper' ? <WhisperConfidence confidence={l.confidence} style={{ marginTop: 14 }} /> : null}

              {l.publicSlug && l.lane !== 'whisper' ? (
                <div className="kl-share-card" style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name={l.hideAddress ? 'lock' : 'globe'} size={14} color="#B98AFF" stroke={2} />
                    <span className="kl-eyebrow" style={{ color: '#B98AFF' }}>Private showcase{l.hideAddress ? ' · address hidden' : ''}</span>
                    <button type="button" style={{ marginLeft: 'auto', color: 'var(--bright)', fontSize: 13, fontWeight: 600 }} onClick={() => copy(showcaseUrl(l.publicSlug), 'Private link copied')}>Copy</button>
                  </div>
                  <div className="kl-share-url km-selectable">{showcaseUrl(l.publicSlug)}</div>
                </div>
              ) : null}

              <div className="kl-buyers-head">
                <span className="mm-eyebrow mm-eyebrow--blue" style={{ fontSize: 10.5 }}>Interested buyers</span>
                <span className="mm-eyebrow">· ≥{buyers ? buyers.threshold : 80}%</span>
                <span style={{ flex: 1 }} />
                {buyers && buyers.shown.length ? <span className="mm-eyebrow">{buyers.shown.length} shown</span> : null}
              </div>
              {!buyers ? (
                <div className="mm-stack">{[0, 1].map((i) => <div key={i} className="km-skel" style={{ height: 66, borderRadius: 14 }} />)}</div>
              ) : buyers.error ? (
                <div className="kl-error" style={{ marginTop: 0 }}>Couldn't score buyers right now.<button type="button" onClick={load}>Retry</button></div>
              ) : (
                <BuyersList
                  buyers={buyers.shown}
                  subject={subject}
                  onDismiss={onDismiss}
                  threshold={buyers.threshold}
                  fallback={buyers.fallback}
                  hiddenCount={buyers.hiddenCount}
                  hidden={buyers.hidden || []}
                  closest={buyers.closest || []}
                  emptyTitle={l.lane === 'whisper' ? 'Nobody fits this whisper yet' : 'No buyers at 80%+ yet'}
                  emptySub={l.lane === 'whisper' ? 'Add what you know (beds, water, neighborhood) or verify amenities to sharpen it.' : undefined}
                />
              )}
              {buyers && buyers.shown.length && draftModeFor(subject) === 'price_drop' ? (
                <div className="kl-eyebrow" style={{ marginTop: 10, textAlign: 'center' }}>Price-drop texts quote only the was → now prices</div>
              ) : null}

              <div className="km-eyebrow" style={{ margin: '28px 2px 10px' }}>The home</div>
              <div className="kl-specs">
                <Spec k="Beds" v={l.beds} />
                <Spec k="Baths" v={l.baths} sub={l.bathsHalf ? `${l.bathsFull != null ? `${l.bathsFull} full · ` : ''}${l.bathsHalf} half` : null} />
                <Spec k="Interior" v={l.sqft ? num(l.sqft) : null} small="sf" />
                <Spec k="Lot" v={acresLabel(l)} />
                <Spec k="Built" v={l.yearBuilt} small={l.yearRenovated ? `reno ${l.yearRenovated}` : null} />
                <Spec k="Stories" v={l.stories} />
                <Spec k="Garage" v={l.garageSpaces ? `${l.garageSpaces}` : null} small={l.garageSpaces ? 'cars' : null} />
                <Spec k="HOA" v={hoaLine(l)} />
                <Spec k="Taxes" v={l.taxAnnual ? moneyCompact(l.taxAnnual) : null} small={l.taxAnnual ? '/yr' : null} />
                <Spec k="$ / sq ft" v={l.pricePerSqft ? `$${num(l.pricePerSqft)}` : null} />
                <Spec k="On market" v={l.dom != null && l.lane !== 'whisper' ? l.dom : null} small="days" />
                <Spec k="Type" v={l.typeLabel} />
              </div>
              {(l.mlsNumber || l.parcelNumber) ? (
                <div className="kl-ids">
                  {l.mlsNumber ? (
                    <button type="button" className="kl-id" onClick={() => copy(l.mlsNumber, 'MLS # copied')}><span className="k">MLS #</span><span className="val km-selectable">{l.mlsNumber}</span><Icon name="copy" size={13} color="var(--faint)" /></button>
                  ) : null}
                  {l.parcelNumber ? (
                    <button type="button" className="kl-id" onClick={() => copy(l.parcelNumber, 'APN copied')}><span className="k">APN</span><span className="val km-selectable">{l.parcelNumber}</span><Icon name="copy" size={13} color="var(--faint)" /></button>
                  ) : null}
                </div>
              ) : null}

              {(l.waterfrontLabel || (l.views || []).length) ? (
                <>
                  <div className="km-eyebrow" style={{ margin: '24px 2px 10px' }}>Water & views</div>
                  <div className="kl-amen-grid">
                    {l.waterfrontLabel ? <span className="kl-amen kl-amen--ok"><Icon name="waves" size={14} color="var(--bright)" stroke={2} />{l.waterfrontLabel}</span> : null}
                    {l.waterFrontageFt ? <span className="kl-amen"><Icon name="ruler" size={14} stroke={2} />{l.waterFrontageFt} ft frontage</span> : null}
                    {l.dockLengthFt ? <span className="kl-amen"><Icon name="anchor" size={14} stroke={2} />{l.dockLengthFt} ft dock</span> : null}
                    {(l.views || []).map((v) => <span key={v} className="kl-amen"><Icon name="view" size={14} stroke={2} />{cap(v)} view</span>)}
                  </div>
                </>
              ) : null}

              {(l.amenities || []).length ? (
                <>
                  <div className="km-eyebrow" style={{ margin: '24px 2px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Amenities
                    {l.hasFeatureSheet ? <span className="kl-badge kl-badge--green">Feature sheet ✓</span> : l.amenities.some((a) => amenityState(l, a) === 'verify') ? <span className="kl-badge kl-badge--amber">Dashed = verify</span> : null}
                  </div>
                  <div className="kl-amen-grid">
                    {l.amenities.map((a) => {
                      const st = amenityState(l, a);
                      return (
                        <span key={a} className={`kl-amen kl-amen--${st}`}>
                          {st === 'ok' ? <Icon name="check" size={13} color="var(--green)" stroke={2.6} /> : st === 'verify' ? <Icon name="help" size={13} color="var(--amber)" stroke={2.2} /> : <Icon name="x" size={13} stroke={2.4} />}
                          {a}
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {desc ? (
                <>
                  <div className="km-eyebrow" style={{ margin: '24px 2px 10px' }}>{l.lane === 'whisper' ? 'What you heard' : 'About the home'}</div>
                  <div className={`kl-desc km-selectable ${!descOpen && desc.length > 320 ? 'clamped' : ''}`}>{desc}</div>
                  {desc.length > 320 ? <button type="button" style={{ marginTop: 6, color: 'var(--bright)', fontSize: 14, fontWeight: 600 }} onClick={() => setDescOpen((v) => !v)}>{descOpen ? 'Less' : 'More'}</button> : null}
                </>
              ) : null}

              <div className="km-eyebrow" style={{ margin: '24px 2px 10px' }}>Location</div>
              <div className="kl-map">
                <svg className="kl-map-coast" viewBox="0 0 400 150" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M300 0 C 280 40, 320 70, 296 110 S 310 150, 300 150 L 400 150 L 400 0 Z" fill="rgba(46,139,255,0.16)" />
                  <path d="M300 0 C 280 40, 320 70, 296 110 S 310 150, 300 150" fill="none" stroke="rgba(127,184,214,0.5)" strokeWidth="1.5" />
                  <path d="M20 96 L 150 70 L 240 88" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="kl-map-pin"><Icon name="mapPin" size={30} stroke={2} /></span>
                <div className="kl-map-label">
                  <span className="t">{[l.neighborhood, l.city && l.city !== l.neighborhood ? l.city : null].filter(Boolean).join(' · ') || l.market || 'Location'}</span>
                  <a className="kl-map-open km-lg km-lg--clear km-lg--dim" target="_blank" rel="noopener noreferrer"
                    href={`https://maps.apple.com/?q=${encodeURIComponent(l.hideAddress || !l.street ? [l.buildingName, l.neighborhood, l.city, l.state].filter(Boolean).join(', ') : [l.street, l.city, l.state, l.postalCode].filter(Boolean).join(', '))}`}>
                    <Icon name="map" size={14} stroke={2} />Open in Maps
                  </a>
                </div>
              </div>

              {(l.listAgentName || l.listOfficeName || l.owner) ? (
                <div className="km-list" style={{ marginTop: 14, padding: 0 }}>
                  {l.listAgentName || l.listOfficeName ? (
                    <div className="kl-agent">
                      <Avatar name={l.listAgentName || l.listOfficeName} seed={l.listAgentName || l.listOfficeName} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="kl-eyebrow">Listing agent</div>
                        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{l.listAgentName || '—'}</div>
                        {l.listOfficeName ? <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>{l.listOfficeName}</div> : null}
                      </div>
                    </div>
                  ) : null}
                  {l.owner ? (
                    <button type="button" className="kl-agent km-press" style={{ width: '100%', textAlign: 'left', borderTop: l.listAgentName ? '1px solid var(--line)' : 0 }} onClick={() => nav.openClient(l.owner.id)}>
                      <Avatar name={l.owner.name} seed={l.owner.id} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="kl-eyebrow">Owner · your client</div>
                        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{l.owner.name}</div>
                      </div>
                      <Icon name="chevronRight" size={16} color="var(--faint)" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="kl-eyebrow" style={{ textAlign: 'center', margin: '22px 0 0' }}>
                {l.lane === 'whisper' ? `Whisper${l.whisperSource ? ` · via ${l.whisperSource.replace('_', ' ')}` : ''} · added ${formatDate(l.createdAt, { month: 'short', day: 'numeric' })}` : `${l.sourceName}${l.mlsNumber ? ` · MLS ${l.mlsNumber}` : ''}`}
              </div>
            </>
          )}
        </div>
      </div>
      {lightbox != null && l ? <Lightbox photos={photos.length ? photos : [null]} start={lightbox} seed={l.id} onClose={() => setLightbox(null)} /> : null}
      <MoreSheet open={sheet === 'more'} onClose={() => setSheet(null)} l={l} onStatus={() => setSheet('status')} onDelete={remove} />
      <StatusSheet open={sheet === 'status'} onClose={() => setSheet(null)} l={l} onDone={(nl) => { setL(nl); load(); }} />
    </PushPanel>
  );
}
