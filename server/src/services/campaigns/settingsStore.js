// Atomic read/merge helpers for the campaign keys inside Workspace.settings
// (a shared jsonb column — other features keep their own keys there, so we
// never rewrite the whole object: every write is a jsonb merge on one key).
//
// Keys owned by campaigns:
//   senderGuard         the number's guard state (warm-up, budgets, breaker…)
//   campaignCursor      ISO timestamp — the reply poller's high-water mark
//   aiTextingPausedAt   master kill switch for every automated text (ISO|null)
//   automationsRun      {dayKey, at} — last automation trigger sweep
const prisma = require('../../lib/prisma');

async function readSettings(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true, timezone: true } });
  return { settings: (ws && ws.settings && typeof ws.settings === 'object') ? ws.settings : {}, timezone: (ws && ws.timezone) || 'America/New_York' };
}

// settings[key] = { ...settings[key], ...patch }  (object merge, one statement)
async function mergeKey(workspaceId, key, patch) {
  const path = `{${key}}`;
  await prisma.$executeRaw`UPDATE "Workspace"
    SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      ${path}::text[],
      (CASE WHEN jsonb_typeof(settings->${key}) = 'object' THEN settings->${key} ELSE '{}'::jsonb END) || ${JSON.stringify(patch || {})}::jsonb,
      true)
    WHERE id = ${workspaceId}`;
}

// settings[key] = value  (any JSON value, including null)
async function setKey(workspaceId, key, value) {
  const path = `{${key}}`;
  await prisma.$executeRaw`UPDATE "Workspace"
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ${path}::text[], ${JSON.stringify(value === undefined ? null : value)}::jsonb, true)
    WHERE id = ${workspaceId}`;
}

async function getKey(workspaceId, key) {
  const { settings } = await readSettings(workspaceId);
  return settings[key];
}

module.exports = { readSettings, mergeKey, setKey, getKey };
