// /api/book — Book of Business.
//   GET /api/book                         → { closings:[…newest first], stats:{closings, clients, volume, gci} }
//   GET /api/book/clients?sort=&search=   → { clients:[…], total, stats:{clients, lifetimeVolume, lifetimeGci, avgPrice, repeat} }
//       sort: volume (default) | gci | recent | alpha | rating | transactions
// Editing a closing date goes through PATCH /api/deals/:id { closedAt }.
const express = require('express');
const { ah } = require('../lib/http');
const { bookLedger, bookClients } = require('../services/pipeline/summary');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  res.json(await bookLedger(req.workspaceId));
}));

router.get('/clients', ah(async (req, res) => {
  const sort = String(req.query.sort || 'volume');
  res.json(await bookClients(req.workspaceId, { sort, search: req.query.search || '' }));
}));

module.exports = router;
