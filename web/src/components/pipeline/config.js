// Pipeline config on the web — the server's stage model (GET /api/pipeline/stages)
// plus the active pay plan, cached once per session, and the helpers that
// re-derive a deal's display fields after an optimistic edit (phase, labels,
// stale/DOM/countdown, live commission estimate). The server stays the source
// of truth; these only keep the UI honest between a tap and the server echo.
import { useEffect, useSyncExternalStore } from 'react';
import { getStages } from '../../api/deals';
import { getPayPlan } from '../../api/commissions';
import * as C from './commission';

const DAY = 86400000;
let state = { cfg: null, plan: null, capYtd: { gci: 0, company: 0, franchise: 0 }, capState: null, error: null, version: 0 };
let loading = null;
const subs = new Set();
const emit = () => { state = { ...state, version: state.version + 1 }; subs.forEach((f) => f()); };

function index(cfg) {
  const phaseById = Object.fromEntries([...cfg.phases, cfg.lost].map((p) => [p.id, p]));
  const sideById = Object.fromEntries(cfg.sides.map((s) => [s.id, s]));
  const newDevByKey = Object.fromEntries(cfg.newDev.stages.map((s) => [s.key, s]));
  return { ...cfg, phaseById, sideById, newDevByKey, phaseIds: cfg.phases.map((p) => p.id) };
}

export function loadPipelineConfig({ force = false } = {}) {
  if (loading && !force) return loading;
  loading = Promise.all([getStages(), getPayPlan().catch(() => null)])
    .then(([cfg, pp]) => {
      setPlan(pp && pp.payPlan, { silent: true });
      state = { ...state, cfg: index(cfg), error: null };
      emit();
      return state;
    })
    .catch((err) => {
      loading = null;
      state = { ...state, error: err };
      emit();
      throw err;
    });
  return loading;
}

export function setPlan(payPlan, { silent = false } = {}) {
  if (!payPlan) return;
  const cs = payPlan.capState || null;
  state = {
    ...state,
    plan: C.preparePlan(payPlan),
    rawPlan: payPlan,
    capState: cs,
    capYtd: cs ? { gci: cs.gciYtd || 0, company: cs.companyPaid || 0, franchise: cs.franchisePaid || 0 } : state.capYtd,
  };
  if (!silent) emit();
}

export function getConfigState() { return state; }

export function usePipelineConfig() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);
  useEffect(() => { if (!s.cfg && !s.error) loadPipelineConfig().catch(() => {}); }, [s.cfg, s.error]);
  return { ...s, reload: () => loadPipelineConfig({ force: true }) };
}

// ── stage helpers (all driven by the server config) ────────────────────────
export const isNewDevStage = (cfg, key) => !!(cfg && cfg.newDevByKey[key]);
export const sideInfo = (cfg, side) => (cfg && (cfg.sideById[side] || cfg.sideById.buyer)) || { id: side, label: side, chip: String(side || '').toUpperCase(), family: 'buyer', group: 'buyers' };
export const familyOf = (cfg, side) => sideInfo(cfg, side).family;

export function phaseOf(cfg, stage) {
  if (!cfg || !stage) return 'engaged';
  if (stage === 'lost') return 'lost';
  if (cfg.keyPhase[stage]) return cfg.keyPhase[stage];
  if (cfg.newDevByKey[stage]) return 'new_dev';
  return 'engaged';
}

export function labelFor(cfg, stage, side = 'buyer') {
  if (!cfg) return { label: stage, sub: '' };
  if (stage === 'lost') return { label: cfg.lost.label, sub: cfg.lost.sub };
  if (cfg.newDevByKey[stage]) return { label: cfg.newDevByKey[stage].label, sub: cfg.newDevByKey[stage].sub };
  const idx = cfg.phaseIds.indexOf(phaseOf(cfg, stage));
  const list = cfg.labels[side] || cfg.labels[familyOf(cfg, side)] || cfg.labels.buyer;
  return list[idx >= 0 ? idx : 0];
}

export function colorFor(cfg, stage) {
  if (!cfg) return 'var(--blue)';
  if (stage === 'lost') return cfg.lost.color;
  if (cfg.newDevByKey[stage]) return cfg.newDevByKey[stage].color;
  return (cfg.phaseById[phaseOf(cfg, stage)] || cfg.phases[0]).color;
}

export function stageForPhase(cfg, phase, side) {
  if (phase === 'lost') return 'lost';
  const keys = cfg.families[familyOf(cfg, side)];
  const idx = cfg.phaseIds.indexOf(phase);
  return keys[idx >= 0 ? idx : 0];
}

