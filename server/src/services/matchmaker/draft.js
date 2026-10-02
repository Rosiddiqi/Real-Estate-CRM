// "Draft a text" — ghost-writes ONE text to a client about a home, in the
// agent's own voice with that client (voice samples + thread + notes + calls),
// with mode-specific factual rules (spec 06 §4.9 / §8.6–8.8):
//   listing          just listed / new to them — exact home, no invented facts
//   price_drop       may state ONLY the two exact prices (was → now)
//   whisper          opener only ("just heard … may come to market quietly")
//                    + deterministic "Here are some details:" bullets; never a
//                    date, never the price guide, never an owner or address
//   offmarket_owner  to the OWNER: a qualified buyer is looking for a home like theirs
//   offmarket_buyer  to the BUYER: a fitting home may be available privately
// Neither off-market draft reveals the other party. Never auto-sent: the UI
// opens the thread composer seeded with the text. Deterministic templates when
// AI is unavailable or fails.
const prisma = require('../../lib/prisma');
const ai = require('../../ai/claude');
const config = require('../../config');
const shape = require('../listings/shape');
const V = require('./vocab');
const { money } = require('./score');

const fmtMoney = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;

const SYSTEM = `You ghost-write ONE text message from a luxury real-estate agent to one of their clients, in the agent's EXACT voice.

VOICE: imitate the agent's sample texts: their length, punctuation, warmth, greeting, capitalization. If the samples are short and casual, be short and casual. Never sound like an assistant, a marketer or a listing description.

SHAPE: open warmly with the client's first name, say what the home is (use the exact description given), one line on why it made you think of them (only from the CLIENT CONTEXT or the FIT notes), and a light, single ask (a private showing, a call, "want details?"). Two to four sentences.

HARD RULES
- Reply with ONLY the message body. No quotes, no labels, no explanation.
- Never use an em dash or en dash. Use a period, comma, colon, or parentheses.
- No emoji. No hashtags. No URLs (a link is added separately).
- Never invent a fact, price, date, feature, name, or reason. Use only what is given.
- Never mention other clients, owners, or who is selling.
- FAIR HOUSING: never reference protected classes or demographics (schools for kids, "family neighborhood", religion, nationality, age, disability, "safe area"). Talk about the home and the places the client named.`;

