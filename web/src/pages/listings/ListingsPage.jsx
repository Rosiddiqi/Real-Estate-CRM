// Listings — the agent's whole inventory in one place: My Listings · MLS Feed ·
// Pocket & Coming Soon · Whispers · New Development. PushPanel from the drawer
// (nav.openListings(filter)); `filter` may be a lane id ('pocket') or
// { lane, search, filters }.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../../components/ui/PushPanel';
import PageHeader from '../../components/ui/PageHeader';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import { EmptyState, Button } from '../../components/ui/kit';
import { nav } from '../../lib/nav';
import { listListings } from '../../api/listings';
import { LANES, ListingTile, TileSkeletons, LaneDot, useListingsLive } from '../../components/listings/listingKit';
import { FilterSheet, SortSheet, EMPTY_FILTERS, SORT_OPTIONS, passesFilters, sortListings, activeCount, filterChipsSummary } from '../../components/listings/FilterSortSheets';
import '../../styles/listings.css';
import { tone } from '../../lib/palette';

const SORT_KEY = 'km_listings_sort';
let cache = null; // last payload — instant paint on reopen, then silent refresh

function normalizeFilter(filter) {
  if (!filter) return {};
  if (typeof filter === 'string') return LANES.some((l) => l.id === filter) ? { lane: filter } : { search: filter };
  return filter;
}

function Header({ total, loading, onAdd, search, setSearch, onFilter, onSort, filterCount, sortId, lane, setLane, lanes, chips, clearChip }) {
  const { requestClose } = usePanel();
  const sortShort = (SORT_OPTIONS.find((o) => o.id === sortId) || SORT_OPTIONS[0]).short;
  return (
    <PageHeader
      title="Listings"
      subtitle={loading ? 'Loading…' : `${total} home${total === 1 ? '' : 's'}`}
      onBack={requestClose}
      right={<GlassButton icon="plus" accent onClick={onAdd} label="Add listing" />}
    >
      <div className="kl-toolbar">
        <label className="kl-search km-lg">
          <Icon name="search" size={17} stroke={2} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, building, MLS #…" enterKeyHint="search" aria-label="Search listings" />
          {search ? <button type="button" className="kl-search-clear" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="x" size={12} stroke={2.6} /></button> : null}
        </label>
        <GlassButton icon="sliders" onClick={onFilter} label="Filters" badge={filterCount || null} />
        <GlassButton icon="sort" onClick={onSort} label={`Sort: ${sortShort}`} />
      </div>
      <div className="kl-lanes km-scroll-x" role="tablist" aria-label="Sources">
        <button type="button" role="tab" aria-selected={lane === 'all'} className={`kl-lane ${lane === 'all' ? 'kl-lane--on' : ''}`} onClick={() => setLane('all')}>
          All <span className="n">{lanes.reduce((n, l) => n + (l.count || 0), 0)}</span>
        </button>
        {lanes.filter((l) => l.count || lane === l.id).map((l) => (
          <button key={l.id} type="button" role="tab" aria-selected={lane === l.id} className={`kl-lane ${lane === l.id ? 'kl-lane--on' : ''}`} style={{ '--lane': tone(l.color) }} onClick={() => setLane(lane === l.id ? 'all' : l.id)}>
            <LaneDot color={l.color} size={7} />{l.label} <span className="n">{l.count}</span>
          </button>
        ))}
      </div>
      {chips.length ? (
        <div className="kl-active-filters km-scroll-x">
          {chips.map(([k, label]) => (
            <button key={k} type="button" onClick={() => clearChip(k)}>{label}<Icon name="x" size={11} stroke={2.6} /></button>
          ))}
        </div>
      ) : null}
    </PageHeader>
  );
}

