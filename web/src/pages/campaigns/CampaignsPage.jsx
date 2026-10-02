// Campaigns — the builder hub (side-drawer menu page, RevMatch pages/Campaigns):
// the Sender Guard card, "New text campaign", replies awaiting approval,
// campaigns bucketed Running · Scheduled · Drafts · Completed, and the default
// automations with their switches.
// Overlay contract: receives { ...props, overlayId, onClose }.
import { useMemo, useState } from 'react';
import PushPanel from '../../components/ui/PushPanel';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import { EmptyState, SkeletonRows, Button } from '../../components/ui/kit';
import { toast, confirm } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { deleteCampaign, updateAutomation } from '../../api/campaigns';
import { SectionRule } from '../../components/campaigns/kit';
import { CampaignCard, AutomationRow, SwipeRow } from '../../components/campaigns/CampaignCard';
import SenderGuardCard from '../../components/campaigns/SenderGuardCard';
import SuggestionCard from '../../components/campaigns/SuggestionCard';
import AutomationEditor from '../../components/campaigns/AutomationEditor';
import { useAutomations, useCampaignList, useSuggestions } from '../../components/campaigns/useCampaignsData';

const BUCKETS = [
  { id: 'running', label: 'Running', match: (c) => ['running', 'paused'].includes(c.status) },
  { id: 'scheduled', label: 'Scheduled', match: (c) => c.status === 'scheduled' },
  { id: 'drafts', label: 'Drafts', match: (c) => c.status === 'draft' },
  { id: 'completed', label: 'Completed', match: (c) => c.status === 'completed' },
];

