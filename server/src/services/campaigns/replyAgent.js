// Campaign reply agent — DRAFTS an answer to an on-topic question about a
// campaign. Draft-first, always: this module never sends. Its output becomes
// an AiInsight `campaign_reply_suggestion` the agent approves (or edits) in the
// app, and only then does it go out (through the Sender Guard).
//
// Grounding: the model may state as fact ONLY the campaign brief, the fenced
// LISTING / EVENT details, and the agent's own "When they respond"
// instructions (quotable facts AND routing law). Anything else → ABSTAIN and
// the thread stays with the agent ("needs you").
const ai = require('../../ai/claude');
const { sanitizeOutbound, listingFacts, fmtEventWhen } = require('./drafter');
const { FAIR_HOUSING_GUARDRAIL } = require('./constants');

const SYSTEM = `You draft ONE reply text for a luxury real-estate agent, answering a client's question about a specific outreach (a listing, an open house, a market note). Write in the agent's voice, ready to send. The agent approves every draft before it goes out.

FACTS YOU MAY STATE, nothing else, ever:
- The campaign brief.
- The LISTING and EVENT DETAILS blocks, exactly as given, never altered.
- The agent's own instructions block: anything stated there is quotable fact, and any routing ordered there is LAW (if they said "tell them I'll call about offers", you abstain on offer questions).

ABSTAIN, returning {"abstain":true,"reason":"<one short line>"}, when:
- The answer is not in the facts above (never guess HOA, taxes, square footage, disclosures, availability, anything).
- The agent's instructions route this topic to them personally.
- It needs the agent: negotiation, offers, price flexibility, financing, complaints, a showing time that must be confirmed on their calendar.
- You are not sure. An abstain costs nothing; a wrong answer costs trust.

WHEN YOU DO ANSWER: one or two short, warm sentences that answer the question and nothing more. No em dashes, no emoji, never sound like a bot.

${FAIR_HOUSING_GUARDRAIL}

Reply with ONLY JSON: {"abstain":false,"reply":"<the text>","reason":""} or {"abstain":true,"reply":"","reason":"<why>"}.`;

const SCHEMA = { type: 'object', properties: { abstain: { type: 'boolean' }, reply: { type: 'string' }, reason: { type: 'string' } } };

// Deterministic fallback: answer only pure logistics the event/listing block
// can answer verbatim; everything else is the agent's.
function fallbackReply({ question, campaign, listing, tz, first }) {
  const q = String(question || '').toLowerCase();
  const ev = campaign && campaign.event;
  const when = fmtEventWhen(ev, tz);
  const L = listingFacts(listing);
  const instructions = String((campaign && campaign.lanes && campaign.lanes.aiReply && campaign.lanes.aiReply.instructions) || '');
  if (/\b(price|offer|negotia|flexib|financ|hoa|tax|disclos|inspection|appraisal)\b/.test(q)) {
    return { abstain: true, reason: 'They asked about price or terms. That one is yours.' };
  }
  if (when && /\b(what time|when|start|what day|which day|how long)\b/.test(q)) {
    return { abstain: false, reply: `Hi ${first}, it's ${when}${ev.address ? ` at ${ev.address}` : ''}.` };
  }
  if (/\b(where|address|location|located)\b/.test(q)) {
    const addr = (ev && ev.address) || (L && L.street);
    if (addr) return { abstain: false, reply: `It's at ${addr}${when ? `, ${when}` : ''}.` };
  }
  if (/\bpark(ing)?\b/.test(q) && /park/i.test(instructions)) {
    const line = instructions.split(/(?<=[.!?])\s+/).find((s) => /park/i.test(s));
    if (line) return { abstain: false, reply: sanitizeOutbound(line) };
  }
  if (L && /\b(beds?|bedrooms?|baths?|bathrooms?|square|sq ?ft|size)\b/.test(q) && L.specs) {
    return { abstain: false, reply: `It's ${L.specs}${L.price ? `, offered at ${L.price}` : ''}.` };
  }
  return { abstain: true, reason: 'Not something I can answer from the campaign details.' };
}

// -> { abstain:false, text } | { abstain:true, reason } | null on hard failure
async function draftReply({ workspaceId, campaign, client, listing, question, threadTail = [], tz = 'America/New_York' }) {
  const first = (client && (client.firstName || '').trim()) || 'there';
  if (ai.available()) {
    try {
      const L = listingFacts(listing);
      const when = fmtEventWhen(campaign && campaign.event, tz);
      const ev = (campaign && campaign.event) || {};
      const parts = [
        `CLIENT: ${first}`,
        `THE OUTREACH (campaign brief): ${String((campaign && campaign.brief) || '').slice(0, 600)}`,
        L ? `LISTING (REAL): address ${L.address}${L.specs ? `; ${L.specs}` : ''}${L.price ? `; ${L.price}` : ''}${L.offMarket ? '; OFF-MARKET, never share the street address' : ''}` : null,
        (when || ev.address) ? `EVENT DETAILS (REAL):${ev.title ? ` ${ev.title};` : ''}${when ? ` when ${when};` : ''}${ev.address ? ` where ${ev.address}` : ''}` : null,
        campaign && campaign.lanes && campaign.lanes.aiReply && campaign.lanes.aiReply.instructions
          ? `THE AGENT'S INSTRUCTIONS FOR RESPONSES (their words: quotable facts AND routing law):\n${String(campaign.lanes.aiReply.instructions).slice(0, 1500)}` : null,
        threadTail.length ? `RECENT THREAD (oldest first):\n${threadTail.slice(-8).join('\n')}` : null,
        `THEIR QUESTION (answer THIS): ${String(question || '').slice(0, 500)}`,
      ].filter(Boolean).join('\n\n');
      const out = await ai.json({ system: SYSTEM, prompt: parts, schema: SCHEMA, effort: 'low', feature: 'campaign_reply_agent', workspaceId });
      if (out) {
        if (out.abstain) return { abstain: true, reason: String(out.reason || 'Needs you').slice(0, 200) };
        const text = sanitizeOutbound(out.reply);
        if (text && text.length >= 2) return { abstain: false, text, via: 'ai' };
      }
    } catch (err) {
      if (err.code !== 'ai_unavailable') console.error('[campaigns/replyAgent] AI draft failed:', err.message);
    }
  }
  const fb = fallbackReply({ question, campaign, listing, tz, first });
  return fb.abstain ? fb : { abstain: false, text: sanitizeOutbound(fb.reply), via: 'template' };
}

module.exports = { draftReply, fallbackReply };
