// Reply classifier — sorts an inbound reply to a campaign into
//   kind: 'lane' | 'question' | 'off_topic'   and   lane: green | yellow | red
// STOP / opt-out is handled BEFORE this (senderGuard.isHardStop/isSoftNo).
//
// off_topic is sacred: a message that is not about this campaign (a different
// deal, paperwork, money, personal chat) never lane-shifts, schedules, or
// drafts — the thread is the agent's. WHEN IN DOUBT, OFF_TOPIC: wrongly
// automating a personal conversation is far worse than missing one RSVP.
//
// AI first (thread-aware, the agent's own lane explainers as the rubric); the
// keyword fallback is deliberately conservative (only clear signals become a
// lane, everything ambiguous is off_topic).
const ai = require('../../ai/claude');

const RED_RE = /\b(can'?t make it|cannot make it|won'?t make it|can'?t come|won'?t be able|not able to (make|come|do)|unable to (make|come|attend)|out of town|out of the country|travel(l)?ing|away (that|this) (day|week|weekend)|i'?m away|we'?re away|already booked|busy (that|then|this)|working (that|then|during)|another time|maybe next time|next time|not for me|not this time|pass on (this|it)|i'?ll pass|we'?ll pass|not looking (right now|anymore)|already (bought|found|purchased)|went with another|have an agent|working with (an|another) agent|too (expensive|pricey|much)|out of (my|our) (budget|price range))\b/i;
const GREEN_RE = /\b(yes|yep|yeah|yup|absolutely|definitely|for sure|count me in|count us in|i'?m in|we'?re in|i'?ll be there|we'?ll be there|see you there|see you then|sounds (great|good|perfect|amazing)|love to|would love|i'?m interested|we'?re interested|very interested|interested|send (me )?(the )?(details|info|more|photos|pics)|let'?s do it|let'?s go|book (me|it|us)|i'?d like to see|we'?d like to see|want to see|wanna see|can we see|can i see|set up a (showing|tour|viewing)|schedule a (showing|tour|viewing)|private (showing|tour)|can'?t wait|on my way|rsvp yes|we'?ll come|i'?ll come|i will come|we will come)\b/i;
const YELLOW_RE = /\b(maybe|might|possibly|not sure|unsure|let me check|let me see|i'?ll try|we'?ll try|hopefully|should be able|depends|tentative(ly)?|perhaps|check (my|our) (schedule|calendar)|thinking about it|let me think|i'?ll let you know|we'?ll let you know|keep me posted|tbd)\b/i;
const QUESTION_TOPIC_RE = /\b(what time|when|where|address|parking|park|start|end|how long|price|pricing|asking|how much|hoa|tax(es)?|square|sq ?ft|beds?|baths?|bedrooms?|bathrooms?|lot|pool|dock|view|garage|bring|rsvp|open house|showing|tour|listing|photos?|pics|floor ?plan|disclosures?|offers?|still available|available|is it|is there|can i|can we|could i|could we|do you|does it|will there)\b/i;
const QUESTION_START_RE = /^\s*(what|when|where|how|is|are|can|could|do|does|did|will|would|which|who|any|should)\b/i;
// Clearly about something else (paperwork, money, other deals, personal life).
const OFF_TOPIC_RE = /\b(deposit|refund|escrow|wire|invoice|commission|closing (docs|documents|statement)|title (company|work)|my (lender|loan|mortgage|appraisal|inspection|lawyer|attorney)|appraisal came|inspection report|the contract|our contract|sign(ed)? the|docusign|tax (bill|return)|insurance (policy|claim)|how are (you|the kids|the family)|happy birthday|congrats on|golf|dinner|lunch|drinks|game (tonight|tomorrow)|call me (about|re)|other (house|property|deal)|our (house|place) on|my (house|place|condo) on)\b/i;
const REACTION_RE = /^[\s!?.\p{Emoji_Presentation}\p{Extended_Pictographic}]*(ha(ha)+|lol|lmao|haha|hehe|ok|okay|k|kk|thanks|thank you|thx|ty|cool|nice|great)?[\s!?.\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;

// -> { kind, lane, via: 'keywords', confidence }
function classifyByKeywords(text, { currentLane = null } = {}) {
  const t = String(text || '').trim();
  const cur = ['green', 'yellow', 'red'].includes(currentLane) ? currentLane : null;
  if (!t) return { kind: 'off_topic', lane: null, via: 'keywords', confidence: 0.2 };
  // A reaction / emoji / "thanks" after a substantive answer keeps the lane.
  if (REACTION_RE.test(t) && t.length <= 24) {
    return cur ? { kind: 'lane', lane: cur, via: 'keywords', confidence: 0.5 } : { kind: 'off_topic', lane: null, via: 'keywords', confidence: 0.4 };
  }
  if (OFF_TOPIC_RE.test(t)) return { kind: 'off_topic', lane: null, via: 'keywords', confidence: 0.6 };
  const red = RED_RE.test(t);
  const green = !red && GREEN_RE.test(t);
  const yellow = !red && !green && YELLOW_RE.test(t);
  const isQuestion = (/\?\s*$/.test(t) || QUESTION_START_RE.test(t)) && QUESTION_TOPIC_RE.test(t);
  if (isQuestion) return { kind: 'question', lane: red ? 'red' : green ? 'green' : yellow ? 'yellow' : (cur || 'yellow'), via: 'keywords', confidence: 0.6 };
  if (red) return { kind: 'lane', lane: 'red', via: 'keywords', confidence: 0.7 };
  if (green) return { kind: 'lane', lane: 'green', via: 'keywords', confidence: 0.7 };
  if (yellow) return { kind: 'lane', lane: 'yellow', via: 'keywords', confidence: 0.6 };
  return { kind: 'off_topic', lane: null, via: 'keywords', confidence: 0.3 }; // when in doubt
}

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['lane', 'question', 'off_topic'] },
    lane: { type: 'string', enum: ['green', 'yellow', 'red', 'none'] },
    confidence: { type: 'number' },
  },
};