// The stages a deal can move between (its side's family or the lane).
export function stagesFor(cfg, { side = 'buyer', track = 'main' } = {}) {
  if (!cfg) return [];
  if (track === 'new_dev') return cfg.newDev.stages.map((s) => ({ key: s.key, label: s.label, sub: s.sub, color: s.color, phase: 'new_dev' }));
  const keys = cfg.families[familyOf(cfg, side)];
  const labels = cfg.labels[side] || cfg.labels.buyer;
  return keys.map((key, i) => ({ key, label: labels[i].label, sub: labels[i].sub, color: cfg.phases[i].color, phase: cfg.phaseIds[i] }));
}

export function nextStage(cfg, { stage, side = 'buyer', track = 'main' }) {
  if (!cfg || !stage || stage === 'closed' || stage === 'lost') return null;
  const list = track === 'new_dev' || cfg.newDevByKey[stage] ? cfg.newDev.stages.map((s) => s.key) : cfg.families[familyOf(cfg, side)];
  const i = list.indexOf(stage);
  if (i < 0) return null;
  const n = list[i + 1];
  return !n || n === 'closed' ? null : n;
}

export function odds(cfg, stage) {
  if (!cfg || stage === 'lost') return 0;
  if (cfg.newDevByKey[stage]) return cfg.newDevByKey[stage].odds;
  return (cfg.phaseById[phaseOf(cfg, stage)] || {}).odds || 0;
}

export function timing(cfg, deal, now = Date.now()) {
  const changed = deal.stageChangedAt ? new Date(deal.stageChangedAt).getTime() : now;
  const stageAge = Math.max(0, Math.floor((now - changed) / DAY));
  const phase = phaseOf(cfg, deal.stage);
  const out = { stageAge, stale: false, staleDays: null, dom: null, closing: null };
  if (!(deal.track === 'new_dev' || phase === 'new_dev')) {
    if (phase === 'active' && familyOf(cfg, deal.side) === 'listing') {
      const listedAt = deal.listing && deal.listing.isOwnListing && deal.listing.listedAt ? new Date(deal.listing.listedAt).getTime() : changed;
      out.dom = Math.max(0, Math.floor((now - listedAt) / DAY));
    } else {
      const thr = cfg && cfg.phaseById[phase] ? cfg.phaseById[phase].staleDays : null;
      if (thr != null && stageAge >= thr) { out.stale = true; out.staleDays = stageAge; }
    }
  }
  const date = deal.closingDate || (deal.track === 'new_dev' ? deal.estCompletion : null);
  if (date && (phase === 'under_contract' || phase === 'offer' || phase === 'new_dev')) {
    const ms = new Date(date).getTime();
    const days = Math.ceil((ms - now) / DAY);
    out.closing = { date: new Date(ms).toISOString(), days, overdue: days < 0 && phase === 'under_contract' };
  }
  return out;
}

// Re-derive every display field from raw columns (mirrors normalize.js).
export function derive(deal, s = state) {
  if (!deal || !s.cfg) return deal;
  const cfg = s.cfg;
  const side = deal.side || 'buyer';
  const info = sideInfo(cfg, side);
  const { label, sub } = labelFor(cfg, deal.stage, side);
  const plan = s.plan || C.preparePlan({});
  // normalized deals expose the effective price as `price` and the raw column as `rawPrice`
  const raw = { ...deal, price: deal.rawPrice !== undefined ? deal.rawPrice : deal.price };
  const est = C.estimate(raw, plan, s.capYtd);
  const o = odds(cfg, deal.stage);
  const net = est.estimatedNet != null ? est.estimatedNet : est.net;
  const t = timing(cfg, deal);
  const inv = (cfg.inventoryTypes || []).find((x) => x.id === deal.inventoryType) || (cfg.inventoryTypes || [])[0] || {};
  return {
    ...deal,
    side,
    sideLabel: info.label,
    sideChip: info.chip,
    group: info.group,
    family: info.family,
    inventoryLabel: inv.label,
    inventoryChip: inv.chip,
    phase: phaseOf(cfg, deal.stage),
    label,
    stageSub: sub,
    color: colorFor(cfg, deal.stage),
    next: nextStage(cfg, deal),
    price: est.price,
    priceCaption: C.priceCaption(raw),
    priceField: C.priceField(raw),
    rate: est.rate,
    booked: deal.commission != null,
    estimates: {
      sideGci: est.sideGci, gci: est.myGci, net, companyDollar: est.companyDollar, franchise: est.franchise,
      fee: est.fee, team: est.team, referralOut: est.referralOut, coopBonus: est.coopBonus, split: est.split,
      capped: est.capped, sides: est.sides, volume: est.volume, odds: o, weightedNet: Math.round(net * o),
    },
    probability: o,
    stageAge: t.stageAge,
    stale: t.stale,
    staleDays: t.staleDays,
    dom: t.dom,
    closing: t.closing,
  };
}
