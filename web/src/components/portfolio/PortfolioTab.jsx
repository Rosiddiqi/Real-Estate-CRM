// PortfolioTab — RevMatch Garage, re-geared: PORTFOLIO title block,
// typographic sub-tabs Owned · Wishlist · Sold (Rents & Watching ride inside
// Owned as labeled groups), swipeable tiles (+ Deal / Edit), [+] capture.
import { useEffect, useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import { Skeleton } from '../ui/kit';
import { nav } from '../../lib/nav';
import { clientMatches } from '../../api/portfolio';
import { useSocket } from '../../hooks/useSocket';
import { SwipeRow } from '../client/clientKit';
import PropertyTile from './PropertyTile';
import SearchTile from './SearchTile';
import AddPropertySheet from './AddPropertySheet';
import PropertyForm from './PropertyForm';
import WishlistEditor from './WishlistEditor';
import { normalizeMatches } from './portfolioKit';

const EMPTY = {
  owned: ['No properties yet', 'Add what they own — homes they might sell become off-market supply for your other clients.'],
  wishlist: ['No wishlist yet', 'Describe what they want — matching runs across the MLS, your network and client to client.'],
  sold: ['No sale history', 'Past homes and what they sold for — the start of every “what’s it worth now?” call.'],
};

export default function PortfolioTab({ client, loaded, bucket, onBucket, onOpenProperty, onChanged, onScroll }) {
  const props = loaded ? (client.properties || []) : null;
  const searches = loaded ? (client.searches || []) : null;
  const groups = useMemo(() => {
    const p = props || [];
    return {
      owned: p.filter((x) => ['owns', 'leased_out'].includes(x.relationship)),
      rents: p.filter((x) => x.relationship === 'rents'),
      watching: p.filter((x) => x.relationship === 'watching'),
      sold: p.filter((x) => x.relationship === 'sold').sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0)),
    };
  }, [props]);
  const ownedCount = groups.owned.length + groups.rents.length + groups.watching.length;
  const defaultBucket = !loaded ? 'owned' : ownedCount ? 'owned' : (searches || []).length ? 'wishlist' : groups.sold.length ? 'sold' : 'owned';
  const tab = bucket || defaultBucket;
  const [openSwipe, setOpenSwipe] = useState(null);
  const [adding, setAdding] = useState(null);    // relationship to seed the add sheet
  const [editing, setEditing] = useState(null);  // property being edited
  const [wish, setWish] = useState(null);        // { search? }
  const [matches, setMatches] = useState({});
  const [mState, setMState] = useState('idle');

  const loadMatches = () => {
    if (!searches || !searches.length) return;
    setMState((s) => (s === 'ready' ? s : 'loading'));
    clientMatches(client.id)
      .then((r) => { setMatches(normalizeMatches(r)); setMState('ready'); })
      .catch(() => setMState('error'));
  };
  useEffect(() => { if (tab === 'wishlist') loadMatches(); }, [tab, client.id, searches && searches.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocket('match_new', (p) => { if (p && p.clientId === client.id && tab === 'wishlist') loadMatches(); });

  const total = (props || []).length + (searches || []).length;
  const tabs = [
    { id: 'owned', label: 'Owned', count: ownedCount },
    { id: 'wishlist', label: 'Wishlist', count: (searches || []).length },
    { id: 'sold', label: 'Sold', count: groups.sold.length },
  ];

  const add = () => {
    if (tab === 'wishlist') setWish({});
    else setAdding(tab === 'sold' ? 'sold' : 'owns');
  };

  const tile = (p) => (
    <SwipeRow
      key={p.id}
      id={p.id}
      openId={openSwipe}
      setOpenId={setOpenSwipe}
      width={84}
      radius={16}
      bg="transparent"
      actions={[
        { label: 'Deal', icon: 'plus', bg: 'var(--hl)', color: '#0D0D0D', onClick: () => nav.newDeal({ clientId: client.id, side: p.relationship === 'rents' || p.relationship === 'watching' ? 'buyer' : 'listing', portfolioPropertyId: p.id, price: p.estValue || undefined }) },
        { label: 'Edit', icon: 'edit', bg: '#3A3A3C', onClick: () => setEditing(p) },
      ]}
    >
      <PropertyTile p={p} onOpen={onOpenProperty} />
    </SwipeRow>
  );

  const groupHead = (label, n, dot) => (
    <div className="kc-group-head">
      <span className="kc-dot" style={{ background: dot }} />
      <span className="kc-eyebrow" style={{ color: 'var(--dim)' }}>{label}</span>
      <span className="kc-mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{String(n).padStart(2, '0')}</span>
    </div>
  );

  const empty = (key) => (
    <div className="kc-pf-empty">
      <h4>{EMPTY[key][0]}</h4>
      <p>{EMPTY[key][1]}</p>
      <button type="button" className="km-btn km-btn--sm" style={{ marginTop: 14 }} onClick={add}>
        <Icon name="plus" size={14} stroke={2.4} /> {key === 'wishlist' ? 'Add a wishlist' : key === 'sold' ? 'Add a sale' : 'Add a property'}
      </button>
    </div>
  );

  return (
    <div className="kc-pane" style={{ position: 'relative' }}>
      <div className="kc-pane-scroll km-scroll" onScroll={(e) => { if (openSwipe) setOpenSwipe(null); onScroll?.(e); }}>
        <div className="kc-pane-inner">
          <div className="kc-pf-head">
            <div style={{ minWidth: 0 }}>
              <div className="kc-pf-title">Portfolio</div>
              <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 4 }}>
                {props === null ? 'Loading…' : `${total} ${total === 1 ? 'entry' : 'entries'} · matching runs across MLS, network & client to client`}
              </div>
            </div>
            <button type="button" className="kc-circle-btn km-press" onClick={add} aria-label="Add to portfolio"><Icon name="plus" size={17} stroke={2.2} /></button>
          </div>

          <div className="kc-pf-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`kc-pf-tab ${tab === t.id ? 'kc-pf-tab--on' : ''}`} onClick={() => onBucket(t.id)}>
                {t.label}{t.count ? <sup>{t.count}</sup> : null}
              </button>
            ))}
          </div>

          {props === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              <Skeleton h={300} r={16} /><Skeleton h={300} r={16} />
            </div>
          ) : tab === 'owned' ? (
            ownedCount === 0 ? empty('owned') : (
              <div>
                {groups.owned.length ? <>{(groups.rents.length || groups.watching.length) ? groupHead('Owned', groups.owned.length, 'var(--green)') : <div style={{ height: 16 }} />}<div className="kc-tiles-grid" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{groups.owned.map(tile)}</div></> : null}
                {groups.rents.length ? <>{groupHead('Rents', groups.rents.length, 'var(--cyan)')}<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{groups.rents.map(tile)}</div></> : null}
                {groups.watching.length ? <>{groupHead('Watching', groups.watching.length, 'var(--violet)')}<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{groups.watching.map(tile)}</div></> : null}
              </div>
            )
          ) : tab === 'wishlist' ? (
            (searches || []).length === 0 ? empty('wishlist') : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
                {searches.map((s) => <SearchTile key={s.id} s={s} client={client} matches={matches[s.id] || []} matchesState={mState} onEdit={(x) => setWish({ search: x })} />)}
              </div>
            )
          ) : (
            groups.sold.length === 0 ? empty('sold') : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>{groups.sold.map(tile)}</div>
            )
          )}
        </div>
      </div>

      <AddPropertySheet open={!!adding} client={client} relationship={adding} onClose={() => setAdding(null)} onSaved={(p) => { onChanged(); if (p) onBucket(p.relationship === 'sold' ? 'sold' : 'owned'); }} onWishlist={(t) => { setAdding(null); setTimeout(() => setWish({ prefillText: typeof t === 'string' ? t : '' }), 260); }} />
      <PropertyForm open={!!editing} client={client} property={editing} onClose={() => setEditing(null)} onSaved={() => onChanged()} />
      <WishlistEditor open={!!wish} client={client} search={wish && wish.search} prefillText={wish && wish.prefillText} matches={wish && wish.search ? matches[wish.search.id] : null} onClose={() => setWish(null)} onSaved={() => { onChanged(); onBucket('wishlist'); setTimeout(loadMatches, 600); }} />
    </div>
  );
}
