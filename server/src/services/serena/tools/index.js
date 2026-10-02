// Tool registry + the per-turn runner. Every tool call (from the AI loop or
// the offline router) goes through runTool so the chat gets the same live
// activity lines, receipts and proposals either way.
const { tools: readTools } = require('./read');
const { tools: writeTools } = require('./write');
const { tools: proposeTools } = require('./propose');

const ALL = [...readTools, ...writeTools, ...proposeTools];
const BY_NAME = new Map(ALL.map((t) => [t.name, t]));

function summarize(out) {
  if (!out || typeof out !== 'object') return 'done';
  if (out.needs_confirmation) return 'needs confirmation';
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v) && !k.startsWith('_')) return `${v.length} ${k.replace(/_/g, ' ')}`;
  }
  if (out.name) return String(out.name);
  if (out.title) return String(out.title);
  return 'done';
}

function activityLine(tool, input, ctx) {
  try { return tool.activity ? tool.activity(input || {}, ctx) : `Running ${tool.name.replace(/_/g, ' ')}…`; } catch { return 'Working on it…'; }
}

// turn = { ctx, emit(event, data), addCard(card, toolName) → card, addProposal(p, toolName) → p, activity: [] }
async function runTool(name, input, turn) {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const id = `t${turn.activity.length + 1}`;
  const label = activityLine(tool, input, turn.ctx);
  const entry = { id, name, kind: tool.kind, label, ok: null };
  turn.activity.push(entry);
  turn.emit('tool.call', { id, name, kind: tool.kind, label });
  try {
    const out = await tool.run(input || {}, turn.ctx);
    let result = out;
    let card = null;
    let proposal = null;
    if (out && out.__card) {
      card = turn.addCard({ ...out.__card, tool: name });
      result = { ...out };
      delete result.__card;
      result.receipt = 'An action card with Undo is shown to the agent.';
    }
    if (out && out.__proposal) {
      proposal = turn.addProposal({ ...out.__proposal, tool: name });
      result = out; // ai.agent() turns this into "proposed_awaiting_user_approval"
    }
    entry.ok = true;
    entry.summary = proposal ? 'drafted for approval' : card ? card.label : summarize(result);
    turn.emit('tool.result', { id, ok: true, summary: entry.summary });
    return { result, card, proposal };
  } catch (err) {
    entry.ok = false;
    entry.summary = String(err.message || err).slice(0, 200);
    turn.emit('tool.result', { id, ok: false, summary: entry.summary });
    throw err;
  }
}

// Tool definitions for ai.agent(): run() returns what the model should see.
function agentTools(turn) {
  return ALL.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    run: async (input) => {
      const { result } = await runTool(t.name, input, turn);
      return result;
    },
  }));
}

module.exports = { ALL, BY_NAME, runTool, agentTools };
