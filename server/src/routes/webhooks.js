// /api/webhooks — PUBLIC (no JWT). Provider callbacks.
//   POST /api/webhooks/twilio/sms     inbound SMS/MMS (signature-verified)
//   POST /api/webhooks/twilio/status  delivery status callback
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ah } = require('../lib/http');
const { toE164 } = require('../lib/phone');
const { ingestInbound } = require('../services/messaging/ingest');
const { applyStatus } = require('../services/messaging/status');
const twilioProvider = require('../services/messaging/providers/twilio');

const router = express.Router();
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function publicUrl(req) {
  const base = String(process.env.PUBLIC_URL || config.appUrl || '').replace(/\/$/, '');
  return `${base || `${req.protocol}://${req.get('host')}`}${req.originalUrl}`;
}

function verifyTwilio(req) {
  if (!config.twilio.authToken) return false;
  try {
    const twilio = require('twilio');
    const sig = req.get('X-Twilio-Signature') || '';
    return twilio.validateRequest(config.twilio.authToken, sig, publicUrl(req), req.body || {});
  } catch {
    return false;
  }
}

async function workspaceForNumber(to) {
  const e164 = toE164(to);
  try {
    const ws = await prisma.workspace.findFirst({ where: { settings: { path: ['twilioNumber'], equals: e164 } }, select: { id: true } });
    if (ws) return ws.id;
  } catch { /* JSON path filter unsupported → fall through */ }
  if (config.twilio.phoneNumber && toE164(config.twilio.phoneNumber) === e164) {
    const first = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return first ? first.id : null;
  }
  return null;
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/mpeg': '.mp3', 'audio/amr': '.amr', 'application/pdf': '.pdf' };

async function rehostMedia(workspaceId, url, mimeType) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const name = `${crypto.randomUUID()}${EXT[mimeType] || ''}`;
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, name), buf);
    const row = await prisma.mediaFile.create({ data: { workspaceId, url: `/uploads/${name}`, mimeType, fileName: name, size: buf.length } });
    return { url: row.url, mimeType, fileName: name, size: buf.length };
  } catch (err) {
    console.error('[twilio] media rehost failed:', err.message);
    return { url, mimeType, fileName: 'attachment' };
  }
}

const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
const START_RE = /^\s*(start|unstop|yes)\s*$/i;

router.post('/twilio/sms', ah(async (req, res) => {
  if (!twilioProvider.configured()) return res.status(503).json({ error: 'Twilio is not configured' });
  if (!verifyTwilio(req)) return res.status(403).json({ error: 'Invalid Twilio signature' });
  const p = req.body || {};
  const workspaceId = await workspaceForNumber(p.To);
  res.type('text/xml');
  if (!workspaceId) return res.send(EMPTY_TWIML);
  const n = Math.min(10, parseInt(p.NumMedia, 10) || 0);
  const attachments = [];
  for (let i = 0; i < n; i++) {
    if (p[`MediaUrl${i}`]) attachments.push(await rehostMedia(workspaceId, p[`MediaUrl${i}`], p[`MediaContentType${i}`] || null));
  }
  const out = await ingestInbound({
    workspaceId, handle: p.From, body: p.Body || '', attachments, service: 'sms', externalId: p.MessageSid || null, provider: 'twilio',
  });
  // Carrier keywords: mirror STOP/START onto the client so automations respect it.
  if (out && out.message && out.message.clientId) {
    if (STOP_RE.test(p.Body || '')) {
      await prisma.client.update({ where: { id: out.message.clientId }, data: { textOptOut: true, textOptOutAt: new Date(), textOptOutReason: 'Replied STOP' } }).catch(() => {});
    } else if (START_RE.test(p.Body || '')) {
      await prisma.client.update({ where: { id: out.message.clientId }, data: { textOptOut: false, textOptOutReason: null } }).catch(() => {});
    }
  }
  res.send(EMPTY_TWIML);
}));

router.post('/twilio/status', ah(async (req, res) => {
  if (!twilioProvider.configured()) return res.status(503).json({ error: 'Twilio is not configured' });
  if (!verifyTwilio(req)) return res.status(403).json({ error: 'Invalid Twilio signature' });
  const p = req.body || {};
  const status = twilioProvider.mapStatus(p.MessageStatus);
  if (status && p.MessageSid) {
    const msg = await prisma.message.findFirst({ where: { externalId: p.MessageSid }, select: { workspaceId: true } });
    if (msg) {
      await applyStatus({
        workspaceId: msg.workspaceId,
        externalId: p.MessageSid,
        status,
        error: p.ErrorCode ? `Carrier error ${p.ErrorCode}${p.ErrorMessage ? `: ${p.ErrorMessage}` : ''}` : undefined,
      });
    }
  }
  res.sendStatus(204);
}));

module.exports = router;