function sanitize(text) {
  let t = String(text || '').trim();
  t = t.replace(/^(text|message|draft)\s*:\s*/i, '').replace(/^["“”']+|["“”']+$/g, '');
  t = t.replace(/\s*[—–]\s*/g, ', ');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu, '');
  t = t.replace(/https?:\/\/\S+/g, '').replace(/[ \t]+/g, ' ').replace(/ ,/g, ',').trim();
  if (t.length > 480) {
    const cut = t.slice(0, 480);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > 200 ? cut.slice(0, end + 1) : cut;
  }
  return t;
}

// Deterministic "Here are some details:" bullets for whispers (never price/date/address/owner).
function whisperDetails(l) {
  const lines = [];
  const baths = l.bathsTotal || (l.bathsFull ? l.bathsFull + (l.bathsHalf ? 0.5 * l.bathsHalf : 0) : null);
  if (l.beds || baths) lines.push(`${l.beds ? `${l.beds} beds` : ''}${l.beds && baths ? ' / ' : ''}${baths ? `${baths} baths` : ''}`);
  if (l.livingAreaSqft) lines.push(`${Number(l.livingAreaSqft).toLocaleString('en-US')} interior sq ft`);
  const lot = l.lotSqft || (l.lotAcres ? l.lotAcres * 43560 : null);
  if (lot && (!l.propertyType || !/condo|penthouse|co_op/.test(String(l.propertyType)))) {
    const ac = lot / 43560;
    lines.push(`${ac >= 1 ? `${ac.toFixed(ac >= 10 ? 0 : 1).replace(/\.0$/, '')} acre` : `${Math.round(lot).toLocaleString('en-US')} sq ft`} lot`);
  }
  const wf = V.canonicalWaterfront(l.waterfront);
  const views = (l.views || []).filter(Boolean);
  if ((wf && wf !== 'none') || views.length) {
    lines.push([wf && wf !== 'none' ? V.WATERFRONT_LABEL[wf] : null, views.length ? `${views.slice(0, 2).join(' & ')} views` : null].filter(Boolean).join(', '));
  }
  if (l.architecturalStyle) lines.push(`${l.architecturalStyle} architecture`);
  const am = (l.amenities || []).filter(Boolean).slice(0, 6);
  if (am.length) lines.push(`Key amenities: ${am.join(', ')}`);
  return lines.filter(Boolean);
}

function fitHooks(result) {
  if (!result || !Array.isArray(result.factors)) return [];
  return result.factors.filter((f) => f.polarity === 'match').slice(0, 4).map((f) => f.detail);
}

function isFresh(l) {
  const at = l.listedAt || l.createdAt;
  return at && Date.now() - new Date(at).getTime() < 14 * 864e5;
}

// ── fallback templates ────────────────────────────────────────────────────
function template({ mode, first, l, pp, result, place }) {
  const hi = `Hi ${first || 'there'},`;
  if (mode === 'price_drop' && l) {
    const label = shape.clientLabel(l);
    const crossed = result && result.crossedBudget;
    return `${hi} the price on ${label} just came down from ${fmtMoney(l.previousPrice)} to ${fmtMoney(l.listPrice)}.${crossed ? ' That puts it right in your range.' : ''} Want to take another look this week?`;
  }
  if (mode === 'whisper' && l) {
    const what = shape.clientLabel(l);
    return `${hi} just heard a ${what} may come to market quietly. Wanted to see if you'd be interested before anyone else hears about it.`;
  }
  if (mode === 'offmarket_owner') {
    const where = place ? ` in ${place}` : '';
    return `${hi} hope all is well. I'm working with a qualified buyer looking specifically for a home like yours${where}. Would you ever consider a private offer? No pressure at all, just wanted to ask before anything else.`;
  }
  if (mode === 'offmarket_buyer') {
    const where = place ? ` in ${place}` : '';
    return `${hi} a home that fits what you're after${where} may be available privately, not on the market. Want me to find out more?`;
  }
  if (l) {
    const label = shape.clientLabel(l);
    const hooks = (result && result.factors || []).filter((f) => f.polarity === 'match').map((f) => f.key);
    const wf = V.canonicalWaterfront(l.waterfront);
    const water = hooks.includes('waterfront') && wf && wf !== 'none' ? V.WATERFRONT_LABEL[wf].toLowerCase() : null;
    const details = [];
    if (hooks.includes('beds') && l.beds) details.push(`${l.beds} bedrooms`);
    if (hooks.includes('livingArea') && l.livingAreaSqft) details.push(`${Number(l.livingAreaSqft).toLocaleString('en-US')} sq ft`);
    if (hooks.includes('view') && (l.views || []).length) details.push(`${l.views[0]} views`);
    const list = details.length > 1 ? `${details.slice(0, -1).join(', ')} and ${details[details.length - 1]}` : details[0];
    const opener = isFresh(l) ? `${label} just came on` : `I came across ${label}`;
    const reason = water
      ? ` It's ${water}${list ? ` with ${list}` : ''}, right in line with what you described.`
      : list ? ` It has ${list}, right in line with what you described.` : ' It made me think of you.';
    return `${hi} ${opener}.${reason} Want me to set up a private showing?`;
  }
  return `${hi} I came across a home I think you'd love. Want me to send you the details?`;
}

// ── context for the AI (voice + client) ───────────────────────────────────
async function clientContext(workspaceId, clientId) {
  const [client, convs, calls] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true, firstName: true, lastName: true, displayName: true, notes: true, aiSummary: true, deviceMode: true, preferredChannel: true } }),
    prisma.conversation.findMany({ where: { workspaceId, clientId }, select: { id: true, channel: true }, orderBy: { lastMessageAt: 'desc' }, take: 3 }),
    prisma.phoneCall.findMany({ where: { workspaceId, clientId, summary: { not: null } }, orderBy: { startedAt: 'desc' }, take: 3, select: { summary: true, startedAt: true } }),
  ]);
  const convIds = convs.map((c) => c.id);
  const [thread, mine] = await Promise.all([
    convIds.length ? prisma.message.findMany({ where: { workspaceId, conversationId: { in: convIds }, body: { not: null } }, orderBy: { sentAt: 'desc' }, take: 10, select: { body: true, isFromMe: true } }) : [],
    convIds.length ? prisma.message.findMany({ where: { workspaceId, conversationId: { in: convIds }, isFromMe: true, body: { not: null }, campaignId: null }, orderBy: { sentAt: 'desc' }, take: 15, select: { body: true } }) : [],
  ]);
  let voice = mine.map((m) => m.body);
  if (voice.length < 5) {
    const ws = await prisma.message.findMany({ where: { workspaceId, isFromMe: true, body: { not: null }, campaignId: null, aiGenerated: false }, orderBy: { sentAt: 'desc' }, take: 15, select: { body: true } });
    voice = [...voice, ...ws.map((m) => m.body)].slice(0, 15);
  }
  return { client, thread: thread.reverse(), voice, calls, channel: convs[0] ? convs[0].channel : null };
}

