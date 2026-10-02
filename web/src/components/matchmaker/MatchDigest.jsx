// MatchDigest — compact hottest-matches list (≥90 by default) for Serena's
// third page: one row per person — client, home thumb, score, one-tap Draft
// (AI in the agent's voice → seeded thread, never auto-sent) and Call. Tap a
// row for the full "why this fits" sheet.
//
//   <MatchDigest />                                         default ≥90, 12 rows
//   <MatchDigest minScore={90} limit={8} onBeforeNavigate={async () => closeSerena()} />
// onBeforeNavigate / onNavigate (optional, either name) runs before any
// navigation so the host (Serena's sheet) can close its own popup first.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { ScoreDial, Spinner, EmptyState, Button } from '../ui/kit';
import { nav } from '../../lib/nav';
import { getHotMatches } from '../../api/matchmaker';
import { ListingThumb, useListingsLive } from '../listings/listingKit';
import { PersonSheet, useDraftText, draftModeFor, firstOf, dismissMatch } from './MatchUI';
import '../../styles/listings.css';
import '../../styles/matchmaker.css';

export default function MatchDigest({ minScore = 90, limit = 12, onBeforeNavigate, onNavigate, showHeader = true }) {
  const hostLeave = onBeforeNavigate || onNavigate || null;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [person, setPerson] = useState(null);
  const { draft, isBusy } = useDraftText();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => getHotMatches({ min: minScore, limit })
    .then((r) => { if (alive.current) { setRows(r.people || []); setError(null); } })
    .catch((err) => { if (alive.current) setError(err.message || 'Could not load'); }), [minScore, limit]);
  useEffect(() => { load(); }, [load]);
  useListingsLive(load);

  const before = async () => { if (hostLeave) { await hostLeave(); await new Promise((r) => setTimeout(r, 60)); } };
  const go = async (fn) => { await before(); fn(); };

  if (!rows && !error) {
    return <div className="mm-stack">{[0, 1, 2].map((i) => <div key={i} className="km-skel" style={{ height: 62, borderRadius: 14, animationDelay: `${i * 0.1}s` }} />)}</div>;
  }
  if (error && !rows) {
    return <EmptyState icon="alert" title="Couldn't load matches" sub={error} action={<Button variant="ghost" size="sm" onClick={load}>Try again</Button>} />;
  }
  return (
    <div>
      {showHeader ? (
        <div className="mm-section-row" style={{ marginBottom: 6 }}>
          <span className="mm-eyebrow mm-eyebrow--blue">Hottest matches</span>
          <span className="mm-eyebrow">· ≥{minScore}%</span>
          <span style={{ flex: 1 }} />
          {rows.length ? <span className="mm-eyebrow">{rows.length} {rows.length === 1 ? 'person' : 'people'}</span> : null}
        </div>
      ) : null}
      {!rows.length ? (
        <EmptyState
          icon="rings"
          title={`No ${minScore}%+ matches right now`}
          sub="As new listings, whispers and client-owned homes come in, the strongest fits land here — ready to text."
          action={<Button variant="ghost" size="sm" onClick={() => go(() => nav.go('matchmaker'))}>Open Matchmaker</Button>}
          style={{ padding: '30px 18px' }}
        />
      ) : (
        <div className="mm-stack" style={{ gap: 8 }}>
          {rows.map((r, i) => {
            const s = r.best.subject;
            const mode = draftModeFor({ lane: s.lane, kind: s.kind, dropAmount: s.dropAmount });
            const busy = isBusy(r.clientId, s.listingId || s.propertyId, mode);
            return (
              <div key={r.key} className="mm-digest-row km-row-in" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <button type="button" className="mm-digest-main" onClick={() => setPerson(r)}>
                  <Avatar name={r.client.name} seed={r.clientId} src={r.client.avatarUrl} size={36} ring={i === 0 ? 'var(--blue)' : undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mm-name-row" style={{ flexWrap: 'nowrap', gap: 5 }}>
                      <span className="mm-name km-truncate" style={{ fontSize: 14 }}>{r.client.name}</span>
                      {r.client.whale ? <Icon name="crown" size={13} color="var(--bright)" stroke={2} title="Whale" /> : null}
                      {r.count > 1 ? <span className="mm-faint" style={{ fontSize: 11, flexShrink: 0 }}>+{r.count - 1}</span> : null}
                    </div>
                    <div className="mm-person-sub" style={{ marginTop: 3, gap: 7 }}>
                      <ListingThumb src={s.photo} seed={s.id} w={26} h={19} radius={5} />
                      <span className="km-truncate">{s.label}</span>
                    </div>
                  </div>
                  <ScoreDial value={r.best.score} size={38} stroke={3} fontSize={12.5} label={`${r.best.score}${r.best.verifyHold ? '*' : ''}`} />
                </button>
                <button type="button" className="mm-icon-btn" style={{ width: 34, height: 34, color: 'var(--bright)' }} aria-label={`Draft a text to ${firstOf(r.client.name)}`} disabled={busy}
                  onClick={() => draft({ clientId: r.clientId, name: r.client.name, listingId: s.listingId, propertyId: s.propertyId, mode, before })}>
                  {busy ? <Spinner size={14} /> : <Icon name="message" size={16} stroke={1.9} />}
                </button>
                <button type="button" className="mm-icon-btn" style={{ width: 34, height: 34, color: 'var(--green)' }} aria-label={`Call ${r.client.name}`}
                  onClick={() => go(() => nav.call({ clientId: r.clientId, phone: r.client.phone, name: r.client.name }))}>
                  <Icon name="phone" size={16} stroke={1.9} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <PersonSheet
        row={person}
        open={!!person}
        onClose={() => setPerson(null)}
        floorLabel={`≥${minScore}%`}
        onBeforeNavigate={hostLeave ? before : undefined}
        onDismiss={(m, client) => dismissMatch({ clientId: client.id, listingId: m.subject.listingId, propertyId: m.subject.propertyId, matchId: m.matchId, score: m.score, name: client.name }, {
          onRemove: () => { setPerson(null); setRows((xs) => (xs || []).filter((x) => x.clientId !== client.id || x.count > 1)); },
          onRestore: load,
        })}
      />
    </div>
  );
}
