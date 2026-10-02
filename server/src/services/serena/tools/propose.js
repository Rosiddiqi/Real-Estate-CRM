// Serena PROPOSE tools — customer-facing output is ALWAYS a draft the agent
// approves (Preview → Edit → Send). These never send anything: they return
// { __proposal } which ai.agent() collects and the chat renders as an
// approval card. Campaigns never launch from here.
const prisma = require('../../../lib/prisma');
const U = require('../util');

const tools = [];
const def = (t) => tools.push({ kind: 'propose', ...t });

// Copy rules for outbound client texts: no em dashes, no emoji.
function cleanCopy(s) {
  return String(s || '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

async function channelFor(workspaceId, client) {
  const convo = await prisma.conversation.findFirst({ where: { workspaceId, clientId: client.id, isGroup: false }, orderBy: { lastMessageAt: 'desc' }, select: { id: true, channel: true } });
  const channel = (convo && convo.channel) || client.deviceMode || 'imessage';
  return { conversationId: convo ? convo.id : null, channel: channel === 'sms' ? 'sms' : channel === 'email' ? 'email' : 'imessage' };
}

def({
  name: 'draft_text',
  description: 'Draft a text message (iMessage/SMS) to a client for the agent to review and send. NOTHING is sent — the agent approves it. Keep it short, warm, specific, in the agent\'s voice; start with the client\'s first name; one clear ask; no emoji; no em dashes. Never quote a whisper price guide. For several recipients call it once per client.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, body: { type: 'string' }, listing_id: { type: 'string' }, reason: { type: 'string', description: 'Why this text, in a few words (shown to the agent)' } }, required: ['client_id', 'body'] },
  activity: (i, ctx) => `Drafting a text to ${ctx.names.get(i.client_id) || 'them'}…`,
  async run(input, ctx) {
    const c = await U.getClientLite(ctx.workspaceId, input.client_id);
    if (!c) throw new Error(`No client with id ${input.client_id}.`);
    if (c.textOptOut) throw new Error(`${U.nameOf(c)} opted out of texts — suggest a call or email instead.`);
    if (!c.phone) {
      const convo = await prisma.conversation.findFirst({ where: { workspaceId: ctx.workspaceId, clientId: c.id } });
      if (!convo) throw new Error(`${U.nameOf(c)} has no phone number on file.`);
    }
    const { conversationId, channel } = await channelFor(ctx.workspaceId, c);
    const listing = input.listing_id ? await prisma.listing.findFirst({ where: { id: input.listing_id, workspaceId: ctx.workspaceId } }) : null;
    return {
      __proposal: {
        kind: 'text',
        summary: `Text to ${U.nameOf(c)}`,
        clientId: c.id,
        clientName: U.nameOf(c),
        to: c.phone ? U.formatPhone(c.phone) : null,
        conversationId,
        channel,
        body: cleanCopy(input.body),
        listingId: listing ? listing.id : null,
        listingLabel: listing ? U.addressOf(listing) : null,
        reason: input.reason || null,
      },
    };
  },
});

def({
  name: 'draft_email',
  description: 'Draft an email to a client for the agent to review and send (nothing is sent). Subject + body; polished, concise, specific.',
  input_schema: { type: 'object', properties: { client_id: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reason: { type: 'string' } }, required: ['client_id', 'subject', 'body'] },
  activity: (i, ctx) => `Drafting an email to ${ctx.names.get(i.client_id) || 'them'}…`,
  async run(input, ctx) {
    const c = await U.getClientLite(ctx.workspaceId, input.client_id);
    if (!c) throw new Error(`No client with id ${input.client_id}.`);
    if (!c.email) throw new Error(`${U.nameOf(c)} has no email on file — draft a text instead.`);
    return {
      __proposal: {
        kind: 'email', summary: `Email to ${U.nameOf(c)}`, clientId: c.id, clientName: U.nameOf(c), to: c.email,
        subject: cleanCopy(input.subject), body: cleanCopy(input.body), reason: input.reason || null,
      },
    };
  },
});

def({
  name: 'draft_campaign',
  description: 'Set up a campaign DRAFT (blast or automation) from a plain-English audience + message brief, e.g. "just-listed text to every buyer under $5M looking in Coconut Grove". It opens in the campaign builder for the agent to review the audience and messages. It NEVER launches — launching happens only when the agent explicitly says launch/send/start in the builder.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' }, brief: { type: 'string', description: 'What the message should say / accomplish' },
      audience: { type: 'string', description: 'Who should get it, in plain English' },
      trigger: { type: 'string', enum: ['just_listed', 'just_sold', 'open_house_invite', 'price_drop', 'market_update', 'home_anniversary', 'birthday', 'new_listing_match', 'showing_followup', 'post_closing', 'lease_expiry', 'none'] },
      listing_id: { type: 'string' },
    },
    required: ['brief', 'audience'],
  },
  activity: () => 'Setting up a campaign draft…',
  async run(input, ctx) {
    const listing = input.listing_id ? await prisma.listing.findFirst({ where: { id: input.listing_id, workspaceId: ctx.workspaceId } }) : null;
    return {
      __proposal: {
        kind: 'campaign', summary: `Campaign draft · ${input.name || U.clip(input.brief, 40)}`,
        name: input.name || (listing ? `Just listed · ${U.addressOf(listing)}` : U.clip(input.brief, 48)),
        brief: input.brief, audience: input.audience, trigger: input.trigger && input.trigger !== 'none' ? input.trigger : null,
        listingId: listing ? listing.id : null, listingLabel: listing ? U.addressOf(listing) : null,
      },
    };
  },
});

module.exports = { tools, cleanCopy };
