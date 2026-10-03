// SerenaProposalCard — anything customer-facing Serena drafted. Co-pilot, not
// autopilot: Preview → Edit → Send, and it only ever sends on the agent's tap
// (through the inbox's send pipeline), or hands the draft to the thread.
// Campaign drafts open the builder; they never launch from here.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { formatPhone, formatTime } from '../../lib/format';
import { haptic } from '../../lib/native';
import { serena } from './serenaStore';

const ClientPicker = lazy(() => import('../client/ClientPicker'));

// Bubble fill + its text colour, and the label tint (Soul: monochrome
// channels — iMessage white, SMS graphite, email a lighter graphite).
const CHANNEL = {
  imessage: { label: 'iMessage', color: 'var(--imsg)', text: 'var(--imsg-text)', tint: 'var(--text)' },
  sms: { label: 'SMS', color: 'var(--sms)', text: 'var(--sms-text)', tint: 'var(--dim)' },
  email: { label: 'Email', color: 'var(--email-bubble, #262626)', text: 'var(--email-text, #fff)', tint: 'var(--dim)' },
};

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`;
}

export default function SerenaProposalCard({ proposal: p, onHandoff }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(p.body || '');
  const [subject, setSubject] = useState(p.subject || '');
  const [picking, setPicking] = useState(false);
  const ta = useRef(null);

  useEffect(() => { if (!editing) { setBody(p.body || ''); setSubject(p.subject || ''); } }, [p.body, p.subject, editing]);
  useEffect(() => { if (editing) { autoGrow(ta.current); ta.current?.focus(); } }, [editing]);

  const status = p.status || 'pending';
  const done = status === 'sent' || status === 'opened';
  const dismissed = status === 'dismissed';

  if (p.kind === 'campaign') return <CampaignDraft p={p} onHandoff={onHandoff} />;

  const ch = CHANNEL[p.kind === 'email' ? 'email' : p.channel] || CHANNEL.imessage;
  const hasRecipient = !!p.clientId;

  const saveEdit = () => {
    setEditing(false);
    if (body !== p.body || subject !== (p.subject || '')) serena.decide(p.id, 'edit', { body, ...(p.kind === 'email' ? { subject } : {}) }).catch(() => {});
  };

  const openThread = () => {
    serena.decide(p.id, 'opened', { body }).catch(() => {});
    onHandoff(() => nav.openThread({ clientId: p.clientId, conversationId: p.conversationId || undefined, draft: body }));
  };

  const send = async () => {
    if (!hasRecipient) { setPicking(true); return; }
    try {
      const out = await serena.decide(p.id, 'send', { body, ...(p.kind === 'email' ? { subject } : {}) });
      setEditing(false);
      haptic('success');
      const first = p.clientName ? p.clientName.split(' ')[0] : 'them';
      // No business line: hand it to Messages / Mail on this phone (recorded as sent from your phone).
      const handoffUrl = out && (out.smsUrl || out.mailtoUrl);
      if (handoffUrl) {
        if (out.notice) toast(out.notice);
        else toast.success(`Opening ${out.mailtoUrl ? 'Mail' : 'Messages'} for ${first}…`);
        window.location.href = handoffUrl;
      } else {
        toast.success(`Sent to ${first}`);
      }
    } catch (err) {
      if (err && err.status === 501) {
        if (p.kind === 'email' && p.to) { window.location.href = `mailto:${p.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; return; }
        openThread();
        return;
      }
      if (p.kind === 'email' && p.to) {
        toast.error('Email sending isn’t connected — opening your mail app.');
        window.location.href = `mailto:${p.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        return;
      }
      toast.error(err.message || 'Couldn’t send that');
    }
  };

  const onPick = (client) => {
    setPicking(false);
    if (!client) return;
    const first = client.firstName || (client.name || '').split(' ')[0] || '';
    const personalized = body.startsWith('Just listed') && first ? `Hi ${first}, j${body.slice(1)}` : body;
    setBody(personalized);
    serena.updateProposal(p.id, { clientId: client.id, clientName: client.displayName || [client.firstName, client.lastName].filter(Boolean).join(' ') || client.name, to: client.phone ? formatPhone(client.phone) : null, body: personalized });
    serena.decide(p.id, 'edit', { clientId: client.id, body: personalized }).catch(() => {});
  };

  return (
    <div className={`km-srn-prop ${dismissed ? 'is-dismissed' : ''}`}>
      <div className="km-srn-prop-head">
        <Icon name={p.kind === 'email' ? 'mail' : 'message'} size={14} color="var(--srn-violet)" stroke={2} />
        <span className="km-srn-prop-eyebrow km-truncate">
          {done ? (status === 'sent' ? (p.via === 'device' ? 'Sent from your phone' : `Sent · ${p.kind === 'email' ? 'email' : 'text'}`) : 'Opened in thread') : dismissed ? 'Draft dismissed' : `Draft ${p.kind === 'email' ? 'email' : 'text'} · needs your OK`}
        </span>
        {!done && !dismissed ? (
          <button type="button" aria-label="Dismiss draft" onClick={() => serena.decide(p.id, 'dismiss').catch(() => {})} style={{ color: 'var(--faint)', padding: 2 }}>
            <Icon name="x" size={15} stroke={2} />
          </button>
        ) : null}
      </div>

      <div className="km-srn-prop-to">
        {hasRecipient ? (
          <>
            <Avatar name={p.clientName} seed={p.clientId} size={30} channel={p.kind === 'email' ? undefined : p.channel} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="km-truncate" style={{ fontSize: 14, fontWeight: 500 }}>{p.clientName}</div>
              <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
                <span style={{ color: ch.tint, fontWeight: 500 }}>{ch.label}</span>
                {p.to ? ` · ${p.to}` : ''}
                {p.listingLabel ? ` · ${p.listingLabel}` : ''}
              </div>
            </div>
          </>
        ) : (
          <button type="button" className="km-srn-ghost km-srn-ghost--blue" onClick={() => setPicking(true)} disabled={done || dismissed}>
            <Icon name="userPlus" size={14} stroke={2} /> Choose who it goes to
          </button>
        )}
      </div>

      {p.kind === 'email' ? (
        <div style={{ padding: '0 12px 12px' }}>
          {editing ? (
            <>
              <input className="km-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" style={{ minHeight: 38, padding: '8px 12px', marginBottom: 8 }} />
              <textarea ref={ta} className="km-srn-prop-edit" value={body} onChange={(e) => { setBody(e.target.value); autoGrow(e.target); }} />
            </>
          ) : (
            <div className="km-selectable" style={{ borderRadius: 12, border: '1px solid var(--srn-hair2)', padding: '10px 12px', background: 'var(--srn-ghost)' }}>
              <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 4 }}>{subject || '(no subject)'}</div>
              <div style={{ fontSize: 13.5, color: 'var(--dim)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{body}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="km-srn-prop-body">
          {editing ? (
            <textarea ref={ta} className="km-srn-prop-edit" value={body} onChange={(e) => { setBody(e.target.value); autoGrow(e.target); }} />
          ) : (
            <div className="km-srn-prop-bubble km-selectable" style={{ background: ch.color, color: ch.text }}>{body}</div>
          )}
          {!editing && p.reason ? <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>{p.reason}</div> : null}
        </div>
      )}

      {p.sendError ? <div className="km-srn-err" style={{ margin: '0 12px 10px' }}>{p.sendError}</div> : null}

      {done ? (
        <div className="km-srn-prop-done">
          <Icon name="checkCircle" size={15} stroke={2.2} />
          <span style={{ flex: 1 }}>{status === 'sent' ? `${p.via === 'device' ? `Handed to ${p.kind === 'email' ? 'Mail' : 'Messages'}` : 'Sent'}${p.decidedAt ? ` · ${formatTime(p.decidedAt)}` : ''}` : 'Waiting in the thread'}</span>
          {p.kind !== 'email' && p.clientId ? (
            <button type="button" className="km-srn-ghost km-srn-ghost--blue" onClick={() => onHandoff(() => nav.openThread({ clientId: p.clientId, conversationId: p.conversationId || undefined }))}>View thread</button>
          ) : null}
        </div>
      ) : dismissed ? null : (
        <div className="km-srn-prop-actions">
          {editing ? (
            <button type="button" className="km-srn-ghost" onClick={saveEdit}><Icon name="check" size={13} stroke={2.4} /> Done</button>
          ) : (
            <button type="button" className="km-srn-ghost" onClick={() => setEditing(true)}><Icon name="edit" size={13} stroke={2.2} /> Edit</button>
          )}
          {p.kind !== 'email' && hasRecipient ? (
            <button type="button" className="km-srn-ghost" onClick={openThread} title="Open in the thread to send from there">
              <Icon name="messageSquare" size={13} stroke={2.2} /> Thread
            </button>
          ) : null}
          <button type="button" className="km-srn-send" onClick={send} disabled={p.sending || !body.trim()}>
            {p.sending ? <Spinner size={14} color="#fff" /> : <Icon name="arrowUp" size={14} stroke={2.6} />}
            {hasRecipient ? 'Send' : 'Choose & send'}
          </button>
        </div>
      )}

      {picking ? (
        <Suspense fallback={null}>
          <ClientPicker open={picking} onClose={() => setPicking(false)} onPick={onPick} kind="client" title="Who should it go to?" allowCreate={false} />
        </Suspense>
      ) : null}
    </div>
  );
}

function CampaignDraft({ p, onHandoff }) {
  const dismissed = p.status === 'dismissed';
  const opened = p.status === 'opened';
  const open = () => {
    serena.decide(p.id, 'opened').catch(() => {});
    onHandoff(() => nav.newCampaign({ name: p.name, brief: p.brief, audience: p.audience, trigger: p.trigger || undefined, listingId: p.listingId || undefined, source: 'serena' }));
  };
  return (
    <div className={`km-srn-prop ${dismissed ? 'is-dismissed' : ''}`}>
      <div className="km-srn-prop-head">
        <Icon name="send" size={14} color="var(--srn-violet)" stroke={2} />
        <span className="km-srn-prop-eyebrow km-truncate">{dismissed ? 'Campaign draft dismissed' : 'Campaign draft · not launched'}</span>
        {!dismissed ? (
          <button type="button" aria-label="Dismiss" onClick={() => serena.decide(p.id, 'dismiss').catch(() => {})} style={{ color: 'var(--faint)', padding: 2 }}>
            <Icon name="x" size={15} stroke={2} />
          </button>
        ) : null}
      </div>
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{p.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.4 }}><span style={{ color: 'var(--faint)', fontWeight: 500 }}>Audience · </span>{p.audience}</div>
        <div className="km-selectable" style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.4 }}><span style={{ color: 'var(--faint)', fontWeight: 500 }}>Brief · </span>{p.brief}</div>
      </div>
      {!dismissed ? (
        <div className="km-srn-prop-actions">
          <button type="button" className="km-srn-send" onClick={open}>
            <Icon name="arrowUpRight" size={14} stroke={2.4} /> {opened ? 'Open the builder again' : 'Review in campaign builder'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
