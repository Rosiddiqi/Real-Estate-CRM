// Matchmaker → Listings mode (RM "Inventory" embedded ranked): people-first —
// one row per client with an 80%+ fit to a home on the books (best match,
// +N more, CALL FIRST on the top row), then the scored listing tiles (top match
// only), tucked below and collapsed by default.
import { useState } from 'react';
import Icon from '../ui/Icon';
import { EmptyState, Button } from '../ui/kit';
import { nav } from '../../lib/nav';
import { RankedTile, TileSkeletons } from '../listings/listingKit';
import { PeopleList, PersonSheet, dismissMatch, track } from './MatchUI';
import { useMatchFeed } from './useMatchFeed';

export default function ListingsModePanel() {
  const { data, error, reload, patch } = useMatchFeed('listings');
  const [person, setPerson] = useState(null);
  const [showTiles, setShowTiles] = useState(false);
  const people = data ? data.people : [];
  const listings = data ? data.listings : [];

  const openPerson = (row) => {
    setPerson(row);
    track('opened', { clientId: row.clientId, listingId: row.best.subject.listingId || null, matchId: row.best.matchId || null });
  };
  const openPersonById = (clientId) => {
    const row = people.find((p) => p.clientId === clientId);
    if (row) openPerson(row);
  };
  const onDismiss = (m, client) => {
    const snapshot = data;
    dismissMatch({ clientId: client.id, listingId: m.subject.listingId, propertyId: m.subject.propertyId, matchId: m.matchId, score: m.score, name: client.name }, {
      onRemove: () => {
        patch((d) => {
          const strip = (row) => {
            if (row.clientId !== client.id) return row;
            const all = [row.best, ...row.others].filter((x) => !(x.subject.id === m.subject.id));
            if (!all.length) return null;
            return { ...row, best: all[0], others: all.slice(1), count: all.length };
          };
          return { ...d, people: d.people.map(strip).filter(Boolean) };
        });
        setPerson((p) => {
          if (!p) return p;
          const all = [p.best, ...p.others].filter((x) => x.subject.id !== m.subject.id);
          return all.length ? { ...p, best: all[0], others: all.slice(1), count: all.length } : null;
        });
      },
      onRestore: () => { patch(() => snapshot); reload(); },
    });
  };

  return (
    <div className="mm-panel-in">
      <div className="mm-section-row">
        <span className="mm-eyebrow mm-eyebrow--blue">Clients</span>
        <span className="mm-eyebrow">· ≥{data ? data.threshold : 80}%</span>
        <span style={{ flex: 1 }} />
        {data && people.length ? <span className="mm-eyebrow">{people.length} {people.length === 1 ? 'person' : 'people'}</span> : null}
      </div>
      <p className="mm-blurb">Every client with an 80%+ fit to a home on your books — hottest first, ready to text. The listings themselves are tucked below.</p>

      {error && !data ? (
        <div className="mm-error">Couldn't load matches ({error}).<button type="button" onClick={reload}>Retry</button></div>
      ) : null}
      {!data && !error ? <PeopleList loading /> : null}
      {data && !people.length ? (
        <EmptyState
          icon="rings"
          title="No clients at 80%+ yet"
          sub="As listings land and searches sharpen, the strongest fits show up here — ready to text."
          action={<Button variant="ghost" size="sm" icon="estate" onClick={() => nav.openListings()}>Browse listings</Button>}
          style={{ padding: '30px 20px' }}
        />
      ) : null}
      {data && people.length ? <PeopleList rows={people} onOpen={openPerson} /> : null}

      {data && listings.length ? (
        <>
          <button type="button" className="mm-collapse" onClick={() => setShowTiles((v) => !v)} aria-expanded={showTiles}>
            <span className="mm-eyebrow">Scored listings</span>
            <span className="mm-eyebrow" style={{ color: 'var(--bright)' }}>{listings.length}</span>
            <span className="rule" />
            <Icon name="chevronDown" size={16} className={`mm-chev ${showTiles ? '' : 'mm-chev--closed'}`} />
          </button>
          {showTiles ? (
            <div className="kl-grid">
              {listings.map((l, i) => <RankedTile key={l.id} l={l} index={i} onOpen={() => nav.openListing(l.id)} onOpenPerson={openPersonById} />)}
            </div>
          ) : null}
        </>
      ) : null}
      {!data && !error ? <div style={{ marginTop: 24 }}><TileSkeletons n={1} /></div> : null}

      <PersonSheet row={person} open={!!person} onClose={() => setPerson(null)} onDismiss={onDismiss} />
    </div>
  );
}
