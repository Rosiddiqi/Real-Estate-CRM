// /api/bridge — messaging transport status for Settings.
// The iMessage bridge (Mac pairing) is out of scope for this build (owner
// decision): the list is always empty and pairing endpoints answer 501 so the
// Settings UI can hide the pairing flow.
const express = require('express');
const { ah } = require('../lib/http');
const { providerInfo } = require('../services/messaging/providers');

const router = express.Router();

router.get('/', ah(async (req, res) => {
  const info = providerInfo();
  res.json({ bridges: [], provider: info.id, providerLabel: info.label, twilio: info.twilio });
}));

const notAvailable = (req, res) => res.status(501).json({ error: 'iMessage bridge pairing is not available in this build' });
router.post('/', notAvailable);
router.delete('/:id', notAvailable);

module.exports = router;