function systemPrompt(lanes) {
  const explain = (k, fallback) => {
    const l = lanes && lanes[k];
    return (l && String(l.text || '').trim()) || fallback;
  };
  return `You sort a client's text reply to a luxury real-estate agent's outreach (a listing, an open house, a market note, an anniversary touch). FIRST decide what KIND of message it is, THEN (for on-topic messages) which lane.
Kinds:
- lane: the message is ABOUT this outreach and signals interest (yes / maybe / no).
- question: the message is ABOUT this outreach and asks something (price, address, time, parking, beds, HOA, can they see it, is it still available). Also give your best-guess lane (usually yellow: asking means engaged but uncommitted, unless the thread already fixed their stance).
- off_topic: the message is NOT about this outreach at all: a different property or deal, paperwork, deposits, inspections, money owed, personal chat, anything else the client and agent talk about. THE AGENT HANDLES THESE HIMSELF. WHEN IN DOUBT between a lane and off_topic, choose off_topic. Wrongly automating a personal conversation is far worse than missing one reply.
Lanes (only for lane/question):
- green: interested, wants to see it, wants details, coming to the open house, committed.
- yellow: maybe, curious, unsure, needs time, "I'll try", "let me check", asking questions.
- red: not interested in THIS: a stated conflict (traveling, booked, away), "not for me", already bought, working with another agent, out of budget.
SCHEDULE MATH IS YOUR JOB: if the outreach has an event time and the reply states a conflicting schedule, that is red even without the word no.
THREAD OVER MESSAGE: judge their CURRENT stance from the whole recent thread. A joke, emoji, or "thanks" after a substantive answer keeps their current lane.
The agent described the lanes like this. green: ${explain('green', 'they are interested')}. yellow: ${explain('yellow', 'they might be')}. red: ${explain('red', 'they pass')}.
Examples:
- "Yes! Can we see it Saturday?" -> question, green
- "What's the HOA on that one?" -> question, yellow
- "We'll try to swing by the open house" -> lane, yellow
- "Can't make it, we're in Aspen that weekend" -> lane, red
- "Looks amazing, send me the floor plan" -> lane, green
- "Did the title company ever send the closing docs?" -> off_topic
- "How's your family? Golf next week?" -> off_topic
- "Any update on the deposit refund for the Grove house?" -> off_topic
- "haha love it" right after they said they're coming -> lane, keep green
Never anything but the JSON.`;
}

// classifyReply({ workspaceId, text, campaign, threadTail, currentLane }) -> { kind, lane, via, confidence }
async function classifyReply({ workspaceId, text, campaign, threadTail = [], currentLane = null }) {
  const t = String(text || '').trim();
  if (ai.available() && t) {
    try {
      const brief = campaign ? String(campaign.brief || '').slice(0, 400) : '';
      const ev = campaign && campaign.event && campaign.event.startAt ? `EVENT: ${campaign.event.title || 'event'} at ${campaign.event.startAt}${campaign.event.address ? `, ${campaign.event.address}` : ''}` : null;
      const prompt = [
        brief ? `THE OUTREACH (what we texted them about): ${brief}` : null,
        ev,
        threadTail.length ? `RECENT THREAD (oldest first):\n${threadTail.slice(-8).join('\n')}` : null,
        currentLane ? `THEIR CURRENT LANE: ${currentLane}` : null,
        `THEIR NEWEST REPLY: ${t.slice(0, 500)}`,
      ].filter(Boolean).join('\n\n');
      const out = await ai.json({ system: systemPrompt(campaign && campaign.lanes), prompt, schema: SCHEMA, effort: 'low', feature: 'campaign_reply_classify', workspaceId });
      if (out && out.kind === 'off_topic') return { kind: 'off_topic', lane: null, via: 'ai', confidence: out.confidence };
      if (out && ['green', 'yellow', 'red'].includes(out.lane) && ['lane', 'question'].includes(out.kind)) {
        return { kind: out.kind, lane: out.lane, via: 'ai', confidence: out.confidence };
      }
    } catch (err) {
      if (err.code !== 'ai_unavailable') console.error('[campaigns/classifier] AI classify failed, using keywords:', err.message);
    }
  }
  return classifyByKeywords(t, { currentLane });
}

module.exports = { classifyReply, classifyByKeywords };
