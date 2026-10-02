// /api/pipeline — stage configuration (the web's one source of truth) and the
// board summary (header totals, per-phase counts, Pipeline Health at-risk list).
//   GET /api/pipeline/stages   → stages.config()
//   GET /api/pipeline/summary  → { open, volume, estGci, estNet, weightedNet, byPhase, groups, newDev, atRisk, closingSoon, month }
const express = require('express');
const { ah } = require('../lib/http');
const S = require('../services/pipeline/stages');
const { boardSummary } = require('../services/pipeline/summary');

const router = express.Router();

router.get('/stages', (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json(S.config());
});

router.get('/summary', ah(async (req, res) => {
  res.json(await boardSummary(req.workspaceId));
}));

module.exports = router;
