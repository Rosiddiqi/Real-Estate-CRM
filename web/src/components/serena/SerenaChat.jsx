// Serena's chat page: the thread (date separators, grouped turns, live
// streaming) + empty-state starters + composer.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { SkeletonRows } from '../ui/kit';
import { api } from '../../api/client';
import { formatDaySep, formatTime, greeting } from '../../lib/format';
import { useAuth } from '../../hooks/useAuth';
import SerenaAvatar from './SerenaAvatar';
import SerenaComposer from './SerenaComposer';
import { AssistantMessage, UserBubble } from './SerenaMessage';
import { serena, useSerena } from './serenaStore';
import { useAssistant } from '../../hooks/useAssistant';

const ICONS = [
  { icon: 'calendar', color: 'var(--srn-violet)', bg: 'rgba(154,77,255,0.14)' },
  { icon: 'phone', color: 'var(--green)', bg: 'rgba(48,210,122,0.14)' },
  { icon: 'message', color: 'var(--imsg)', bg: 'rgba(46,139,255,0.14)' },
  { icon: 'key', color: 'var(--amber)', bg: 'rgba(242,169,59,0.14)' },
];
const DEFAULT_STARTERS = ['What’s my day?', 'Who should I call first?', 'Draft a just-listed text for 128 Sunset Dr', 'Add a showing with the Delacroixs tomorrow at 2'];

let startersCache = null;

function sepLabel(msg, prev) {
  if (!prev) return formatDaySep(msg.createdAt);
  const a = new Date(msg.createdAt);
  const b = new Date(prev.createdAt);
  if (a.toDateString() !== b.toDateString()) return formatDaySep(msg.createdAt);
  if (a - b > 3 * 3600e3) return formatTime(msg.createdAt);
  return null;
}

function Hello({ name, mode, onPick }) {
  const { name: assistant } = useAssistant();
  const [starters, setStarters] = useState(startersCache || DEFAULT_STARTERS);
  useEffect(() => {
    if (startersCache) return;
    api.get('/serena/starters').then((r) => { if (r && r.starters && r.starters.length) { startersCache = r.starters; setStarters(r.starters); } }).catch(() => {});
  }, []);
  return (
    <div className="km-srn-hello">
      <SerenaAvatar size={58} />
      <h2>{greeting()}{name ? `, ${name}` : ''}</h2>
      <p>I’m {assistant}, your chief of staff. I run your day, keep your To-Do, book showings, keep the pipeline moving and draft client texts for your OK.</p>
      {mode === 'offline' ? (
        <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>Offline mode · no AI key on the server — I understand the core commands below.</p>
      ) : null}
      <div className="km-srn-starters">
        {starters.slice(0, 4).map((t, i) => {
          const ic = ICONS[i % ICONS.length];
          return (
            <button key={t} type="button" className="km-srn-starter" style={{ animationDelay: `${80 + i * 50}ms` }} onClick={() => onPick(t)}>
              <span className="km-srn-starter-ico" style={{ background: ic.bg, color: ic.color }}><Icon name={ic.icon} size={15} stroke={2} /></span>
              <span style={{ flex: 1 }}>{t}</span>
              <Icon name="arrowUpRight" size={14} color="var(--faint)" stroke={2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SerenaChat({ active, onHandoff, onOpenCard }) {
  const s = useSerena();
  const { user } = useAuth();
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const msgs = s.messages;
  const last = msgs[msgs.length - 1];
  const sig = `${msgs.length}:${last ? (last.text || '').length : 0}:${last ? (last.cards || []).length + (last.proposals || []).length + (last.activity || []).length : 0}:${s.typing}`;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [sig]);
  useEffect(() => { // new turn from the agent → always follow it
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, active]);

  const send = (t) => { stick.current = true; serena.send(t); };
  const empty = s.hydrated && !msgs.length;

  return (
    <>
      <div className="km-srn-thread" ref={scrollRef} onScroll={onScroll}>
        {!s.hydrated && s.loading ? <div style={{ padding: '10px 4px' }}><SkeletonRows n={3} /></div> : null}
        {empty ? <Hello name={user?.firstName} mode={s.mode} onPick={send} /> : null}
        {s.error && !msgs.length ? <div className="km-srn-side-fallback">{s.error}</div> : null}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const sep = sepLabel(m, prev);
          const grouped = !sep && prev && prev.role === m.role;
          return (
            <Fragment key={m.id}>
              {sep ? <div className="km-srn-sep">{sep}</div> : null}
              {m.role === 'user'
                ? <UserBubble msg={m} grouped={grouped} />
                : <AssistantMessage msg={m} grouped={grouped} isLast={i === msgs.length - 1} onHandoff={onHandoff} onOpenCard={onOpenCard} />}
            </Fragment>
          );
        })}
        <div style={{ height: 6, flexShrink: 0 }} />
      </div>
      <SerenaComposer busy={s.typing} onSend={send} focusKey={active ? 'on' : null} />
    </>
  );
}
