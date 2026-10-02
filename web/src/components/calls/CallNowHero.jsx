// CallNowHero — "Call now": who to call and why (today's Battle Plan call
// moves, interleaved with live signals — unanswered questions, unreturned
// missed calls/voicemails, deal deadlines, whales gone quiet).
import { useCallback, useEffect, useState } from 'react';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { Skeleton } from '../ui/kit';
import { nav } from '../../lib/nav';
import { callSuggestions } from '../../api/calls';
import { useResync, useSocket } from '../../hooks/useSocket';

const KIND_ICON = { unanswered: 'message', missed_call: 'phoneMissed', deadline: 'clock', offer: 'handshake', quiet: 'moon', birthday: 'cake' };

export default function CallNowHero() {
  const [rows, setRows] = useState(null);
  const [source, setSource] = useState(null);
  const load = useCallback(() => {
    callSuggestions({ limit: 4 }).then((r) => { setRows(r.suggestions || []); setSource(r.source); }).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useResync(load);
  useSocket(['plan_updated', 'conversation_read'], () => setTimeout(load, 600));

  if (rows && !rows.length) return null;
  return (
    <section className="km-ph-hero" aria-label="Call now">
      <div className="km-ph-section-head">
        <span className="km-eyebrow" style={{ color: 'var(--green)' }}>Call now</span>
        {source ? <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{source.startsWith('battle_plan') ? 'From today’s plan' : 'Live signals'}</span> : null}
      </div>
      <div className="km-ph-hero-scroll km-scroll-x">
        {!rows ? [0, 1].map((i) => (
          <div key={i} className="km-ph-now" style={{ gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Skeleton w={40} h={40} r={20} /><Skeleton w="55%" h={14} /></div>
            <Skeleton w="90%" h={12} /><Skeleton w="70%" h={12} /><Skeleton w="100%" h={36} r={12} />
          </div>
        )) : rows.map((s, i) => (
          <div key={s.clientId} className={`km-ph-now ${i === 0 ? 'km-ph-now--first' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
            <button type="button" className="km-ph-now-top km-press" onClick={() => nav.openClient(s.clientId)} style={{ textAlign: 'left' }}>
              <Avatar name={s.name} seed={s.clientId} src={s.avatarUrl} size={40} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="km-ph-now-name km-truncate" style={{ display: 'block' }}>
                  {s.name}
                  {s.whale ? <Icon name="crown" size={12} color="var(--amber)" stroke={2} style={{ marginLeft: 5, verticalAlign: '-1px' }} /> : null}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name={KIND_ICON[s.kind] || (s.kind && s.kind.includes('match') ? 'rings' : 'sparkle')} size={11} stroke={2} />
                  {i === 0 ? 'Call first' : `#${i + 1} today`}
                </span>
              </span>
            </button>
            <div className="km-ph-now-reason km-clamp-2">{s.reason}</div>
            {s.why ? <div className="km-ph-now-why km-clamp-2">{s.why}</div> : null}
            <div className="km-ph-now-actions">
              <button type="button" className="km-ph-callbtn" onClick={() => nav.call({ clientId: s.clientId, phone: s.phone, name: s.name })}>
                <Icon name="phone" size={15} stroke={2.2} /> Call {s.firstName || ''}
              </button>
              <button type="button" className="km-ph-iconbtn" aria-label={`Text ${s.name}`} onClick={() => nav.openThread({ clientId: s.clientId })}>
                <Icon name="message" size={16} stroke={2} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
