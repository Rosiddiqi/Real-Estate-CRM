// AutomationsTab — the Inbox "Automations" tab (RevMatch inbox automations
// lane): the AI texting master switch, the Sender Guard, replies waiting for
// your OK, the default automations with their switches + editors, the
// campaigns that are running, and the campaign-born threads still waiting on a
// first reply (a reply moves the thread to the main inbox, lane 'active').
//
// Works standalone inside any scroll container. Inside the Inbox
// (.km-inbox-autos) the inbox renders those threads itself below this block, so
// the thread list here only shows standalone — or force it with showThreads.
import { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Button, Skeleton, SkeletonRows, Switch } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { relativeTime } from '../../lib/format';
import { haptic } from '../../lib/native';
import { getAiPause, setAiPause } from '../../api/campaigns';
import { SectionRule, StatusPill, MonoLabel, InfoNote, LaneTally, NeedsLineBanner, campaignPhase, fmtIn } from './kit';
import { AutomationRow, TEMPLATE_ICON } from './CampaignCard';
import SenderGuardCard from './SenderGuardCard';
import SuggestionCard from './SuggestionCard';
import AutomationEditor from './AutomationEditor';
import { useCampaignTz } from './tz';
import { useAutomations, useAutomationToggle, useCampaignList, useLiveThreads, useLoader, useMessagingMode, useSuggestions } from './useCampaignsData';
import { tone } from '../../lib/palette';

const OFF_KEY = 'km.autos.showOff';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* per-viewer convenience only */ } };

