// ThreadView — one conversation: bubbles + floating composer, embeddable.
//
//   <ThreadView conversationId={id} />                       (inbox thread)
//   <ThreadView clientId={id} embedded />                    (client card Timeline)
//   <ThreadView clientId={id} embedded timelineItems={[{id, at, node}]} topNode={<Pill/>} />
//
// Fills its parent (height: 100%) — give it a bounded-height flex parent.
// Props
//   conversationId | clientId | handle   which thread (a client with no thread
//                                         yet gets an empty thread; the first send creates it)
//   embedded        client-card mode (no briefing card; composer keyboard-aware)
//   variant         'panel' (default) | 'embedded' | 'sheet' | 'pane'
//   header          node floating over the top of the messages (measured)
//   timelineItems   [{ id, at: ISO, node }] merged by time as full-width rows
//   topNode         node pinned above the first message (e.g. "Added to KeyMatch")
//   initialDraft / initialListing   seed the composer once (AI drafts, matchmaker)
//   draftKey        override the per-thread draft key
//   onConversation  (conversation) => void when resolved / created by a first send
//   composerRef     ref → { focus, setText, setListing, hasContent } (AI drafts, async seeds)
//   showBriefing / showSuggestions
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nav } from '../../lib/nav';
import { confirm, toast } from '../ui/toast';
import Avatar from '../ui/Avatar';
import useThread from './useThread';
import MessageList from './MessageList';
import Composer from './Composer';
import ReplySuggestions from './ReplySuggestions';
import BriefingCard from './BriefingCard';
import MediaViewer from './MediaViewer';
import ScheduledSheet from './ScheduledSheet';
import { isTouchDevice, channelLabel } from './threadUtils';
import { useMessagingMode } from './messagingMode';
import Icon from '../ui/Icon';
import '../../styles/thread.css';

// While any thread is on screen the floating Serena bubble steps aside (it
// would sit on the composer). Ref-counted across simultaneous threads.
let openThreads = 0;
function useThreadBodyClass() {
  useEffect(() => {
    openThreads += 1;
    document.body.classList.add('km-thread-open');
    return () => {
      openThreads = Math.max(0, openThreads - 1);
      if (!openThreads) document.body.classList.remove('km-thread-open');
    };
  }, []);
}

