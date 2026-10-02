// AI plumbing endpoints.
//   GET /api/ai/status → { enabled, available, hasKey, model, circuitOpenUntil, assistantName }
// Clients hide AI-only affordances when disabled; Serena keeps working in
// offline mode (deterministic router) either way.
const express = require('express');
const ai = require('../ai/claude');
const config = require('../config');
const { ah } = require('../lib/http');

const router = express.Router();

router.get('/status', ah(async (req, res) => {
  const s = ai.status();
  const user = await req.getUser().catch(() => null);
  const name = (user && user.aiPreferences && user.aiPreferences.aiName) || config.brand.assistantName;
  res.json({ ...s, enabled: s.available, assistantName: name, mode: s.available ? 'ai' : 'offline' });
}));

module.exports = router;
