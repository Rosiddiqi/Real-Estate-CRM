// /api/bridge — messaging transport status for Settings.
// The iMessage bridge (Mac pairing) is out of scope for this build (owner
// decision): the list is always empty and pairing endpoints answer 501 so the
// Settings UI can hide the pairing flow.
const express = require('express');
const { ah } = require('../lib/http');
const { providerInfo } = require('../services/messaging/providers');
const { messagingInfo } = require('../services/messaging/mode');

const router = express.Router();

// { bridges: [], provider, providerLabel, twilio, messaging: { mode, provider, label, canAutoSend } }
// messaging.mode is per workspace: 'demo' | 'twilio' | 'device' (see services/messaging/mode.js).
router.get('/', ah(async (req, res) => {
  const info = providerInfo();
  const messaging = await messagingInfo(req.workspaceId);
  res.json({
    bridges: [],
    provider: messaging.mode === 'device' ? 'device' : messaging.mode,
    providerLabel: messaging.label || info.label,
    twilio: info.twilio,
    messaging,
  });
}));

const notAvailable = (req, res) => res.status(501).json({ error: 'iMessage bridge pairing is not available in this build' });
router.post('/', notAvailable);
router.delete('/:id', notAvailable);

module.exports = router;
