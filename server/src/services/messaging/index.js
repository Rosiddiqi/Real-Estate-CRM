// Messaging service facade — import from here (or send.js for the contract).
module.exports = {
  ...require('./send'),            // sendMessage, retryMessage, dispatchScheduled
  ...require('./ingest'),          // ingestInbound
  ...require('./status'),          // applyStatus, nextStatus
  ...require('./conversations'),   // resolveConversation, afterMessage
  ...require('./mode'),            // messagingModeFor, canAutoSend, assertCanAutoSend, messagingInfo
  events: require('./events'),     // in-process bus: inbound / outbound / status
};