// The master switch for everything automated (campaigns + automations).
function AiSwitch({ needsLine = false }) {
  const st = useLoader(() => getAiPause(), [], { poll: 60000 });
  const [busy, setBusy] = useState(false);
  if (!st.data) {
    if (st.error) return null;
    return <Skeleton h={62} r={14} />;
  }
  const paused = !!st.data.paused;
  const toggle = async (on) => {
    const prev = st.data;
    st.setData((d) => ({ ...(d || {}), paused: !on, pausedAt: on ? null : new Date().toISOString() }));
    setBusy(true);
    try {
      const d = await setAiPause(!on);
      st.setData(d);
      haptic(on ? 'success' : 'light');
      toast.success(on ? 'AI texting is back on' : 'AI texting paused. Nothing automated goes out');
    } catch (e) {
      st.setData(prev);
      toast.error(e.message || 'Could not update');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kp-auto" style={{ '--kp-accent': paused ? 'var(--amber)' : 'var(--text)' }}>
      <span className="kp-auto-tile"><Icon name={paused ? 'pause' : 'sparkle'} size={17} stroke={2} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>AI texting</span>
        <span style={{ display: 'block', fontSize: 12, color: paused ? 'var(--amber)' : 'var(--dim)', marginTop: 1, lineHeight: 1.35 }}>
          {paused
            ? `Paused${st.data.pausedAt ? ` ${relativeTime(st.data.pausedAt)}` : ''}${st.data.heldCount ? ` · ${st.data.heldCount} held` : ''}. Nothing automated goes out`
            : needsLine ? 'On, but nothing sends until a business texting line is connected'
              : 'On. Campaigns and automations send through the Sender Guard'}
        </span>
      </span>
      <Switch checked={!paused} disabled={busy} onChange={toggle} label={paused ? 'AI texting paused' : 'AI texting on'} />
    </div>
  );
}

function CampaignLine({ c }) {
  const s = c.stats || {};
  const phase = campaignPhase(c);
  const sub = c.status === 'scheduled'
    ? `Starts ${fmtIn(c.launchedAt || (c.schedule && c.schedule.startAt))}`
    : `${s.sent || 0}/${s.total || 0} sent${s.sent ? ` · ${Math.round(s.replyRate || 0)}% replied` : ''}`;
  return (
    <button type="button" className="kp-li km-press" onClick={() => nav.openCampaign(c.id)}>
      <span className="kp-auto-tile" style={{ '--kp-accent': tone(c.accent, 'var(--text)'), width: 34, height: 34, borderRadius: 10 }}>
        <Icon name={TEMPLATE_ICON[c.trigger] || 'send'} size={15} stroke={2} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{c.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dim)', marginTop: 1, minWidth: 0 }}>
          <span className="km-truncate">{sub}</span>
          <LaneTally lanes={s.lanes} size={6} />
        </span>
      </span>
      <StatusPill status={phase} />
    </button>
  );
}

function ThreadGroups({ groups }) {
  return groups.map((g) => (
    <div key={g.source.id} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 7px' }}>
        <span className="kp-dot" style={{ width: 6, height: 6, background: tone(g.source.accent) }} />
        <MonoLabel style={{ flex: 1, minWidth: 0 }}>{g.source.name} · {g.threads.length}</MonoLabel>
        {g.source.type === 'campaign' && g.source.id !== 'other' ? (
          <button type="button" onClick={() => nav.openCampaign(g.source.id)} style={{ fontSize: 12, fontWeight: 500, color: 'var(--bright)' }}>Open</button>
        ) : null}
      </div>
      <div className="kp-list">
        {g.threads.map((t) => (
          <button key={t.conversationId} type="button" className="kp-li km-press" onClick={() => nav.openThread({ conversationId: t.conversationId, clientId: t.clientId, name: t.name })}>
            <Avatar name={t.name} seed={t.clientId || t.conversationId} src={t.avatarUrl} size={38} channel={t.channel} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="km-truncate" style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: t.unreadCount ? 700 : 600 }}>{t.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)', flexShrink: 0 }}>{relativeTime(t.lastMessageAt)}</span>
              </span>
              <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{t.preview || 'Campaign text'}</span>
              {t.nextSendAt ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>Next text {fmtIn(t.nextSendAt)}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  ));
}

export default function AutomationsTab({ showThreads, padded = true, style }) {
  useCampaignTz();
  const rootRef = useRef(null);
  const [inInbox, setInInbox] = useState(false);
  useLayoutEffect(() => {
    setInInbox(!!(rootRef.current && rootRef.current.closest('.km-inbox-autos')));
  }, []);
  const threadsHere = showThreads != null ? !!showThreads : !inInbox;

  const autos = useAutomations();
  const sugg = useSuggestions();
  const list = useCampaignList();
  const live = useLiveThreads();
  const [editing, setEditing] = useState(null);
  const [showOff, setShowOff] = useState(() => lsGet(OFF_KEY) === '1');
  const [allSugg, setAllSugg] = useState(false);
  const { busyId, toggle } = useAutomationToggle(autos, setEditing);
  const needsLine = useMessagingMode() === 'device';

  const automations = (autos.data && autos.data.automations) || [];
  const on = automations.filter((a) => a.enabled);
  const off = automations.filter((a) => !a.enabled);
  // With nothing on yet, show everything: that's the moment to pick some.
  const visibleAutos = !on.length || showOff ? automations : on;
  const suggestions = (sugg.data && sugg.data.suggestions) || [];
  const campaigns = ((list.data && list.data.campaigns) || []).filter((c) => ['running', 'paused', 'scheduled'].includes(c.status));
  const groups = (live.data && live.data.groups) || [];
  const threadTotal = (live.data && live.data.total) || 0;

  const setOff = (v) => { setShowOff(v); lsSet(OFF_KEY, v ? '1' : '0'); };

  return (
    <div ref={rootRef} style={{ padding: padded ? '0 16px' : 0, ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
        {needsLine ? <NeedsLineBanner /> : null}
        <AiSwitch needsLine={needsLine} />
        <SenderGuardCard />
      </div>

      {suggestions.length ? (
        <>
          <SectionRule label="Waiting for your OK" count={suggestions.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(allSugg ? suggestions : suggestions.slice(0, 3)).map((s) => (
              <SuggestionCard key={s.id} s={s}
                onResolved={(id) => sugg.setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((x) => x.id !== id) } : d))}
                onRestore={() => sugg.reload()} />
            ))}
          </div>
          {suggestions.length > 3 ? (
            <button type="button" onClick={() => setAllSugg((v) => !v)} style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: 'var(--bright)' }}>
              {allSugg ? 'Show fewer' : `Show all ${suggestions.length}`}
            </button>
          ) : null}
        </>
      ) : null}

      <SectionRule
        label="Automations"
        count={automations.length ? `${on.length} on` : null}
        action={<button type="button" onClick={() => nav.openCampaigns()} style={{ fontSize: 12, fontWeight: 500, color: 'var(--bright)', flexShrink: 0 }}>Campaigns</button>}
      />
      {autos.loading && !autos.data ? <SkeletonRows n={3} /> : null}
      {autos.error && !autos.data ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--dim)' }}>
          Couldn’t load automations.
          <Button size="sm" variant="ghost" onClick={autos.reload}>Try again</Button>
        </div>
      ) : null}
      {!on.length && automations.length ? (
        <div style={{ margin: '-2px 2px 10px', fontSize: 12.5, lineHeight: 1.45, color: 'var(--faint)' }}>
          Always-on texts that fire on a trigger. Turn one on and your AI writes each person their own text. Every one still passes the Sender Guard.
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleAutos.map((a, i) => (
          <AutomationRow key={a.id} automation={a} index={i} busy={busyId === a.id} held={needsLine && a.enabled} onToggle={toggle} onOpen={() => setEditing(a)} />
        ))}
      </div>
      {on.length && off.length ? (
        <button type="button" className="km-press" onClick={() => setOff(!showOff)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, fontWeight: 500, color: 'var(--bright)' }}>
          <Icon name={showOff ? 'chevronUp' : 'chevronDown'} size={14} />
          {showOff ? 'Hide the ones that are off' : `${off.length} more ${off.length === 1 ? 'automation' : 'automations'} you can turn on`}
        </button>
      ) : null}

      {campaigns.length ? (
        <>
          <SectionRule label="Campaigns" count={campaigns.length}
            action={<button type="button" onClick={() => nav.newCampaign()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--bright)', flexShrink: 0 }}><Icon name="plus" size={13} />New</button>} />
          <div className="kp-list">
            {campaigns.slice(0, 5).map((c) => <CampaignLine key={c.id} c={c} />)}
          </div>
          {campaigns.length > 5 ? (
            <button type="button" onClick={() => nav.openCampaigns()} style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: 'var(--bright)' }}>All campaigns</button>
          ) : null}
        </>
      ) : null}

      {threadsHere ? (
        <>
          <SectionRule label="Waiting on a first reply" count={threadTotal || null} />
          {live.loading && !live.data ? <SkeletonRows n={3} /> : null}
          {live.data && !groups.length ? (
            <div style={{ textAlign: 'center', padding: '20px 14px', borderRadius: 14, border: '1px dashed var(--line)', fontSize: 13, lineHeight: 1.45, color: 'var(--faint)' }}>
              No campaign threads waiting. When a campaign or automation texts someone, the thread waits here until they reply.
            </div>
          ) : null}
          <ThreadGroups groups={groups} />
          <InfoNote kind="route" style={{ marginTop: 6, marginBottom: 12 }}>A reply moves the thread to your inbox and the conversation is yours.</InfoNote>
        </>
      ) : (
        <InfoNote kind="route" style={{ marginTop: 16, marginBottom: 6 }}>
          {threadTotal
            ? `${threadTotal} ${threadTotal === 1 ? 'thread' : 'threads'} below ${threadTotal === 1 ? 'is' : 'are'} waiting on a first reply. A reply moves the thread to Clients and the conversation is yours.`
            : 'Campaign threads wait here until someone replies. A reply moves the thread to Clients and the conversation is yours.'}
        </InfoNote>
      )}

      <AutomationEditor automation={editing} open={!!editing} onClose={() => setEditing(null)} onSaved={() => autos.reload()} />
    </div>
  );
}
