// Onboarding state — fully derived from real data (never stored flags), like
// RevMatch. Workspaces that already have clients are grandfathered.
const express = require('express');
const prisma = require('../lib/prisma');
const { ah } = require('../lib/http');

const router = express.Router();

const TASKS = [
  { id: 'add_contact', label: 'Add your first client', sub: 'Everything in KeyMatch hangs off a client', target: 'clients' },
  { id: 'send_text', label: 'Send your first text', sub: 'iMessage or SMS, straight from your number', target: 'inbox' },
  { id: 'add_property', label: 'Add a property to a client’s portfolio', sub: 'What they own and what they want — this feeds Matchmaker', target: 'clients' },
  { id: 'create_deal', label: 'Start a deal', sub: 'Track it from first showing to closing', target: 'pipeline' },
  { id: 'pay_plan', label: 'Set your commission split', sub: 'So the commission math is yours, not a guess', target: 'payPlan' },
];

async function stateFor(req) {
  const wid = req.workspaceId;
  const user = await req.getUser();
  const ob = { ...(user.onboarding || {}) };
  const [clients, outbound, props, searches, deals, plan] = await Promise.all([
    prisma.client.count({ where: { workspaceId: wid } }),
    prisma.message.count({ where: { workspaceId: wid, isFromMe: true } }),
    prisma.portfolioProperty.count({ where: { workspaceId: wid } }),
    prisma.buyerSearch.count({ where: { workspaceId: wid } }),
    prisma.deal.count({ where: { workspaceId: wid } }),
    prisma.payPlan.findFirst({ where: { workspaceId: wid }, orderBy: { createdAt: 'asc' } }),
  ]);
  const done = {
    add_contact: clients > 0,
    send_text: outbound > 0,
    add_property: props + searches > 0,
    create_deal: deals > 0,
    pay_plan: !!(plan && plan.updatedAt - plan.createdAt > 2000) || !!ob.payPlanSaved,
  };
  if (ob.grandfathered === undefined) {
    ob.grandfathered = clients > 3; // an established book never sees onboarding
    if (ob.grandfathered) ob.completedAt = new Date().toISOString();
    await prisma.user.update({ where: { id: user.id }, data: { onboarding: ob } });
  }
  const tasks = TASKS.map((t) => ({ ...t, done: !!done[t.id] }));
  const doneCount = tasks.filter((t) => t.done).length;
  const ai = user.aiPreferences || {};
  const assistantDone = !!ai.aiName || !!ob.grandfathered;
  return {
    assistant: { done: assistantDone, required: !assistantDone, name: ai.aiName || 'Serena' },
    userName: user.firstName,
    tasks,
    doneCount,
    total: tasks.length,
    complete: doneCount === tasks.length || !!ob.completedAt,
    dismissedAt: ob.dismissedAt || null,
    completedAt: ob.completedAt || null,
    grandfathered: !!ob.grandfathered,
  };
}

router.get('/', ah(async (req, res) => res.json(await stateFor(req))));

for (const action of ['dismiss', 'resume', 'complete']) {
  router.post(`/${action}`, ah(async (req, res) => {
    const user = await req.getUser();
    const ob = { ...(user.onboarding || {}) };
    if (action === 'dismiss') ob.dismissedAt = new Date().toISOString();
    if (action === 'resume') ob.dismissedAt = null;
    if (action === 'complete') ob.completedAt = new Date().toISOString();
    await prisma.user.update({ where: { id: user.id }, data: { onboarding: ob } });
    req.getUser = async () => ({ ...user, onboarding: ob });
    res.json(await stateFor(req));
  }));
}

module.exports = router;
