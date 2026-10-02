// Pipeline — the deal board (PushPanel from the drawer / home). One vertical
// scroller: totals + side filter chips → New Development jump pill → stage
// navigator → six snap columns → New Development lane. `focus` (deal id)
// scrolls to + flashes that deal. Every path into Closed runs the won flow.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../../components/ui/PushPanel';
import PageHeader from '../../components/ui/PageHeader';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import { Button, EmptyState } from '../../components/ui/kit';
import { toast } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import KanbanBoard from '../../components/pipeline/KanbanBoard';
import NewDevLane from '../../components/pipeline/NewDevLane';
import LostReasonSheet from '../../components/pipeline/LostReasonSheet';
import { moveWithFlow } from '../../components/pipeline/actions';
import { stageForPhase, usePipelineConfig } from '../../components/pipeline/config';
import {
  flushDeal, getDealSync, loadBoard, moveDeal, removeDeal, reopenDeal, updateDeal,
  useBoardDeals, useDealRealtime,
} from '../../components/pipeline/dealStore';
import '../../styles/pipeline.css';

const FILTER_KEY = 'km-pl-filter';
const LANE_KEY = 'km-pl-lane';
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export default function PipelinePage({ focus, onClose }) {
  const { cfg, error: cfgError, reload } = usePipelineConfig();
  const { deals, status, error, loadedAt } = useBoardDeals();
  useDealRealtime({ board: true });
  const [filter, setFilter] = useState(() => read(FILTER_KEY, 'all'));
  const [expandedId, setExpandedId] = useState(null);
  const [lostDeal, setLostDeal] = useState(null);
  const [laneOpen, setLaneOpen] = useState(() => read(LANE_KEY, '1') !== '0');
  const [flashId, setFlashId] = useState(null);
  const [landedId, setLandedId] = useState(null);
  const pageRef = useRef(null);
  const laneRef = useRef(null);
  const pendingFocus = useRef(focus || null);

  useEffect(() => { loadBoard({ silent: true }).catch(() => {}); }, []);
  useEffect(() => { write(FILTER_KEY, filter); }, [filter]);
  useEffect(() => { write(LANE_KEY, laneOpen ? '1' : '0'); }, [laneOpen]);

  const main = useMemo(() => deals.filter((d) => d.track !== 'new_dev' && d.phase !== 'new_dev'), [deals]);
  const lane = useMemo(() => deals.filter((d) => d.track === 'new_dev' || d.phase === 'new_dev'), [deals]);
  const groupCounts = useMemo(() => {
    const c = { all: 0, buyers: 0, listings: 0, leases: 0 };
    for (const d of main) { if (d.phase === 'closed') continue; c.all += 1; if (c[d.group] != null) c[d.group] += 1; }
    return c;
  }, [main]);
  const shown = useMemo(() => (filter === 'all' ? main : main.filter((d) => d.group === filter)), [main, filter]);
  const totals = useMemo(() => {
    let open = 0; let volume = 0; let gci = 0;
    for (const d of shown) {
      if (d.phase === 'closed') continue;
      open += 1;
      if (d.group !== 'leases' && d.side !== 'referral_out') volume += d.price || 0;
      gci += (d.estimates && d.estimates.gci) || 0;
    }
    return { open, volume, gci };
  }, [shown]);

  // ── reveal + flash a card (deep link, post-create, return-to-main) ──────
  const reveal = useCallback((id, { expand = false, cls = 'km-focus-flash', ms = 2300 } = {}) => {
    const d = getDealSync(id);
    if (!d) return false;
    if ((d.track === 'new_dev' || d.phase === 'new_dev') && !laneOpen) { setLaneOpen(true); }
    if (d.track !== 'new_dev' && filter !== 'all' && d.group !== filter) setFilter('all');
    let tries = 0;
    const attempt = () => {
      const node = document.querySelector(`[data-deal-id="${id}"]`);
      const page = pageRef.current;
      if (node && page) {
        const col = node.closest('[data-col-stage]');
        const cols = col && col.parentElement;
        if (cols) cols.scrollTo({ left: Math.max(0, col.offsetLeft - 14), behavior: 'smooth' });
        const top = node.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - 140;
        page.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
        setTimeout(() => { try { node.classList.remove(cls); } catch { /* noop */ } }, ms);
        if (expand) setExpandedId(id);
        return;
      }
      tries += 1;
      if (tries < 14) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(() => requestAnimationFrame(attempt));
    return true;
  }, [laneOpen, filter]);

  useEffect(() => {
    if (!pendingFocus.current || !loadedAt || !cfg) return;
    if (reveal(pendingFocus.current, { expand: true })) pendingFocus.current = null;
  }, [loadedAt, cfg, reveal, deals]);
  useEffect(() => { if (focus) { pendingFocus.current = focus; if (loadedAt && cfg && reveal(focus, { expand: true })) pendingFocus.current = null; } }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onCreated = (e) => {
      const id = e && e.detail && e.detail.dealId;
      if (!id) return;
      setTimeout(() => reveal(id, { cls: 'km-deal-flash', ms: 700 }), 60);
    };
    window.addEventListener('pipeline:deal-created', onCreated);
    return () => window.removeEventListener('pipeline:deal-created', onCreated);
  }, [reveal]);

  // ── actions ───────────────────────────────────────────────────────────
  const onStageChange = useCallback((deal, stage, opts = {}) => {
    if (stage === 'lost') { setLostDeal(deal); return; }
    if (opts.dropped) { setLandedId(deal.id); setTimeout(() => setLandedId(null), 600); }
    moveWithFlow(deal, stage, { quiet: false });
  }, []);
  const onAdvance = useCallback((deal, next) => {
    setLandedId(deal.id);
    setTimeout(() => setLandedId(null), 600);
    moveWithFlow(deal, next);
  }, []);
  const onRequestLost = useCallback((deal) => setLostDeal(deal), []);
  const onDelete = useCallback(async (deal) => {
    setExpandedId(null);
    if (await removeDeal(deal.id)) toast(`Deleted ${deal.name}’s deal`);
  }, []);
  const onConfirmLost = async (reason) => {
    const d = lostDeal;
    if (!d) return;
    setExpandedId(null);
    try {
      await moveDeal(d.id, 'lost', { lostReason: reason });
      setLostDeal(null);
      toast(`${d.name} moved to Lost`, { action: { label: 'Undo', onClick: () => reopenDeal(d.id).catch(() => {}) } });
    } catch { /* toasted */ }
  };
  const onReturn = useCallback(async (deal) => {
    try {
      await moveDeal(deal.id, stageForPhase(cfg, 'under_contract', deal.side), { track: 'main' });
      toast.success(`${deal.name} → Under Contract`);
      setTimeout(() => reveal(deal.id, { cls: 'km-deal-flash', ms: 700 }), 80);
    } catch { /* toasted */ }
  }, [cfg, reveal]);

  const scrollToLane = () => {
    setLaneOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const l = laneRef.current; const page = pageRef.current;
      if (!l || !page) return;
      const top = l.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - 12;
      page.scrollTo({ top: Math.max(0, Math.min(top, page.scrollHeight - page.clientHeight)), behavior: 'smooth' });
      l.classList.remove('km-focus-flash'); void l.offsetWidth; l.classList.add('km-focus-flash');
      setTimeout(() => l.classList.remove('km-focus-flash'), 2400);
    }));
  };

  const loading = (!cfg || status === 'loading') && !deals.length;
  const failed = (error && !loadedAt) || (cfgError && !cfg);
  const delivered = lane.filter((d) => d.stage === 'building_delivered').length;

  return (
    <PushPanel onClose={onClose} header={<BoardHeader />} scroll={false}>
      <div ref={pageRef} className="km-pl-scroll">
        <div className="km-pl-stats" role="group" aria-label="Pipeline totals">
          <div className="km-pl-stat">
            <div className="km-pl-eyebrow">Open</div>
            <div className="km-pl-stat-v">{loading ? '–' : totals.open}</div>
          </div>
          <div className="km-pl-stat">
            <div className="km-pl-eyebrow">Volume</div>
            <div className="km-pl-stat-v" style={{ color: 'var(--blue)' }}>{loading ? '–' : moneyCompact(totals.volume)}</div>
          </div>
          <div className="km-pl-stat">
            <div className="km-pl-eyebrow">Est. GCI</div>
            <div className="km-pl-stat-v" style={{ color: 'var(--green)' }}>{loading ? '–' : moneyCompact(totals.gci)}</div>
          </div>
        </div>

        <div className="km-pl-chips" role="tablist" aria-label="Filter by side">
          {(cfg ? cfg.filterGroups : [{ id: 'all', label: 'All' }]).map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={filter === g.id} className={`km-pill km-press ${filter === g.id ? 'km-pill--on' : ''}`} onClick={() => setFilter(g.id)}>
              {g.label}
              <span className="km-pl-chip-n">{groupCounts[g.id] || 0}</span>
            </button>
          ))}
        </div>

        {lane.length > 0 ? (
          <div className="km-pl-jumprow">
            <button type="button" className="km-pl-jump km-press" onClick={scrollToLane}>
              <Icon name="building" size={13} />
              <span>New Development</span>
              <span className="km-mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)' }}>{lane.length}</span>
              {delivered ? <span className="km-pl-greenpill">{delivered} delivered</span> : null}
              <Icon name="chevronDown" size={12} color="var(--faint)" />
            </button>
          </div>
        ) : null}

        {failed ? (
          <div className="km-pl-error">
            Couldn’t load the pipeline.
            <button type="button" onClick={() => { reload().catch(() => {}); loadBoard().catch(() => {}); }}>Retry</button>
          </div>
        ) : null}

        {loading && !failed ? (
          <div aria-hidden="true" style={{ padding: '8px 14px' }}>
            <div className="km-skel" style={{ height: 50, borderRadius: 14, marginBottom: 14 }} />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="km-row-in" style={{ animationDelay: `${i * 30}ms`, marginBottom: 10 }}>
                <div className="km-skel" style={{ height: 92, borderRadius: 14 }} />
              </div>
            ))}
          </div>
        ) : null}

        {cfg && loadedAt ? (
          <>
            {main.length === 0 && lane.length === 0 ? (
              <EmptyState
                icon="pipeline"
                title="No deals yet"
                sub="Start one from a client’s card or right here — it lands in Engaged and flashes so you can see it."
                action={<Button icon="plus" onClick={() => nav.newDeal({})}>Add a deal</Button>}
                style={{ padding: '22px 24px 26px' }}
              />
            ) : null}
            <KanbanBoard
              deals={shown}
              cfg={cfg}
              pageRef={pageRef}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onUpdate={updateDeal}
              onSave={flushDeal}
              onAdvance={onAdvance}
              onStageChange={onStageChange}
              onRequestLost={onRequestLost}
              onDelete={onDelete}
              landedId={landedId}
              flashId={flashId}
            />
            <NewDevLane
              deals={lane}
              cfg={cfg}
              open={laneOpen}
              onToggle={() => setLaneOpen((o) => !o)}
              laneRef={laneRef}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onUpdate={updateDeal}
              onSave={flushDeal}
              onAdvance={onAdvance}
              onStageChange={onStageChange}
              onRequestLost={onRequestLost}
              onDelete={onDelete}
              onReturn={onReturn}
              flashId={flashId}
              landedId={landedId}
            />
          </>
        ) : null}
      </div>

      <LostReasonSheet deal={lostDeal} open={!!lostDeal} onClose={() => setLostDeal(null)} onConfirm={onConfirmLost} />
    </PushPanel>
  );
}

// Header inside the panel's context so Back runs the push-panel exit.
function BoardHeader() {
  const { requestClose } = usePanel();
  return (
    <PageHeader
      title="Pipeline"
      onBack={requestClose}
      right={(
        <>
          <GlassButton icon="percent" label="Pay plan" onClick={() => nav.openPayPlan()} />
          <GlassButton icon="plus" label="Add deal" accent onClick={() => nav.newDeal({})} />
        </>
      )}
    />
  );
}
