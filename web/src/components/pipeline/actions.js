// Pipeline actions with every side effect attached, shared by the board, the
// New Development lane, the Deal sheet and the New Deal sheet:
//   moveWithFlow(deal, stage)   — optimistic move; Closed runs the won flow and
//                                 books what the agent typed; other moves toast with Undo
//   afterCreate(deal)           — post-create flash on an open board + won flow
//                                 when the deal was created directly at Closed
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import { haptic } from '../../lib/native';
import { runWonFlow } from './WonFlow';
import { bookClose, moveDeal } from './dealStore';

export async function celebrateAndBook(deal) {
  haptic('success');
  const res = await runWonFlow({ ...deal, stage: 'closed' });
  if (res && (res.commission != null || res.closedAt)) {
    try {
      await bookClose(deal.id, res);
      toast.success(res.commission ? `Booked ${moneyCompact(res.commission)} on ${deal.name}` : 'Closing date saved');
    } catch { /* store toasted */ }
  }
  return res;
}

export async function moveWithFlow(deal, stage, { track, quiet = false, undo = true } = {}) {
  const closing = stage === 'closed' && deal.stage !== 'closed';
  const prevStage = deal.stage;
  const p = moveDeal(deal.id, stage, track ? { track } : {});
  if (closing) {
    haptic('success');
    const res = await runWonFlow({ ...deal, stage: 'closed' });
    try {
      await p;
      if (res && (res.commission != null || res.closedAt)) {
        await bookClose(deal.id, res);
        toast.success(res.commission ? `Booked ${moneyCompact(res.commission)} on ${deal.name}` : 'Closing date saved');
      }
    } catch { /* store already rolled back + toasted */ }
    return;
  }
  try {
    const moved = await p;
    if (!quiet && moved) {
      haptic('light');
      toast(`${deal.name} → ${moved.label}`, undo ? { action: { label: 'Undo', onClick: () => moveDeal(deal.id, prevStage, { quiet: true }).catch(() => {}) } } : undefined);
    }
  } catch { /* toasted */ }
}

// Called after a deal is created anywhere (NewDealSheet, other builders).
export async function afterCreate(deal, { boardOpen } = {}) {
  try { window.dispatchEvent(new CustomEvent('pipeline:deal-created', { detail: { dealId: deal.id } })); } catch { /* noop */ }
  if (deal.stage === 'closed') {
    await celebrateAndBook(deal);
    return;
  }
  const onBoard = boardOpen ?? nav.getState().overlays.some((o) => o.type === 'pipeline');
  toast.success(`${deal.name} · ${deal.label}`, onBoard ? undefined : { action: { label: 'View', onClick: () => nav.openPipeline(deal.id) } });
}