export default function ThreadView({
  conversationId,
  clientId,
  handle,
  name,
  embedded = false,
  variant,
  header,
  showBriefing,
  showSuggestions = true,
  timelineItems,
  topNode,
  initialDraft,
  initialListing,
  draftKey,
  autoFocus = false,
  onConversation,
  composerRef: externalComposerRef,
  active = true,
  className = '',
  style,
}) {
  const mode = variant || (embedded ? 'embedded' : 'panel');
  const withTimeline = !(timelineItems || topNode); // the client card renders its own timeline
  const t = useThread({ conversationId, clientId, handle, timeline: withTimeline, active });
  const rootRef = useRef(null);
  const headerRef = useRef(null);
  const dockRef = useRef(null);
  const ownComposerRef = useRef(null);
  const composerRef = externalComposerRef || ownComposerRef;
  const [replyTo, setReplyTo] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [manage, setManage] = useState(null); // { item, action }
  const [boxFull, setBoxFull] = useState(false); // composer has content → chips step aside
  const touch = useMemo(() => isTouchDevice(), []);
  const deviceMode = useMessagingMode() === 'device';
  const [noteHidden, setNoteHidden] = useState(() => { try { return localStorage.getItem('km_device_note_hidden') === '1'; } catch { return false; } });
  useThreadBodyClass();

  const conv = t.conversation;
  const headerNode = typeof header === 'function' ? header({ conversation: conv, client: t.client, defaultService: t.defaultService }) : header;
  const displayName = name || (conv && conv.name) || (t.client && t.client.name) || 'New Message';
  const firstName = String(displayName).split(' ')[0];

  useEffect(() => { if (conv && onConversation) onConversation(conv); }, [conv && conv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const longThread = t.messages.filter((m) => !m.synthetic).length >= 24 || t.hasMore;
  const briefingOn = !!((showBriefing ?? (mode === 'panel' || mode === 'pane')) && conv && conv.clientId && !conv.isGroup);

  // ── measured chrome → CSS vars on the root (header height, composer dock) ─
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const inner = () => root.querySelector('.km-th-inner');
    const setVar = (name, px) => {
      const cur = root.style.getPropertyValue(name);
      const next = `${Math.round(px)}px`;
      if (cur === next) return;
      const el = inner();
      if (el) el.classList.add('km-th-inner--instant');
      root.style.setProperty(name, next);
      requestAnimationFrame(() => { if (el) el.classList.remove('km-th-inner--instant'); });
    };
    const measure = () => {
      setVar('--km-th-top', headerRef.current ? headerRef.current.getBoundingClientRect().height : 0);
      if (dockRef.current) setVar('--km-th-composer-h', dockRef.current.getBoundingClientRect().height);
    };
    const ro = new ResizeObserver(measure);
    if (headerRef.current) ro.observe(headerRef.current);
    if (dockRef.current) ro.observe(dockRef.current);
    measure();
    return () => ro.disconnect();
  }, [!!headerNode, briefingOn, deviceMode, noteHidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── message actions ─────────────────────────────────────────────────────
  const onCopy = useCallback(async (m) => {
    const text = m.body || '';
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    toast('Copied');
  }, []);

  const onDelete = useCallback(async (m) => {
    const ok = await confirm({
      title: 'Delete this message?',
      message: m.isFromMe && !m._optimistic ? 'It’s removed from KeyMatch. A text already delivered stays on their phone.' : undefined,
      confirmLabel: 'Delete Message',
      destructive: true,
    });
    if (ok) t.remove(m);
  }, [t]);

  const onSchedule = useCallback((m) => {
    const cid = (conv && conv.clientId) || clientId;
    nav.newAppointment({ clientId: cid || undefined, type: 'showing', notes: m.body ? `From text: “${m.body.slice(0, 200)}”` : undefined });
  }, [conv, clientId]);

  const onAskSerena = useCallback((m) => {
    nav.openSerena('chat', `Help me with this text from ${displayName}:\n\n"${(m.body || '').slice(0, 800)}"`);
  }, [displayName]);

  const onScheduledAction = useCallback(async (s, action) => {
    if (action === 'delete') {
      if (await confirm({ title: 'Delete this scheduled message?', confirmLabel: 'Delete Message', destructive: true })) t.cancelScheduled(s.id);
      return;
    }
    if (action === 'send') { t.sendScheduledNow(s.id); return; }
    setManage({ item: s, action: action === 'open' ? null : action });
  }, [t]);

  const send = useCallback((draft) => t.send(draft), [t]);

  // ── reply chips: only for an unanswered inbound, while the box is empty ──
  const lastReal = useMemo(() => {
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (!m.synthetic && m.kind !== 'activity' && m.kind !== 'call') return m;
    }
    return null;
  }, [t.messages]);
  const lastInboundId = lastReal && lastReal.isFromMe === false && !lastReal.synthetic ? lastReal.id : null;
  const chipsOn = showSuggestions && !boxFull && !!t.conversationId && !!lastInboundId && !(conv && conv.isGroup);


  const kbAware = mode === 'panel' || mode === 'embedded';
  // No business line: every text is handed to the phone's Messages app.
  const openLineSettings = () => nav.openSettings('messaging');
  const hideNote = () => { setNoteHidden(true); try { localStorage.setItem('km_device_note_hidden', '1'); } catch { /* ignore */ } };
  const deviceNote = deviceMode && !noteHidden ? (
    <div className={`km-th-device ${headerNode ? '' : 'km-th-device--dock'}`} role="note">
      <Icon name="info" size={13} stroke={2.2} />
      {headerNode ? (
        <span>
          Texts go out from your Messages app. Replies stay on your phone —{' '}
          <a className="km-th-device-link" role="button" tabIndex={0} onClick={openLineSettings} onKeyDown={(e) => { if (e.key === 'Enter') openLineSettings(); }}>connect a business line in Settings</a>
          {' '}to text from KeyMatch.
        </span>
      ) : (
        <span>
          Sends from your phone’s Messages app ·{' '}
          <a className="km-th-device-link" role="button" tabIndex={0} onClick={openLineSettings} onKeyDown={(e) => { if (e.key === 'Enter') openLineSettings(); }}>Business line</a>
        </span>
      )}
      <button type="button" className="km-th-device-x" aria-label="Got it — hide this note" onClick={hideNote}>
        <Icon name="x" size={12} stroke={2.6} />
      </button>
    </div>
  ) : null;
  const channel = t.defaultService === 'sms' ? 'sms' : 'imsg';

  const emptyNode = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 24px 8px', textAlign: 'center' }}>
      <Avatar name={displayName} seed={(conv && conv.clientId) || clientId || handle} size={64} />
      <div style={{ fontSize: 17, fontWeight: 600 }}>{displayName}</div>
      <div style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 260 }}>
        {t.error ? 'Couldn’t load this conversation. Pull to retry or check your connection.' : `No messages yet. Say hi — it goes out as ${channel === 'sms' ? 'a Text Message' : 'an iMessage'}.`}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`km-thread km-thread--${mode} ${kbAware ? 'km-thread--kb' : ''} ${touch ? 'km-thread--touch' : ''} ${mode === 'panel' || mode === 'pane' ? 'km-th-wide' : ''} ${className}`}
      style={style}
    >
      <MessageList
        items={t.messages}
        timelineItems={timelineItems}
        topNode={topNode}
        scheduled={t.scheduled}
        typing={t.typing}
        loading={t.loading}
        hasMore={t.hasMore}
        onLoadOlder={t.loadOlder}
        didSend={t.didSend}
        arrived={t.arrived}
        conversationKey={t.conversationId || clientId || handle || 'new'}
        isGroup={!!(conv && conv.isGroup)}
        participants={conv && conv.participants}
        emptyNode={emptyNode}
        onRetry={t.retry}
        onReact={t.react}
        onReply={(m) => setReplyTo(m)}
        onCopy={onCopy}
        onDelete={onDelete}
        onSchedule={(conv && conv.clientId) || clientId ? onSchedule : null}
        onAskSerena={onAskSerena}
        onScheduledAction={onScheduledAction}
        onOpenMedia={(items, index) => setViewer({ items, index })}
      />

      {headerNode || briefingOn ? (
        <div ref={headerRef} className={headerNode ? 'km-th-header' : ''} style={headerNode ? undefined : { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 25, pointerEvents: 'none' }}>
          {headerNode ? (
            <>
              {/* Scroll-edge: blur + fade behind the floating controls so bubbles
                  passing under the name pill never read as crisp text. */}
              <div className="km-th-blur" aria-hidden="true" />
              <div className="km-th-scrim" aria-hidden="true" />
            </>
          ) : null}
          {headerNode}
          {headerNode ? deviceNote : null}
          {briefingOn ? (
            <div style={{ pointerEvents: 'auto' }}>
              <BriefingCard conversationId={conv.id} longThread={longThread} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="km-th-footer-tint" aria-hidden="true" />
      <div className="km-composer-dock" ref={dockRef}>
        {!headerNode ? deviceNote : null}
        {chipsOn ? (
          <ReplySuggestions
            conversationId={t.conversationId}
            lastInboundId={lastInboundId}
            onPick={(text) => composerRef.current && composerRef.current.setText(text)}
          />
        ) : null}
        <Composer
          ref={composerRef}
          draftKey={draftKey || t.conversationId || (clientId ? `client:${clientId}` : handle ? `handle:${handle}` : 'new-message')}
          initialText={initialDraft}
          initialListing={initialListing}
          defaultService={t.defaultService}
          onSend={send}
          onTyping={t.emitTyping}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          autoFocus={autoFocus}
          name={firstName}
          placeholder={t.defaultService === 'sms' ? channelLabel('sms') : 'iMessage'}
          onContentChange={setBoxFull}
          allowSchedule={!deviceMode}
          allowFiles={!deviceMode}
          allowVoice={!deviceMode}
        />
      </div>

      {viewer ? <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} /> : null}
      <ScheduledSheet
        item={manage && manage.item}
        initialAction={manage && manage.action}
        onClose={() => setManage(null)}
        onUpdate={t.updateScheduled}
        onCancel={t.cancelScheduled}
        onSendNow={t.sendScheduledNow}
      />
    </div>
  );
}

// The client card checks this before rendering its own fallback activity strip.
ThreadView.supportsTimeline = true;