export default function ListingsPage({ filter, onClose }) {
  const init = useMemo(() => normalizeFilter(filter), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState(cache);
  const [error, setError] = useState(null);
  const [lane, setLane] = useState(init.lane || 'all');
  const [search, setSearch] = useState(init.search || '');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...(init.filters || {}) });
  const [sort, setSort] = useState(() => { try { return localStorage.getItem(SORT_KEY) || 'tier'; } catch { return 'tier'; } });
  const [sheet, setSheet] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    listListings({ limit: 500 })
      .then((r) => { if (!alive.current) return; cache = r; setData(r); setError(null); })
      .catch((err) => { if (alive.current) setError(err.message || 'Could not load listings'); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useListingsLive(load);

  const changeSort = (id) => { setSort(id); try { localStorage.setItem(SORT_KEY, id); } catch { /* ignore */ } };
  const listings = data ? data.listings : [];
  const lanes = useMemo(() => {
    const counts = Object.fromEntries((data?.lanes || []).map((l) => [l.id, l.count]));
    return LANES.map((l) => ({ ...l, count: counts[l.id] || 0 }));
  }, [data]);
  const filtered = useMemo(() => sortListings(listings.filter((l) => passesFilters(l, filters, { lane, search })), sort), [listings, filters, lane, search, sort]);
  const sections = useMemo(() => {
    if (lane !== 'all' || sort !== 'tier') return null;
    return LANES.map((ln) => ({ ...ln, items: filtered.filter((l) => l.lane === ln.id) })).filter((s) => s.items.length);
  }, [filtered, lane, sort]);
  const chips = filterChipsSummary(filters);
  const clearChip = (k) => setFilters((f) => {
    if (k === 'price') return { ...f, priceMin: null, priceMax: null };
    return { ...f, [k]: Array.isArray(EMPTY_FILTERS[k]) ? [] : null };
  });
  const open = (l) => nav.openListing(l.id);
  const add = () => nav.newListing(lane !== 'all' && lane !== 'mls' ? { lane } : {});
  const anyFilter = activeCount(filters) > 0 || search;

  let body;
  if (!data && !error) body = <TileSkeletons n={4} />;
  else if (!data && error) {
    body = <EmptyState icon="alert" title="Couldn't load listings" sub={error} action={<Button variant="ghost" size="sm" onClick={load}>Try again</Button>} />;
  } else if (!listings.length) {
    body = (
      <EmptyState
        icon="estate"
        title="No listings yet"
        sub="Add your own listings, pocket listings and whispers — every one is scored against your buyers the moment it lands."
        action={<Button size="sm" icon="plus" onClick={add}>Add a listing</Button>}
      />
    );
  } else if (!filtered.length) {
    body = (
      <EmptyState
        icon="search"
        title="No homes match"
        sub="Clear the search or loosen a filter."
        action={<Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilters(EMPTY_FILTERS); setLane('all'); }}>Clear all</Button>}
      />
    );
  } else if (sections) {
    let k = 0;
    body = sections.map((s) => (
      <section key={s.id}>
        <div className="kl-section-head">
          <LaneDot color={s.color} size={8} />
          <span className="t">{s.label}</span>
          <span className="c">{s.items.length}</span>
          <span className="rule" />
        </div>
        <div className="kl-grid">{s.items.map((l) => <ListingTile key={l.id} l={l} onOpen={open} index={k++} />)}</div>
      </section>
    ));
  } else {
    body = <div className="kl-grid" style={{ paddingTop: 8 }}>{filtered.map((l, i) => <ListingTile key={l.id} l={l} onOpen={open} index={i} />)}</div>;
  }

  return (
    <PushPanel
      onClose={onClose}
      header={(
        <Header
          total={anyFilter || lane !== 'all' ? filtered.length : (data?.total ?? 0)}
          loading={!data && !error}
          onAdd={add}
          search={search}
          setSearch={setSearch}
          onFilter={() => setSheet('filter')}
          onSort={() => setSheet('sort')}
          filterCount={activeCount(filters)}
          sortId={sort}
          lane={lane}
          setLane={setLane}
          lanes={lanes}
          chips={chips}
          clearChip={clearChip}
        />
      )}
      bodyClassName="kl-page"
      bodyStyle={{ padding: '0 16px', paddingBottom: 'calc(var(--tabbar-clearance) + var(--safe-bottom) + 24px)' }}
    >
      <div className="kl-glow" />
      {error && data ? <div className="kl-error">Couldn't refresh — showing the last copy.<button type="button" onClick={load}>Retry</button></div> : null}
      <div style={{ position: 'relative', paddingTop: sections ? 0 : 4, maxWidth: 1280, margin: '0 auto' }}>{body}</div>
      <FilterSheet open={sheet === 'filter'} onClose={() => setSheet(null)} listings={listings} value={filters} onApply={setFilters} lane={lane} search={search} />
      <SortSheet open={sheet === 'sort'} onClose={() => setSheet(null)} value={sort} onChange={changeSort} />
    </PushPanel>
  );
}
