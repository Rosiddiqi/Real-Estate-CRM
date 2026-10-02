// Quick Text (overlay `quickText`) — a floating sheet holding the real thread
// for one client, so a text goes out without leaving the current screen
// (battle plan, matchmaker, client list…). Seeded with `body`; "Draft with AI"
// writes one from `context` (deterministic fallback without AI) and drops it in
// the composer for approval — never auto-sent. Props: { clientId, body, context }.
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { Spinner, EmptyState } from '../ui/kit';
import { nav } from '../../lib/nav';
import { conversationByClient } from '../../api/conversations';
import { draftText } from '../../api/messages';
import { toast } from '../ui/toast';
import ThreadView from './ThreadView';
import { channelLabel } from './threadUtils';
import '../../styles/thread.css';

export default function QuickTextSheet({ clientId, body, context, onClose }) {
  const [open, setOpen] = useState(true);
  const [info, setInfo] = useState(null); // { name, channel, phone }
  const [missing, setMissing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const composerRef = useRef(null);
  const [conv, setConv] = useState(null);

  useEffect(() => {
    if (!clientId) { setMissing(true); return undefined; }
    let alive = true;
    conversationByClient(clientId)
      .then((r) => {
        if (!alive) return;
        const c = r && r.client;
        if (!c) { setMissing(true); return; }
        const channel = (r.conversation && r.conversation.channel) || (c.deviceMode === 'sms' ? 'sms' : 'imessage');
        setInfo({ name: c.name, phone: c.phone, channel });
      })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [clientId]);

  const leave = (then) => {
    setOpen(false);
    setTimeout(() => { onClose && onClose(); if (then) then(); }, 250);
  };

  const draft = async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const r = await draftText({ clientId, context: context || undefined, conversationId: conv ? conv.id : undefined });
      if (r && r.text && composerRef.current) composerRef.current.setText(r.text);
    } catch {
      toast.error('Couldn’t draft that one — try again');
    } finally {
      setDrafting(false);
    }
  };

  const first = info && info.name ? String(info.name).split(' ')[0] : '';
  const channel = info ? info.channel : 'imessage';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={info ? info.name : 'Quick Text'}
      subtitle={info ? (info.phone ? channelLabel(channel === 'sms' ? 'sms' : 'imsg') : 'No mobile number') : undefined}
      left={{ label: 'Close', onClick: () => leave() }}
      right={info && clientId ? { label: 'Open', onClick: () => leave(() => nav.openThread({ clientId, name: info.name })) } : undefined}
      padded={false}
      maxHeight="88%"
    >
      {missing ? (
        <EmptyState icon="user" title="Client not found" sub="They may have been removed. Search your clients and try again." />
      ) : !info ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
      ) : !info.phone ? (
        <EmptyState
          icon="phone"
          title={`No mobile number for ${first || 'this client'}`}
          sub="Add one on their card to text them."
          action={<button type="button" className="km-btn km-btn--ghost km-btn--sm" onClick={() => leave(() => nav.openClient(clientId))}>Open Client Card</button>}
        />
      ) : (
        <div className="km-qt-wrap">
          <div className="km-qt-bar">
            <span className="km-qt-about">{context ? `About: ${context}` : `Text ${first} without leaving this screen`}</span>
            <button type="button" className="km-qt-ai km-lg km-press" onClick={draft} disabled={drafting}>
              {drafting ? <Spinner size={13} /> : <Icon name="sparkle" size={14} stroke={2} />}
              {drafting ? 'Drafting…' : 'Draft with AI'}
            </button>
          </div>
          <div className="km-qt-thread">
            <ThreadView
              clientId={clientId}
              name={info.name}
              variant="sheet"
              showBriefing={false}
              initialDraft={body}
              composerRef={composerRef}
              autoFocus={!body}
              onConversation={setConv}
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}
