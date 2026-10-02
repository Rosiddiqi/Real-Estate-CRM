// SuggestionCard — an AI draft waiting for the agent's tap (draft-first,
// always): a reply to an on-topic campaign question, or a draft-mode
// automation text. Approve (optionally edited) → it goes out through the
// Sender Guard. "Needs you" cards are the agent's to answer in the thread.
import { useState } from 'react';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { Button } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { relativeTime } from '../../lib/format';
import { haptic } from '../../lib/native';
import { approveSuggestion, dismissSuggestion } from '../../api/campaigns';
import { MonoLabel, fmtWhen } from './kit';
import { useMessagingMode } from './useCampaignsData';

export default function SuggestionCard({ s, onResolved, onRestore, showCampaign = true }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.text || '');
  const [busy, setBusy] = useState(false);
  const needs = s.abstain || !s.text;
  // No business texting line ('device' mode): the draft goes to the thread
  // composer and the agent sends it from their phone.
  const deviceMode = useMessagingMode() === 'device';
  const sendFromThread = () => nav.openThread({ conversationId: s.conversationId || undefined, clientId: s.clientId, name: s.clientName, draft: text });

  const openThread = () => nav.openThread({ conversationId: s.conversationId || undefined, clientId: s.clientId, name: s.clientName });

  const approve = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    onResolved && onResolved(s.id); // optimistic
    try {
      const r = await approveSuggestion(s.id, editing || text !== s.text ? text : undefined);
      haptic('success');
      toast.success(r.waiting ? `Approved · goes out ${fmtWhen(r.sendsAt)} (${r.waiting.toLowerCase()})` : `Sending to ${s.clientName.split(' ')[0]}`);
    } catch (e) {
      onRestore && onRestore(s);
      toast.error(e.message || 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    onResolved && onResolved(s.id);
    try {
      await dismissSuggestion(s.id);
      toast(needs ? 'Cleared' : 'Draft dismissed', { action: { label: 'Open thread', onClick: openThread } });
    } catch (e) {
      onRestore && onRestore(s);
      toast.error(e.message || 'Could not dismiss');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`kc-approve ${needs ? 'kc-approve--needs' : ''} kc-step-in`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={s.clientName} seed={s.clientId} size={32} onClick={() => s.clientId && nav.openClient(s.clientId)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="km-truncate" style={{ fontSize: 14, fontWeight: 600 }}>{s.clientName}</div>
          <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            {s.kind === 'automation_draft' ? 'Automation draft' : needs ? 'Needs you' : 'Reply ready'}
            {showCampaign && s.campaignName ? ` · ${s.campaignName}` : ''} · {relativeTime(s.createdAt)}
          </div>
        </div>
        <button type="button" className="km-icon-btn km-icon-btn--sm km-press" onClick={openThread} aria-label="Open thread" style={{ background: 'var(--lg-fill)' }}>
          <Icon name="messageSquare" size={15} />
        </button>
      </div>

      {s.inboundText ? (
        <div style={{ display: 'flex', marginTop: 10 }}>
          <div className="km-selectable" style={{ maxWidth: '86%', padding: '8px 12px', borderRadius: '18px 18px 18px 5px', background: 'var(--bubble-in)', color: 'var(--bubble-in-text)', fontSize: 14.5, lineHeight: 1.38 }}>{s.inboundText}</div>
        </div>
      ) : null}

      {needs ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13, color: 'var(--amber)', lineHeight: 1.4 }}>
          <Icon name="alert" size={14} style={{ marginTop: 2 }} />
          <span>{s.abstainReason || 'Your AI could not answer this from the campaign details.'} Reply yourself in the thread.</span>
        </div>
      ) : editing ? (
        <textarea
          className="km-input"
          value={text}
          rows={3}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          style={{ marginTop: 10, minHeight: 84 }}
          aria-label="Edit reply"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 10 }}>
          <div className="kc-bubble km-selectable">{text}</div>
          <MonoLabel style={{ marginTop: 5 }}>{s.via === 'ai' ? 'Drafted by your AI' : 'Drafted from your campaign details'} · not sent</MonoLabel>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {needs ? (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>Clear</Button>
            <Button size="sm" onClick={openThread} icon="reply" style={{ flex: 1 }}>Reply in thread</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>Dismiss</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} disabled={busy} icon={editing ? 'check' : 'edit'}>{editing ? 'Done' : 'Edit'}</Button>
            {deviceMode ? (
              <Button size="sm" onClick={sendFromThread} disabled={!text.trim()} icon="reply" style={{ flex: 1 }}>Send from thread</Button>
            ) : (
              <Button size="sm" onClick={approve} loading={busy} disabled={!text.trim()} icon="send" style={{ flex: 1 }}>Approve & send</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
