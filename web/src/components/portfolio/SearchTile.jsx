// SearchTile — one Wishlist entry (BuyerSearch). Criteria chips (confirmed
// blue / soft amber / deal-breakers red), budget, bucket pill, and the live
// matches from the listings builder's matchmaker with one-tap "Send".
import { useState } from 'react';
import Icon from '../ui/Icon';
import PropertyPhoto from '../ui/PropertyPhoto';
import { ScoreDial } from '../ui/kit';
import { nav } from '../../lib/nav';
import { searchBudget, searchChips, money } from './portfolioKit';

const BUCKET = {
  active: { label: 'SEARCHING', dot: 'var(--blue)' },
  dream: { label: 'DREAM', dot: 'var(--violet)' },
  inferred: { label: 'INFERRED', dot: 'var(--amber)' },
};

function sendDraft(client, m, search) {
  const first = client.firstName || '';
  const bits = [m.title, m.neighborhood, m.price ? money(m.price) : null].filter(Boolean).join(' · ');
  return `${first ? `${first}, ` : ''}this just made me think of your ${search.title.toLowerCase()} search — ${bits}.${m.url ? ` ${m.url}` : ''} Want to see it?`;
}

export default function SearchTile({ s, client, matches, matchesState, onEdit }) {
  const [open, setOpen] = useState(false);
  const b = BUCKET[s.bucket] || BUCKET.active;
  const list = matches || [];
  const top = list[0];
  const paused = s.status && s.status !== 'active';
  return (
    <div className="kc-tile" style={{ opacity: paused ? 0.72 : 1 }}>
      <button type="button" className="kc-tile-photo km-press" style={{ display: 'block', width: '100%' }} onClick={() => onEdit(s)}>
        <PropertyPhoto src={top ? top.photo : null} seed={s.id} height={150} />
        <div className="kc-tl">
          <span className="kc-blurpill" style={{ fontFamily: 'var(--kc-mono)', fontSize: 9.5, letterSpacing: '0.12em' }}>
            <span className="kc-dot" style={{ background: b.dot, boxShadow: `0 0 6px ${b.dot}` }} />{paused ? s.status.toUpperCase() : b.label}
          </span>
        </div>
        <div className="kc-br"><span className="kc-blurpill" style={{ fontWeight: 700 }}>{searchBudget(s)}{s.budgetFlexible ? ' · flexible' : ''}</span></div>
        {top && top.score ? <div className="kc-bl"><span className="kc-blurpill">TOP MATCH <b style={{ marginLeft: 2 }}>{top.score}</b></span></div> : null}
      </button>
      <div className="kc-tile-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kc-tile-title">{s.title}</div>
            {s.timeline || s.financing ? <div className="kc-tile-sub">{[s.timeline ? { asap: 'ASAP', '30d': 'Within 30 days', '90d': 'Within 3 months', '6mo': 'Within 6 months', '12mo': 'Within a year', someday: 'Opportunistic' }[s.timeline] || s.timeline : null, s.financing ? s.financing.replace(/_/g, ' ') : null].filter(Boolean).join(' · ')}</div> : null}
          </div>
          <button type="button" className="kc-circle-btn km-press" onClick={() => onEdit(s)} aria-label="Edit search"><Icon name="edit" size={15} /></button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {searchChips(s).map((c) => (
            <span key={`${c.label}`} className={`kc-ochip ${c.tone === 'ok' ? 'kc-ochip--ok' : c.tone === 'no' ? 'kc-ochip--no' : 'kc-ochip--soft'}`}>
              {c.tone === 'ok' ? <Icon name="check" size={10} color="var(--bright)" stroke={2.6} /> : null}
              {c.label}{c.must ? ' · must' : ''}
            </span>
          ))}
          {!searchChips(s).length ? <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>No criteria yet — describe what they want.</span> : null}
        </div>
        <div className="kc-tile-foot">
          <button type="button" onClick={() => list.length && setOpen((o) => !o)} style={{ color: list.length ? 'var(--text)' : 'var(--faint)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {matchesState === 'loading' ? 'Matching…' : matchesState === 'error' ? 'Matching runs nightly' : list.length ? `${list.length} live match${list.length === 1 ? '' : 'es'}` : 'No live matches yet'}
            {list.length ? <Icon name="chevronDown" size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /> : null}
          </button>
          <button type="button" onClick={() => onEdit(s)} style={{ color: 'var(--bright)', fontWeight: 600 }}>Edit ›</button>
        </div>
        {open ? (
          <div style={{ marginTop: 6 }}>
            {list.slice(0, 5).map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--kc-hair)' }}>
                <button type="button" className="km-press" onClick={() => m.listingId && nav.openListing(m.listingId)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <PropertyPhoto src={m.photo} seed={m.id} height={40} radius={9} style={{ width: 52, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{m.title}</span>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--dim)' }}>{[m.price ? money(m.price) : null, m.beds ? `${m.beds} bd` : null, m.neighborhood].filter(Boolean).join(' · ')}</span>
                  </span>
                  {m.score ? <ScoreDial value={m.score} size={34} stroke={3} /> : null}
                </button>
                <button type="button" className="km-btn km-btn--sm" style={{ minHeight: 30, padding: '0 12px' }} onClick={() => nav.openThread({ clientId: client.id, draft: sendDraft(client, m, s) })}>Send</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
