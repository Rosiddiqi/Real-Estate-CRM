// Inbound real-estate intent → SERENA SUGGESTS task (Task.status 'suggested',
// source 'ai_capture'). "can we see it Saturday" → "Schedule a showing for
// Elena"; "what's the HOA?" → "Answer Elena's HOA question". One suggestion
// per client per day (dedupe), notes say exactly where it came from.
// Deterministic detection first; AI (when available) only rewrites the title.
const prisma = require('../../lib/prisma');
const hub = require('../../realtime/hub');
const ai = require('../../ai/claude');
const { dayKey, dayBounds } = require('../../lib/dates');
const { workspaceTz } = require('./conversations');
const { firstNameOf, truncate, withTimeout } = require('./util');

const DAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|tomorrow|tonight|this (?:weekend|week|afternoon|evening|morning)|next week|weekend';

// Ordered: first match wins.
const INTENTS = [
  {
    id: 'showing', kind: 'showing',
    test: (t) => (/\b(see|tour|view|visit|walk ?through|look at|check out|go by|stop by|showing|preview)\b/i.test(t)
      && (new RegExp(`\\b(${DAY})\\b|\\b\\d{1,2}(:\\d{2})?\\s?(am|pm)\\b|\\bwhen can\\b|\\bcan we\\b|\\bcould we\\b|\\bavailable\\b`, 'i').test(t)))
      || /\b(schedule|book|set up) (a )?(showing|tour|viewing|private showing)\b/i.test(t),
    title: (n) => `Schedule a showing for ${n}`,
  },
  {
    id: 'offer', kind: 'follow_up',
    test: (t) => /\b(make|put in|submit|write|send) (an |our |the )?offer\b|\bcounter(-| )?offer\b|\boffer (in|on)\b|\bwhat would they take\b|\bwould they (take|accept)\b/i.test(t),
    title: (n) => `Talk offer strategy with ${n}`,
  },
  {
    id: 'hoa', kind: 'text',
    test: (t) => /\b(hoa|association (fee|dues)|maintenance fee|condo fee|special assessment|property tax(es)?|the taxes)\b/i.test(t),
    title: (n) => `Answer ${n}'s HOA / tax question`,
  },
  {
    id: 'valuation', kind: 'follow_up',
    test: (t) => /\bwhat('?s| is| would) (my|our|the) (home|house|place|condo|property|unit) (be )?worth\b|\b(cma|valuation|apprais(al|e))\b|\bwhat could (we|i) get for\b/i.test(t),
    title: (n) => `Send ${n} a CMA`,
  },
  {
    id: 'listing', kind: 'follow_up',
    test: (t) => /\b(thinking (about|of) selling|ready to sell|want to sell|list (our|my) (home|house|place|condo)|put (it|the house|our place) on the market)\b/i.test(t),
    title: (n) => `Book a listing consultation with ${n}`,
  },
  {
    id: 'financing', kind: 'follow_up',
    test: (t) => /\b(pre-?approv\w*|mortgage|lender|jumbo|interest rate|financ\w+|proof of funds)\b/i.test(t),
    title: (n) => `Connect ${n} with a lender`,
  },
  {
    id: 'documents', kind: 'paperwork',
    test: (t) => /\b(disclosures?|survey|inspection report|floor ?plans?|seller'?s? docs?|elevation certificate|wind mitigation)\b/i.test(t),
    title: (n) => `Send ${n} the documents they asked for`,
  },
  {
    id: 'callback', kind: 'call',
    test: (t) => /\b(call me|give me a call|can you call|ring me|hop on a call|quick call)\b/i.test(t),
    title: (n) => `Call ${n} back`,
  },
];

function detectIntent(text) {
  const t = String(text || '');
  if (t.trim().length < 6) return null;
  for (const it of INTENTS) {
    if (it.test(t)) return it;
  }
  return null;
}

async function captureIntent({ workspaceId, client, conversation, message }) {
  const intent = detectIntent(message.body);
  if (!intent || !client) return null;
  const tz = await workspaceTz(workspaceId);
  const today = dayKey(new Date(), tz);
  const { start, end } = dayBounds(today, tz);
  const dup = await prisma.task.findFirst({
    where: { workspaceId, clientId: client.id, source: 'ai_capture', createdAt: { gte: start, lt: end } },
    select: { id: true },
  });
  if (dup) return null;

  const name = firstNameOf(client) || 'client';
  let title = intent.title(name);
  if (ai.available()) {
    const out = await withTimeout(ai.json({
      system: 'You turn a luxury real-estate client\'s text into ONE short to-do title for their agent (max 60 chars, imperative, include the client\'s first name, no emoji, no quotes). Never mention protected characteristics (Fair Housing).',
      prompt: `Client first name: ${name}\nDetected intent: ${intent.id}\nTheir text: "${truncate(message.body, 400)}"\nReturn the to-do title.`,
      schema: { type: 'object', properties: { title: { type: 'string' } } },
      effort: 'low', maxTokens: 400, feature: 'inbox_intent', workspaceId,
    }), 9000, null);
    if (out && out.title && out.title.length <= 80) title = out.title.trim();
  }

  const when = new Date(message.sentAt || Date.now()).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const task = await prisma.task.create({
    data: {
      workspaceId,
      clientId: client.id,
      title,
      notes: `From ${name}'s text (${when}): "${truncate(message.body, 280)}"`,
      status: 'suggested',
      source: 'ai_capture',
      kind: intent.kind,
      dueDate: today,
      meta: { conversationId: conversation.id, messageId: message.id, intent: intent.id, origin: 'inbox' },
    },
  });
  hub.broadcast(workspaceId, 'task_updated', task);
  return task;
}

module.exports = { detectIntent, captureIntent, INTENTS };
