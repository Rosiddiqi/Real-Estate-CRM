// GlobalSearch — overlay `search`. Spotlight for the whole book: an
// autofocused glass search field, debounced /api/search, sections Clients ·
// Listings · Deals · Threads with rich rows (matched text highlighted),
// recent searches (this device), empty + no-results states.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import GlassButton from '../ui/GlassButton';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { EmptyState, SkeletonRows } from '../ui/kit';
import { nav } from '../../lib/nav';
import { formatPhone, fullName, listTime, moneyCompact } from '../../lib/format';
import { globalSearch } from '../../api/system';
import '../../styles/calls.css';

const RECENT_KEY = 'km_recent_searches';
const STAGES = {
  new_lead: 'New lead', consultation: 'Consultation', touring: 'Touring', offer_submitted: 'Offer out', under_contract: 'Under contract', closed: 'Closed',
  seller_lead: 'Seller lead', listing_appt: 'Listing appt', active: 'Listed', offer_received: 'Offer in', lost: 'Lost',
  unit_selection: 'Unit selection', pricing_received: 'Pricing', priority_list: 'Priority list', reserved: 'Reserved', building_delivered: 'Delivered',
};
const STAGE_COLOR = { closed: 'var(--green)', under_contract: 'var(--cyan)', offer_submitted: 'var(--amber)', offer_received: 'var(--amber)', lost: 'var(--faint)' };
const TYPE = { buyer: 'Buyer', seller: 'Seller', buyer_seller: 'Buyer & seller', investor: 'Investor', renter: 'Renter', landlord: 'Landlord', developer: 'Developer', sphere: 'Sphere' };

function readRecents() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 8); } catch { return []; } }
function saveRecent(q) {
  const t = String(q || '').trim();
  if (t.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecents().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8))); } catch { /* ignore */ }
}

function Hi({ text, q }) {
  const s = String(text || '');
  const term = String(q || '').trim();
  if (!term || term.length < 2) return s;
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return s;
  return <>{s.slice(0, i)}<mark style={{ background: 'transparent', color: 'var(--bright)', fontWeight: 500 }}>{s.slice(i, i + term.length)}</mark>{s.slice(i + term.length)}</>;
}

