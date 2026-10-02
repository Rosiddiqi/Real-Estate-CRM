// The ONE Claude client for every AI feature (RevMatch pattern: all AI routes
// through a single module). Features never import the SDK directly.
//
//   const ai = require('../ai/claude');
//   if (ai.available()) {
//     const out = await ai.json({ system, prompt, schema, effort: 'low', feature: 'reply_suggestions', workspaceId });
//     const text = await ai.text({ system, prompt, effort: 'medium', ... });
//   }
//   await ai.agent({ system, messages, tools, onText, workspaceId })  // tool-use loop (Serena)
//
// Design rules carried over from RevMatch:
//  - AI is a co-pilot: it suggests/drafts; customer-facing sends need approval.
//  - Never block the UI on AI: callers run these async and render fallbacks.
//  - Every feature MUST have a deterministic fallback for when available() is
//    false (no key, budget exhausted, outage) — the app stays fully usable.
//
// Model: Claude Opus 5.5 (`claude-opus-5-5`). Thinking is always on for this
// model; depth is controlled with `output_config.effort` (low|medium|high|
// xhigh|max — default medium, so we always set it explicitly). Refusals are
// handled with server-side fallbacks (`fallbacks: "default"`), and every
// response's stop_reason is checked before its content is read.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const PRICES = { // $ per 1M tokens — used only for the local budget guard
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

let client = null;
let disabledUntil = 0; // auth/config failure circuit breaker
let fallbacksSupported = true;

function hasCredentials() {
  return Boolean(config.ai.anthropicKey || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  if (!client) {
    client = config.ai.anthropicKey ? new Anthropic({ apiKey: config.ai.anthropicKey }) : new Anthropic();
  }
  return client;
}

function available() {
  return hasCredentials() && Date.now() > disabledUntil;
}

// ── Budget tracking (per workspace per day) ───────────────────────────────
const usageToday = new Map(); // `${workspaceId}:${day}` -> usd
const dayKey = () => new Date().toISOString().slice(0, 10);

function costOf(model, usage) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  if (!usage) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (inTok * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

async function recordUsage({ workspaceId, feature, model, usage }) {
  const usd = costOf(model, usage);
  const key = `${workspaceId || 'global'}:${dayKey()}`;
  usageToday.set(key, (usageToday.get(key) || 0) + usd);
  try {
    const prisma = require('../lib/prisma');
    if (prisma.aiUsage && workspaceId) {
      await prisma.aiUsage.create({
        data: {
          workspaceId,
          feature: feature || 'unknown',
          model,
          inputTokens: usage?.input_tokens || 0,
          outputTokens: usage?.output_tokens || 0,
          cacheReadTokens: usage?.cache_read_input_tokens || 0,
          costUsd: usd,
        },
      });
    }
  } catch (_) { /* usage logging must never break a feature */ }
}

function overBudget(workspaceId) {
  const spent = usageToday.get(`${workspaceId || 'global'}:${dayKey()}`) || 0;
  return spent >= config.ai.dailyBudgetUsd;
}

class AiUnavailableError extends Error {
  constructor(reason) {
    super(`AI unavailable: ${reason}`);
    this.code = 'ai_unavailable';
  }
}

function guard(workspaceId) {
  if (!hasCredentials()) throw new AiUnavailableError('no_api_key');
  if (Date.now() <= disabledUntil) throw new AiUnavailableError('circuit_open');
  if (overBudget(workspaceId)) throw new AiUnavailableError('daily_budget_reached');
}

function onApiError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    disabledUntil = Date.now() + 10 * 60 * 1000;
    console.error('[ai] auth failed — AI disabled for 10 minutes');
  }
}

// Build request params shared by every call.
function baseParams({ system, messages, effort = 'medium', maxTokens = 16000, model, cache = true, format, tools }) {
  const params = {
    model: model || config.ai.model,
    max_tokens: maxTokens,
    messages,
    output_config: { effort, ...(format ? { format } : {}) },
  };
  if (system) {
    // Stable system prompt first, cached; volatile context goes in messages.
    params.system = Array.isArray(system)
      ? system
      : [{ type: 'text', text: system, ...(cache ? { cache_control: { type: 'ephemeral' } } : {}) }];
  }
  if (tools && tools.length) params.tools = tools;
  return params;
}

async function create(params) {
  const c = getClient();
  if (fallbacksSupported) {
    try {
      return await c.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
    } catch (err) {
      // If this account/endpoint rejects the fallback beta, retry once without
      // it and stop sending it for the life of the process.
      if (err instanceof Anthropic.BadRequestError) {
        fallbacksSupported = false;
        console.warn('[ai] server-side fallbacks rejected; continuing without them');
        return c.messages.create(params);
      }
      throw err;
    }
  }
  return c.messages.create(params);
}

function stream(params) {
  const c = getClient();
  if (fallbacksSupported) return c.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
  return c.messages.stream(params);
}

