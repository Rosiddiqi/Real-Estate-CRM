// Compact relationship briefing under the thread header (known clients):
// deal stage, last touch, what they're looking for, a personal touch point —
// plus an AI thread summary on long threads. Two states: a compact two-line
// card (default) and a one-line pill; tapping toggles, and the choice sticks.
import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { getBriefing } from '../../api/conversations';
import { getThreadSummary } from '../../api/messages';

const KEY = 'km_brief_collapsed';
const cache = new Map();

function readCollapsed() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export default function BriefingCard({ conversationId, longThread = false }) {
  const [data, setData] = useState(() => cache.get(conversationId) || null);
  const [summary, setSummary] = useState(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    getBriefing(conversationId)
      .then((r) => { if (!alive) return; cache.set(conversationId, r.briefing || null); setData(r.briefing || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !longThread) { setSummary(null); return undefined; }
    let alive = true;
    getThreadSummary(conversationId).then((r) => { if (alive && r && r.summary) setSummary(r); }).catch(() => {});
    return () => { alive = false; };
  }, [conversationId, longThread]);

  if (!data) return null;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  const title = data.stage || data.lookingFor || 'Relationship';
  const facts = [
    data.lastTouch ? `Last touch ${data.lastTouch}` : null,
    data.stage && data.lookingFor ? `Wants ${data.lookingFor.replace(/^\w/, (c) => c.toLowerCase())}` : null,
    data.personalTouch,
    summary && summary.summary ? summary.summary : (!data.personalTouch ? data.nextStep : null),
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <button
        type="button"
        className={`km-brief km-press ${collapsed ? 'km-brief--collapsed' : ''}`}
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show relationship briefing' : 'Collapse briefing'}
      >
        <span className="km-brief-head">
          <span className="km-brief-tile"><Icon name="sparkle" size={collapsed ? 11 : 13} color="#fff" stroke={2} /></span>
          <span className="km-brief-stage">{title}</span>
          {data.isWhale && !collapsed ? <span className="km-brief-eyebrow" style={{ flexShrink: 0 }}>Whale</span> : null}
          <Icon name={collapsed ? 'chevronDown' : 'chevronUp'} size={14} color="var(--faint)" stroke={2.4} />
        </span>
        {!collapsed && facts.length ? <span className="km-brief-facts">{facts.join(' · ')}</span> : null}
      </button>
    </div>
  );
}