export default function CampaignsPage({ onClose }) {
  const list = useCampaignList();
  const autos = useAutomations();
  const sugg = useSuggestions();
  const [swipeOpen, setSwipeOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busyAuto, setBusyAuto] = useState(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [autosCollapsed, setAutosCollapsed] = useState(false);

  const campaigns = (list.data && list.data.campaigns) || [];
  const automations = (autos.data && autos.data.automations) || [];
  const suggestions = (sugg.data && sugg.data.suggestions) || [];
  const enabledCount = automations.filter((a) => a.enabled).length;

  const buckets = useMemo(() => BUCKETS.map((b) => ({ ...b, rows: campaigns.filter(b.match) })), [campaigns]);

  const open = (c) => (c.status === 'draft' ? nav.newCampaign({ campaignId: c.id }) : nav.openCampaign(c.id));

  const remove = async (c) => {
    setSwipeOpen(null);
    const ok = await confirm({ title: `Delete “${c.name}”?`, message: c.status === 'draft' ? 'This draft goes away for good.' : 'Its history and stats go away for good. Texts already sent stay in each thread.', confirmLabel: 'Delete campaign', destructive: true });
    if (!ok) return;
    const prev = list.data;
    list.setData((d) => (d ? { ...d, campaigns: d.campaigns.filter((x) => x.id !== c.id) } : d));
    try { await deleteCampaign(c.id); toast('Campaign deleted'); } catch (e) { list.setData(prev); toast.error(e.message || 'Could not delete'); }
  };

  const toggleAuto = async (a, next) => {
    if (next && !String(a.brief || '').trim() && a.trigger !== 'post_closing') { setEditing(a); return; }
    const prev = autos.data;
    autos.setData((d) => (d ? { ...d, automations: d.automations.map((x) => (x.id === a.id ? { ...x, enabled: next } : x)) } : d));
    setBusyAuto(a.id);
    try {
      await updateAutomation(a.id, { enabled: next });
      toast.success(next ? `${a.name} is on` : `${a.name} is off`);
    } catch (e) {
      autos.setData(prev);
      toast.error(e.message || 'Could not update');
    } finally {
      setBusyAuto(null);
    }
  };

  const loading = list.loading && !list.data;

  return (
    <PushPanel
      onClose={onClose}
      title="Campaigns"
      right={<GlassButton icon="plus" accent label="New campaign" onClick={() => nav.newCampaign()} />}
      bodyStyle={{ padding: '4px 14px 0' }}
    >
      <div className="kc-wide">
        <SenderGuardCard style={{ marginTop: 4 }} />

        <button type="button" className="kc-hero km-press" onClick={() => nav.newCampaign()} style={{ marginTop: 10 }}>
          <span className="kc-hero-tile"><Icon name="sparkle" size={19} stroke={2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>New text campaign</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>Tell your AI who to reach and what to say</span>
          </span>
          <Icon name="chevronRight" size={16} color="var(--faint)" />
        </button>

        {suggestions.length ? (
          <>
            <SectionRule label="Waiting for your OK" count={suggestions.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suggestions.slice(0, 4).map((s) => (
                <SuggestionCard
                  key={s.id}
                  s={s}
                  onResolved={(id) => sugg.setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((x) => x.id !== id) } : d))}
                  onRestore={() => sugg.reload()}
                />
              ))}
            </div>
          </>
        ) : null}

        {loading ? <div style={{ marginTop: 18 }}><SkeletonRows n={4} /></div> : null}

        {!loading && list.error && !campaigns.length ? (
          <EmptyState icon="alert" title="Couldn’t load campaigns" sub={list.error.message} action={<Button size="sm" variant="ghost" onClick={list.reload}>Try again</Button>} />
        ) : null}

        {!loading && !list.error && !campaigns.length ? (
          <EmptyState
            icon="send"
            title="No campaigns yet"
            sub="Announce a listing, invite people to an open house, or check in with past clients. Your AI writes each person their own text."
            action={<Button size="sm" icon="plus" onClick={() => nav.newCampaign()}>New campaign</Button>}
            style={{ padding: '36px 24px 8px' }}
          />
        ) : null}

        {buckets.map((b) => {
          if (!b.rows.length) return null;
          const rows = b.id === 'completed' && !showAllDone ? b.rows.slice(0, 4) : b.rows;
          return (
            <section key={b.id}>
              <SectionRule label={b.label} count={b.rows.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((c, i) => (c.status === 'running' ? (
                  <CampaignCard key={c.id} campaign={c} index={i} onOpen={() => open(c)} />
                ) : (
                  <SwipeRow key={c.id} id={c.id} openId={swipeOpen} setOpenId={setSwipeOpen} onDelete={() => remove(c)}>
                    <CampaignCard campaign={c} index={i} onOpen={() => open(c)} />
                  </SwipeRow>
                )))}
              </div>
              {b.id === 'completed' && b.rows.length > 4 ? (
                <button type="button" onClick={() => setShowAllDone((v) => !v)} style={{ marginTop: 10, fontSize: 13, color: 'var(--bright)', fontWeight: 600 }}>
                  {showAllDone ? 'Show fewer' : `Show all ${b.rows.length}`}
                </button>
              ) : null}
            </section>
          );
        })}

        <SectionRule
          label="Automations"
          count={automations.length ? `${enabledCount} on` : null}
          onToggle={() => setAutosCollapsed((v) => !v)}
          collapsed={autosCollapsed}
        />
        {!autosCollapsed ? (
          <>
            <div style={{ margin: '-2px 2px 12px', fontSize: 12.5, lineHeight: 1.45, color: 'var(--faint)' }}>
              Always-on texts that fire on a trigger. Turning one on approves its texts; every one still passes the Sender Guard.
            </div>
            {autos.loading && !autos.data ? <SkeletonRows n={3} /> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {automations.map((a, i) => (
                <AutomationRow key={a.id} automation={a} index={i} busy={busyAuto === a.id} onToggle={toggleAuto} onOpen={() => setEditing(a)} />
              ))}
            </div>
          </>
        ) : null}
        <div style={{ height: 24 }} />
      </div>

      <AutomationEditor
        automation={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => autos.reload()}
      />
    </PushPanel>
  );
}