function textOf(message) {
  return (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// Make an object JSON schema satisfy structured-output rules: every object gets
// additionalProperties:false and lists all its properties as required.
function strictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const s = Array.isArray(schema) ? schema.map(strictSchema) : { ...schema };
  if (s.type === 'object' && s.properties) {
    s.additionalProperties = false;
    s.required = Object.keys(s.properties);
    s.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, strictSchema(v)]));
  }
  if (s.items) s.items = strictSchema(s.items);
  for (const key of ['anyOf', 'allOf', 'oneOf']) if (s[key]) s[key] = s[key].map(strictSchema);
  delete s.minimum; delete s.maximum; delete s.minLength; delete s.maxLength;
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────

// Plain text completion.
async function text({ system, prompt, messages, effort = 'medium', maxTokens = 8000, feature, workspaceId, model }) {
  guard(workspaceId);
  const params = baseParams({ system, messages: messages || [{ role: 'user', content: prompt }], effort, maxTokens, model });
  try {
    const msg = await create(params);
    await recordUsage({ workspaceId, feature, model: params.model, usage: msg.usage });
    if (msg.stop_reason === 'refusal') return null;
    return textOf(msg);
  } catch (err) {
    onApiError(err);
    throw err;
  }
}

// Structured JSON output validated against `schema` (a JSON schema object).
async function json({ system, prompt, messages, schema, effort = 'low', maxTokens = 8000, feature, workspaceId, model }) {
  guard(workspaceId);
  const params = baseParams({
    system,
    messages: messages || [{ role: 'user', content: prompt }],
    effort,
    maxTokens,
    model,
    format: { type: 'json_schema', schema: strictSchema(schema) },
  });
  try {
    const msg = await create(params);
    await recordUsage({ workspaceId, feature, model: params.model, usage: msg.usage });
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return null;
    const raw = textOf(msg);
    try { return JSON.parse(raw); } catch { return null; }
  } catch (err) {
    onApiError(err);
    throw err;
  }
}

// Streamed text — calls onText(delta) as tokens arrive, resolves full text.
async function streamText({ system, messages, effort = 'medium', maxTokens = 16000, onText, feature, workspaceId, model }) {
  guard(workspaceId);
  const params = baseParams({ system, messages, effort, maxTokens, model });
  try {
    const s = stream(params);
    if (onText) s.on('text', (d) => { try { onText(d); } catch (_) {} });
    const msg = await s.finalMessage();
    await recordUsage({ workspaceId, feature, model: params.model, usage: msg.usage });
    if (msg.stop_reason === 'refusal') return null;
    return textOf(msg);
  } catch (err) {
    onApiError(err);
    throw err;
  }
}

// Tool-use agent loop (manual, so tools can gate customer-facing actions).
//   tools: [{ name, description, input_schema, run: async (input, ctx) => any }]
// A tool's run() may return { __proposal: {...} } to request user approval
// instead of acting; proposals are collected and returned to the caller.
async function agent({ system, messages, tools = [], effort = 'medium', maxTurns = 8, maxTokens = 16000, onText, onToolCall, feature = 'agent', workspaceId, ctx = {} }) {
  guard(workspaceId);
  const defs = tools.map(({ run, ...def }) => def);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const convo = [...messages];
  const proposals = [];
  let finalText = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    const params = baseParams({ system, messages: convo, effort, maxTokens, tools: defs });
    let msg;
    try {
      const s = stream(params);
      if (onText) s.on('text', (d) => { try { onText(d); } catch (_) {} });
      msg = await s.finalMessage();
    } catch (err) {
      onApiError(err);
      throw err;
    }
    await recordUsage({ workspaceId, feature, model: params.model, usage: msg.usage });
    finalText += textOf(msg) ? `${finalText ? '\n\n' : ''}${textOf(msg)}` : '';

    if (msg.stop_reason === 'refusal') break;
    if (msg.stop_reason === 'pause_turn') { convo.push({ role: 'assistant', content: msg.content }); continue; }
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;
    if (msg.stop_reason === 'max_tokens') break;

    convo.push({ role: 'assistant', content: msg.content });
    const results = await Promise.all(uses.map(async (u) => {
      const tool = byName.get(u.name);
      if (onToolCall) { try { onToolCall({ name: u.name, input: u.input }); } catch (_) {} }
      if (!tool) return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` };
      try {
        const out = await tool.run(u.input || {}, ctx);
        if (out && out.__proposal) {
          proposals.push({ tool: u.name, ...out.__proposal });
          return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ status: 'proposed_awaiting_user_approval', summary: out.__proposal.summary || null }) };
        }
        return { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: String(err.message || err) };
      }
    }));
    convo.push({ role: 'user', content: results });
  }

  return { text: finalText.trim(), proposals, messages: convo };
}

function status() {
  return {
    available: available(),
    hasKey: hasCredentials(),
    model: config.ai.model,
    circuitOpenUntil: disabledUntil > Date.now() ? new Date(disabledUntil).toISOString() : null,
  };
}

module.exports = { available, text, json, streamText, agent, status, strictSchema, AiUnavailableError };
