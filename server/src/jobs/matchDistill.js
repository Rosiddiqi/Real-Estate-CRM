// Matchmaker AI distillation (only when an Anthropic key is configured):
// reads each searching client's texts / calls / notes into must-haves,
// signals and sell signals, cached by content hash — so this is nearly free
// after the first pass. Runs a minute after boot, then every 6 hours.
const prisma = require('../lib/prisma');
const ai = require('../ai/claude');
const { distillWorkspace } = require('../services/matchmaker/distill');
const { bustPool } = require('../services/matchmaker/pool');

module.exports = {
  name: 'match-distill',
  intervalMs: 6 * 3600 * 1000,
  runOnBoot: true,
  bootDelayMs: 60000,
  run: async () => {
    if (!ai.available()) return;
    const ws = await prisma.workspace.findMany({ select: { id: true } });
    for (const w of ws) {
      const r = await distillWorkspace(w.id, { limit: 40 });
      if (r.ran) bustPool(w.id);
    }
  },
};
