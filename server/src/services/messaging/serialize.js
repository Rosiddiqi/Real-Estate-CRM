// Wire shapes for conversations + messages (the web client and every other
// feature consume exactly these).
const { formatPhone } = require('../../lib/phone');
const { clientName } = require('../../lib/clients');

// Prisma include for the conversation list / detail.
const CLIENT_SUMMARY_SELECT = {
  id: true, firstName: true, lastName: true, displayName: true, phone: true, email: true,
  avatarUrl: true, isWhale: true, rating: true, type: true, contactKind: true, vendorRole: true,
  status: true, deviceMode: true, neighborhood: true, city: true, lifetimeVolume: true,
  textOptOut: true, company: true,
};

const MESSAGE_INCLUDE = {
  attachments: { orderBy: { createdAt: 'asc' } },
  reactions: { orderBy: { createdAt: 'asc' } },
};

function isPhoneLabel(s) {
  return !!s && !/[a-zA-Z]/.test(s);
}

function conversationName(conv, client) {
  if (conv.isGroup) {
    if (conv.groupName) return conv.groupName;
    const parts = Array.isArray(conv.participants) ? conv.participants : [];
    const labels = parts
      .slice()
      .sort((a, b) => (!!b?.clientId - !!a?.clientId))
      .map((p) => (p?.name ? String(p.name).split(/\s+/)[0] : formatPhone(p?.handle)))
      .filter(Boolean);
    if (!labels.length) return conv.displayName || `Group (${parts.length || '?'})`;
    return labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` +${labels.length - 3}` : '');
  }
  if (client) {
    const n = clientName(client);
    if (n && n !== 'Unknown') return isPhoneLabel(n) ? formatPhone(n) : n;
  }
  const raw = conv.displayName || conv.handle || '';
  if (isPhoneLabel(raw)) return formatPhone(raw) || raw || 'Unknown';
  return raw || 'Unknown';
}

function clientSummary(c) {
  if (!c) return null;
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: c.displayName,
    phone: c.phone,
    email: c.email,
    avatarUrl: c.avatarUrl,
    isWhale: !!c.isWhale || (c.lifetimeVolume || 0) >= 10_000_000,
    rating: c.rating || 0,
    type: c.type,
    contactKind: c.contactKind,
    vendorRole: c.vendorRole,
    status: c.status,
    deviceMode: c.deviceMode,
    neighborhood: c.neighborhood,
    city: c.city,
    company: c.company,
    textOptOut: !!c.textOptOut,
  };
}

function serializeConversation(conv, extra = {}) {
  if (!conv) return null;
  const client = conv.client || null;
  const channel = conv.deliveryMode === 'sms' ? 'sms' : (conv.channel || 'imessage');
  return {
    id: conv.id,
    clientId: conv.clientId,
    handle: conv.handle,
    channel,
    displayName: conv.displayName,
    name: conversationName(conv, client),
    isGroup: !!conv.isGroup,
    groupName: conv.groupName,
    participants: conv.participants || null,
    lastMessageAt: conv.lastMessageAt,
    lastMessagePreview: conv.lastMessagePreview,
    lastMessageFromMe: conv.lastMessageFromMe,
    lastMessageStatus: conv.lastMessageStatus,
    unreadCount: conv.unreadCount || 0,
    pinned: !!conv.pinned,
    muted: !!conv.muted,
    archived: !!conv.archived,
    blocked: !!conv.blocked,
    lane: conv.lane || 'active',
    deliveryMode: conv.deliveryMode,
    deliveryModeReason: conv.deliveryModeReason,
    aiSummary: conv.aiSummary,
    aiSummaryAt: conv.aiSummaryAt,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    client: clientSummary(client),
    ...extra,
  };
}

function serializeAttachment(a) {
  return {
    id: a.id,
    url: a.url,
    mimeType: a.mimeType,
    fileName: a.fileName,
    size: a.size,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    thumbnailUrl: a.thumbnailUrl,
    kind: a.kind,
  };
}

function serializeReaction(r) {
  return { id: r.id, type: r.type, emoji: r.emoji, isFromMe: r.isFromMe, senderHandle: r.senderHandle, createdAt: r.createdAt };
}

function serializeMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    clientId: m.clientId,
    isFromMe: m.isFromMe,
    body: m.body,
    kind: m.kind,
    service: m.service,
    status: m.status,
    error: m.error,
    sentAt: m.sentAt,
    deliveredAt: m.deliveredAt,
    readAt: m.readAt,
    scheduledFor: m.scheduledFor,
    clientTempId: m.clientTempId,
    replyToId: m.replyToId,
    senderName: m.senderName,
    senderHandle: m.senderHandle,
    campaignId: m.campaignId,
    aiGenerated: !!m.aiGenerated,
    meta: m.meta || null,
    attachments: (m.attachments || []).map(serializeAttachment),
    reactions: (m.reactions || []).map(serializeReaction),
    createdAt: m.createdAt,
  };
}

module.exports = {
  CLIENT_SUMMARY_SELECT,
  MESSAGE_INCLUDE,
  conversationName,
  clientSummary,
  serializeConversation,
  serializeMessage,
  serializeAttachment,
  serializeReaction,
};
