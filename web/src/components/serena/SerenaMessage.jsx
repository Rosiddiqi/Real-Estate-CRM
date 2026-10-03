// One turn in Serena's thread: the agent's bubble, or Serena's reply —
// live tool activity ("Looking up Elena's deal…"), the streamed markdown
// answer, receipts with Undo, approval cards for drafts, people/threads to act
// on, and follow-up chips.
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Spinner } from '../ui/kit';
import { nav } from '../../lib/nav';
import SerenaAvatar from './SerenaAvatar';
import SerenaActionCard from './SerenaActionCard';
import SerenaProposalCard from './SerenaProposalCard';
import { serena } from './serenaStore';

const MD_COMPONENTS = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
};

export const Markdown = memo(function Markdown({ text }) {
  return (
    <div className="km-srn-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
});

export function UserBubble({ msg, grouped }) {
  return (
    <div className={`km-srn-row km-srn-row--user ${grouped ? 'km-srn-row--grouped' : ''}`}>
      <div className="km-srn-col">
        <div className="km-srn-bub km-srn-bub--user km-selectable">{msg.text}</div>
      </div>
    </div>
  );
}

function ActivityLines({ activity, live }) {
  const [open, setOpen] = useState(false);
  if (!activity || !activity.length) return null;
  if (live) {
    return (
      <div className="km-srn-acts">
        {activity.slice(-4).map((a) => (
          <div key={a.id} className={`km-srn-act ${a.ok == null ? 'km-srn-act--live' : ''} ${a.ok === false ? 'km-srn-act--fail' : ''}`}>
            <span className="km-srn-act-ico">
              {a.ok == null ? <Spinner size={12} color="var(--srn-violet)" /> : a.ok ? <Icon name="check" size={12} stroke={2.6} color="var(--green)" /> : <Icon name="x" size={12} stroke={2.6} color="var(--red)" />}
            </span>
            <span className="km-srn-act-label km-truncate">{a.label}</span>
          </div>
        ))}
      </div>
    );
  }
  const failed = activity.filter((a) => a.ok === false).length;
  return (
    <div>
      <button type="button" className="km-srn-acts-sum" onClick={() => setOpen((v) => !v)}>
        <Icon name={failed ? 'alert' : 'sparkle'} size={11} color={failed ? 'var(--amber)' : 'var(--srn-violet)'} stroke={2} />
        {activity.length === 1 ? activity[0].label.replace(/…$/, '') : `${activity.length} steps`}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} stroke={2.2} />
      </button>
      {open ? (
        <div className="km-srn-acts" style={{ marginTop: 4 }}>
          {activity.map((a) => (
            <div key={a.id} className={`km-srn-act ${a.ok === false ? 'km-srn-act--fail' : ''}`}>
              <span className="km-srn-act-ico">{a.ok === false ? <Icon name="x" size={12} stroke={2.6} /> : <Icon name="check" size={12} stroke={2.6} color="var(--green)" />}</span>
              <span className="km-truncate">{a.label.replace(/…$/, '')}{a.summary && a.ok ? <span style={{ color: 'var(--faint)' }}> · {a.summary}</span> : a.ok === false ? <span> · {a.summary}</span> : null}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Entities({ items, onHandoff }) {
  if (!items || !items.length) return null;
  return (
    <div className="km-srn-ents">
      {items.slice(0, 6).map((e, i) => {
        const openIt = () => onHandoff(() => {
          if (e.type === 'client') nav.openClient(e.id);
          else if (e.type === 'thread') nav.openThread({ conversationId: e.id, clientId: e.clientId || undefined });
          else if (e.type === 'listing') nav.openListing(e.id);
          else if (e.type === 'pipeline') nav.openPipeline();
          else if (e.type === 'commissions') nav.openCommissions();
        });
        const avatar = e.type === 'client' || e.type === 'thread';
        return (
          <div key={`${e.type}-${e.id}-${i}`} className="km-srn-ent">
            <button type="button" className="km-srn-ent-main km-press" onClick={openIt} style={{ textAlign: 'left' }}>
              {avatar ? <Avatar name={e.name} seed={e.clientId || e.id} size={32} /> : (
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'transparent', boxShadow: 'inset 0 0 0 var(--hairline) var(--lineHi)', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={e.type === 'listing' ? 'house' : e.type === 'pipeline' ? 'pipeline' : 'dollar'} size={16} stroke={2} />
                </span>
              )}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="km-srn-ent-name km-truncate" style={{ display: 'block' }}>{e.name}</span>
                {e.sub ? <span className="km-srn-ent-sub km-truncate" style={{ display: 'block' }}>{e.sub}</span> : null}
              </span>
            </button>
            {e.type === 'client' && e.phone && (e.action === 'call' || e.action === 'open') ? (
              <button type="button" className="km-srn-ent-btn km-srn-ent-btn--call" aria-label={`Call ${e.name}`} onClick={() => onHandoff(() => nav.call({ clientId: e.id, phone: e.phone, name: e.name }))}>
                <Icon name="phone" size={15} stroke={2} />
              </button>
            ) : null}
            {(e.type === 'client' && e.action !== 'open') || e.type === 'thread' ? (
              <button type="button" className="km-srn-ent-btn" aria-label={`Text ${e.name}`} onClick={() => onHandoff(() => nav.openThread(e.type === 'thread' ? { conversationId: e.id, clientId: e.clientId || undefined } : { clientId: e.id }))}>
                <Icon name="message" size={15} stroke={2} />
              </button>
            ) : null}
            {e.type !== 'client' && e.type !== 'thread' ? <Icon name="chevronRight" size={15} color="var(--faint)" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function AssistantMessage({ msg, grouped, isLast, onHandoff, onOpenCard }) {
  const running = msg.status === 'running';
  const hasText = !!(msg.text && msg.text.trim());
  const showTyping = running && !hasText;
  return (
    <div className={`km-srn-row ${grouped ? 'km-srn-row--grouped' : ''}`}>
      <span style={{ width: 22, flexShrink: 0, alignSelf: 'flex-start', marginTop: 2 }}>
        {!grouped ? <SerenaAvatar size={22} thinking={running} /> : null}
      </span>
      <div className="km-srn-col">
        <ActivityLines activity={msg.activity} live={running} />
        {showTyping ? (
          <div className="km-srn-bub km-srn-bub--srn" style={{ padding: 0 }}><div className="km-srn-typing"><span /><span /><span /></div></div>
        ) : hasText ? (
          <div className={`km-srn-bub km-srn-bub--srn km-selectable ${msg.status === 'error' ? 'km-srn-bub--error' : ''} ${running ? 'km-srn-caret' : ''}`}>
            <Markdown text={msg.text} />
          </div>
        ) : null}
        {(msg.cards || []).map((c) => <SerenaActionCard key={c.id} card={c} onOpen={onOpenCard} />)}
        {(msg.proposals || []).map((p) => <SerenaProposalCard key={p.id} proposal={p} onHandoff={onHandoff} />)}
        <Entities items={msg.entities} onHandoff={onHandoff} />
        {isLast && !running && msg.suggestions && msg.suggestions.length && !((msg.cards || []).length && msg.cards.every((c) => c.undone)) ? (
          <div className="km-srn-chips">
            {msg.suggestions.slice(0, 3).map((t) => (
              <button key={t} type="button" className="km-srn-chip" onClick={() => serena.send(t)}>
                <Icon name="sparkle" size={11} stroke={2} />{t}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
