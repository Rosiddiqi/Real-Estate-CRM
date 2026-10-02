// EV ranking for the To-Do list (RevMatch useOpenLoops, re-geared to real
// estate): value = expected GCI (not price), odds = star rating × stage odds,
// urgency from priority / due date / age, a quick-touch bonus, and the
// property-tier multiplier. Bands (priorityRank) dominate; EV breaks ties
// within a band — sorted band DESC then EV DESC (RevMatch had this inverted).

const STAGE_ODDS = {
  new_lead: 0.2, seller_lead: 0.2, consultation: 0.35, listing_appt: 0.35, touring: 0.5, active: 0.5,
  offer_submitted: 0.7, offer_received: 0.7, under_contract: 0.9, unit_selection: 0.5, pricing_received: 0.6,
  priority_list: 0.7, reserved: 0.85,
};
const STAR_ODDS = { 5: 1, 4: 0.85, 3: 0.6, 2: 0.4, 1: 0.25, 0: 0.5 };
// Task.priority: -1 low · 0 normal · 1 high · 2 urgent
const PRIO_BOOST = { 2: 1.5, 1: 0.6, 0: 0, '-1': -0.2 };

function propertyMultiplier(pp) {
  if (typeof pp !== 'number') return 1;
  return 0.6 + (Math.max(0, Math.min(100, pp)) / 100) * 1.9;
}

export function evScore(t) {
  const ev = t.ev || {};
  const whale = !!ev.whale;
  const dealVal = ev.dealValue || 0;
  const value = dealVal > 0 ? dealVal : (whale ? 30000 : ((ev.rating ?? 0) >= 4 ? 12000 : 5000));
  const starOdds = STAR_ODDS[Math.round(ev.rating ?? 0)] ?? 0.5;
  const stageOdds = ev.dealStage ? (STAGE_ODDS[ev.dealStage] ?? 0.6) : 1;
  const now = Date.now();
  let urgency = 1 + (PRIO_BOOST[t.priority ?? 0] ?? 0);
  const due = t.dueAt || (t.dueKey ? `${t.dueKey}T17:00:00` : null);
  if (due) {
    const hrs = (new Date(due).getTime() - now) / 3600000;
    if (hrs < 0) urgency += 1.5; else if (hrs < 24) urgency += 0.8; else if (hrs < 72) urgency += 0.3;
  }
  if (t.createdAt) urgency += Math.min(0.6, Math.max(0, (now - new Date(t.createdAt).getTime()) / 3600000) / 168);
  urgency = Math.max(0.2, urgency);
  const quick = /\b(text|call|reply|send|confirm|ping|email)\b/i.test(t.title || '');
  return value * starOdds * stageOdds * urgency * (quick ? 1.25 : 1) * propertyMultiplier(ev.propertyPriority);
}

export function priorityRank(t) {
  const ev = t.ev || {};
  let band = 1;
  if (t.priority === 2) band = 4; else if (t.priority === 1) band = 3;
  const due = t.dueAt || (t.dueKey ? `${t.dueKey}T17:00:00` : null);
  if (due) {
    const hrs = (new Date(due).getTime() - Date.now()) / 3600000;
    if (hrs < 0) band = Math.max(band, 4); else if (hrs < 24) band = Math.max(band, 3); else if (hrs < 72) band = Math.max(band, 2);
  }
  const pp = ev.propertyPriority || 0;
  if (pp >= 72) band = Math.max(band, 4); else if (pp >= 50) band = Math.max(band, 3); else if (pp >= 30) band = Math.max(band, 2);
  return band;
}

// AI moves / suggestions score on the SAME scale as the agent's own to-dos.
export function moveScore(m) {
  return evScore({
    title: m.title,
    priority: 0,
    createdAt: m.createdAt,
    ev: { dealValue: m.dealValue || (m.ev && m.ev.dealValue) || 0, rating: m.stars ?? (m.ev && m.ev.rating) ?? 0, whale: !!(m.whale || (m.ev && m.ev.whale)), dealStage: m.dealStage || (m.ev && m.ev.dealStage), propertyPriority: m.propertyPriority ?? (m.ev && m.ev.propertyPriority) },
  }) * (1 + (m.score || 0) / 100);
}

export function rankTodos(rows) {
  return rows
    .map((t) => ({ t, band: priorityRank(t), ev: evScore(t) }))
    .sort((a, b) => b.band - a.band || b.ev - a.ev)
    .map((r) => r.t);
}