function promptFor({ mode, ctx, agentFirst, l, pp, result, place }) {
  const first = ctx.client ? (ctx.client.firstName || String(ctx.client.displayName || '').split(' ')[0]) : '';
  const parts = [`AGENT: ${agentFirst || 'the agent'}`, `CLIENT FIRST NAME: ${first || '(unknown, greet warmly without a name)'}`];
  if (mode === 'price_drop' && l) {
    parts.push(`THE HOME: ${shape.clientLabel(l)}`);
    parts.push(`PRICE: it was ${fmtMoney(l.previousPrice)} and is now ${fmtMoney(l.listPrice)}. These are the ONLY prices you may mention, exactly as written.`);
    if (result && result.crossedBudget) parts.push('The new price is now within the budget this client gave you.');
    parts.push('TASK: text this client that the price just came down on this home and you thought of them. Do not say it just came on the market.');
  } else if (mode === 'whisper' && l) {
    parts.push(`THE HOME (describe it only like this): a ${shape.clientLabel(l)}`);
    parts.push('IMPORTANT: this home is NOT on the market. You heard it may come to market quietly. Never give a date or timeframe, never a price, never an address, never who owns it.');
    parts.push(`TASK: write ONLY the opening, following this plot in your own voice: "Just heard a ${shape.clientLabel(l)} may come to market quietly, wanted to see if you'd be interested." One or two short sentences. Do NOT list details or write "here are some details"; they are added after your text automatically.`);
  } else if (mode === 'offmarket_owner') {
    parts.push(`THEIR HOME: ${place || 'the home they own'}`);
    parts.push('TASK: ask, softly and respectfully, whether they would ever consider a private offer: you are working with a qualified buyer looking specifically for a home like theirs. Never name or describe the buyer. Never mention price. One soft ask, no pressure.');
  } else if (mode === 'offmarket_buyer') {
    parts.push(`THE HOME (describe only like this): a ${pp ? shape.descriptor(pp) : 'home'}${place ? ` in ${place}` : ''}`);
    parts.push('TASK: tell them a home that fits what they are after may be available privately, not on the market, and ask if they want you to find out more. Never mention the owner, an address, or a price.');
  } else if (l) {
    parts.push(`THE HOME: ${shape.clientLabel(l)}${l.listPrice ? ` (listed at ${fmtMoney(l.listPrice)})` : ''}`);
    parts.push(isFresh(l) ? 'It just came on the market.' : 'It is on the market (not brand new, so do not say it just came on).');
    parts.push('TASK: text this client about this home because it fits what they want, and offer a private showing.');
  }
  const hooks = fitHooks(result);
  if (hooks.length) parts.push(`FIT NOTES (why it fits; use at most one, in plain words):\n${hooks.map((h) => `- ${h}`).join('\n')}`);
  if (ctx.voice.length) parts.push(`AGENT'S OWN RECENT TEXTS (voice sample, imitate this):\n${ctx.voice.slice(0, 15).map((v) => `- ${String(v).slice(0, 220)}`).join('\n')}`);
  const hooksCtx = [];
  if (ctx.client && ctx.client.notes) hooksCtx.push(`notes: ${String(ctx.client.notes).slice(0, 400)}`);
  if (ctx.client && ctx.client.aiSummary) hooksCtx.push(`profile: ${String(ctx.client.aiSummary).slice(0, 300)}`);
  if (ctx.calls.length) hooksCtx.push(`recent calls: ${ctx.calls.map((c) => String(c.summary).slice(0, 160)).join(' | ')}`);
  if (hooksCtx.length) parts.push(`CLIENT CONTEXT (the ONLY allowed source of personal hooks):\n${hooksCtx.join('\n')}`);
  if (ctx.thread.length) parts.push(`RECENT THREAD (latest last):\n${ctx.thread.map((m) => `${m.isFromMe ? 'Me' : 'Them'}: ${String(m.body).slice(0, 200)}`).join('\n')}`);
  return parts.join('\n\n');
}

function shareUrl(l) {
  if (!l || !l.publicSlug) return null;
  return `${config.appUrl.replace(/\/$/, '')}/api/public/p/${l.publicSlug}`;
}

// → { text, ai: boolean, mode, channel }
async function draftText({ workspaceId, userId, clientId, mode = 'listing', listing = null, property = null, result = null }) {
  const ctx = await clientContext(workspaceId, clientId);
  const user = userId ? await prisma.user.findFirst({ where: { id: userId }, select: { firstName: true } }) : null;
  const first = ctx.client ? (ctx.client.firstName || String(ctx.client.displayName || '').split(' ')[0]) : '';
  const place = property ? (property.buildingName || property.neighborhood || property.subdivision || property.city || null) : null;
  const ppShape = property ? { ...property, bathsTotal: property.baths, livingAreaSqft: property.sqft } : null;
  let text = null;
  let usedAi = false;
  if (ai.available()) {
    try {
      const out = await ai.text({
        system: SYSTEM,
        prompt: promptFor({ mode, ctx, agentFirst: user && user.firstName, l: listing, pp: ppShape, result, place }),
        effort: 'medium', maxTokens: 8000, feature: `matchmaker_draft_${mode}`, workspaceId,
      });
      const clean = sanitize(out);
      if (clean && clean.length >= 8) { text = clean; usedAi = true; }
    } catch (err) {
      if (err && err.code !== 'ai_unavailable') console.warn('[matchmaker] draft AI failed, using template:', err.message);
    }
  }
  if (!text) text = template({ mode, first, l: listing, pp: ppShape, result, place });
  if (mode === 'whisper' && listing) {
    const details = whisperDetails(listing);
    if (details.length) text = `${text} Here are some details:\n${details.map((d) => `- ${d}`).join('\n')}`;
  }
  if ((mode === 'listing' || mode === 'price_drop') && listing) {
    const url = shareUrl(listing);
    if (url) text = `${text}\n${url}`;
  }
  return { text, ai: usedAi, mode, channel: ctx.channel };
}

module.exports = { draftText, sanitize, whisperDetails, template, shareUrl, money };