function Row({ left, title, sub, right, onClick, index }) {
  return (
    <button type="button" className="km-ph-row km-press km-row-in" onClick={onClick} style={{ width: 'calc(100% - 16px)', textAlign: 'left', animationDelay: `${Math.min(index, 12) * 22}ms` }}>
      <span className="km-ph-row-main" style={{ padding: '10px 0' }}>
        {left}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="km-truncate" style={{ display: 'block', fontSize: 15.5, fontWeight: 500 }}>{title}</span>
          {sub ? <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{sub}</span> : null}
        </span>
      </span>
      <span style={{ padding: '0 14px 0 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{right}<Icon name="chevronRight" size={15} color="var(--faint)" /></span>
    </button>
  );
}

function SearchHeader({ q, setQ, inputRef }) {
  const { requestClose } = usePanel();
  return (
    <div className="km-scroll-edge" style={{ position: 'relative', zIndex: 20, flexShrink: 0, paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px 10px' }}>
        <GlassButton icon="chevronLeft" label="Back" onClick={requestClose} />
        <div className="km-search km-lg km-lg--line" style={{ flex: 1, height: 42, padding: '0 14px' }}>
          <Icon name="search" size={17} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Clients, listings, deals, threads" aria-label="Search everything" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === 'Enter') { saveRecent(q); e.currentTarget.blur(); } }} />
          {q ? <button type="button" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Clear search" style={{ color: 'var(--faint)', display: 'inline-flex' }}><Icon name="x" size={16} stroke={2.2} /></button> : null}
        </div>
      </div>
    </div>
  );
}

export default function GlobalSearch({ onClose, q: initialQ }) {
  const [q, setQ] = useState(initialQ || '');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState(readRecents);
  const seq = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 380); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); setLoading(false); return undefined; }
    setLoading(true);
    const my = (seq.current += 1);
    const t = setTimeout(() => {
      globalSearch(term, 6)
        .then((r) => { if (my === seq.current) { setRes(r || {}); setLoading(false); } })
        .catch(() => { if (my === seq.current) { setRes({ error: true }); setLoading(false); } });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const total = res && !res.error ? ['clients', 'listings', 'deals', 'conversations'].reduce((n, k) => n + ((res[k] || []).length), 0) : 0;
  const go = (fn) => { saveRecent(q); setRecents(readRecents()); fn(); };

  const sections = useMemo(() => {
    if (!res || res.error) return [];
    const out = [];
    if ((res.clients || []).length) out.push({ key: 'clients', title: 'Clients', rows: res.clients.map((c, i) => (
      <Row key={c.id} index={i} onClick={() => go(() => nav.openClient(c.id))}
        left={<Avatar name={fullName(c)} seed={c.id} src={c.avatarUrl} size={40} />}
        title={<><Hi text={fullName(c)} q={q} />{c.isWhale ? <Icon name="crown" size={12} color="var(--text)" stroke={2} style={{ marginLeft: 6, verticalAlign: '-1px' }} /> : null}</>}
        sub={[c.contactKind && c.contactKind !== 'client' ? (c.vendorRole || c.contactKind).replace(/_/g, ' ') : TYPE[c.type], c.neighborhood || c.city || c.company, c.phone ? formatPhone(c.phone) : c.email].filter(Boolean).join(' · ')}
        right={c.rating ? <span style={{ fontSize: 12, color: 'var(--amber)' }}>{'★'.repeat(c.rating)}</span> : null} />
    )) });
    if ((res.listings || []).length) out.push({ key: 'listings', title: 'Listings', rows: res.listings.map((l, i) => (
      <Row key={l.id} index={i} onClick={() => go(() => nav.openListing(l.id))}
        left={<div style={{ width: 52, height: 40, borderRadius: 9, overflow: 'hidden', flexShrink: 0, position: 'relative' }}><PropertyPhoto src={l.heroPhoto || (l.photoUrls || [])[0]} seed={l.id} height={40} radius={9} /></div>}
        title={<Hi text={[l.street, l.unitNumber ? `#${l.unitNumber}` : null].filter(Boolean).join(' ') || l.buildingName || l.title || 'Listing'} q={q} />}
        sub={[l.neighborhood || l.city, l.listPrice ? moneyCompact(l.listPrice) : null, l.beds ? `${l.beds} bd` : null, l.status === 'coming_soon' ? 'Coming soon' : l.status !== 'active' ? (l.status || '').replace(/_/g, ' ') : null].filter(Boolean).join(' · ')}
        right={l.isOwnListing ? <span className="km-chip" style={{ fontSize: 9.5 }}>Yours</span> : null} />
    )) });
    if ((res.deals || []).length) out.push({ key: 'deals', title: 'Deals', rows: res.deals.map((d, i) => (
      <Row key={d.id} index={i} onClick={() => go(() => nav.openDeal(d.id))}
        left={<span style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', color: STAGE_COLOR[d.stage] || 'var(--bright)' }}><Icon name="pipeline" size={18} stroke={2} /></span>}
        title={<Hi text={d.title || d.propertyLabel || d.propertyAddress || 'Deal'} q={q} />}
        sub={[d.client ? fullName(d.client) : null, STAGES[d.stage] || d.stage, d.price ? moneyCompact(d.price) : null].filter(Boolean).join(' · ')} />
    )) });
    if ((res.conversations || []).length) out.push({ key: 'threads', title: 'Threads', rows: res.conversations.map((c, i) => (
      <Row key={c.id} index={i} onClick={() => go(() => nav.openThread({ conversationId: c.id }))}
        left={<Avatar name={c.displayName || c.groupName} seed={c.clientId || c.handle} size={40} channel={c.channel === 'sms' ? 'sms' : 'imessage'} />}
        title={<Hi text={c.displayName || c.groupName || formatPhone(c.handle)} q={q} />}
        sub={c.lastMessagePreview || null}
        right={<span style={{ fontSize: 12, color: 'var(--faint)' }}>{listTime(c.lastMessageAt)}</span>} />
    )) });
    return out;
  }, [res, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim();
  return (
    <PushPanel onClose={onClose} header={<SearchHeader q={q} setQ={setQ} inputRef={inputRef} />}>
      <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
        {term.length < 2 ? (
          recents.length ? (
            <section>
              <div className="km-ph-section-head">
                <span className="km-eyebrow">Recent searches</span>
                <button type="button" style={{ fontSize: 13, color: 'var(--bright)', fontWeight: 500 }} onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecents([]); }}>Clear</button>
              </div>
              {recents.map((r, i) => (
                <button key={r} type="button" className="km-ph-row km-press km-row-in" onClick={() => setQ(r)} style={{ width: 'calc(100% - 16px)', textAlign: 'left', padding: '12px 0', gap: 12, animationDelay: `${i * 22}ms` }}>
                  <Icon name="clock" size={17} color="var(--faint)" />
                  <span style={{ flex: 1, fontSize: 15.5 }}>{r}</span>
                  <Icon name="arrowUpRight" size={15} color="var(--faint)" style={{ marginRight: 14 }} />
                </button>
              ))}
            </section>
          ) : (
            <EmptyState icon="search" title="Search your whole book" sub="Find any client, listing, deal or text thread by name, address, MLS #, phone or message." />
          )
        ) : loading && !res ? (
          <div style={{ padding: '8px 16px' }}><SkeletonRows n={5} /></div>
        ) : res && res.error ? (
          <EmptyState icon="alert" title="Search hit a snag" sub="Check your connection and try again." />
        ) : !total ? (
          <EmptyState icon="search" title={`No results for “${term}”`} sub="Try a last name, a street, a neighborhood or the last four digits of a phone number." />
        ) : sections.map((s) => (
          <Fragment key={s.key}>
            <div className="km-ph-section-head" style={{ paddingTop: 18 }}><span className="km-eyebrow">{s.title}</span><span style={{ fontSize: 12, color: 'var(--faint)' }}>{s.rows.length}</span></div>
            <div>{s.rows}</div>
          </Fragment>
        ))}
      </div>
    </PushPanel>
  );
}
