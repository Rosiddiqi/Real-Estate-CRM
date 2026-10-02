// Which line places an outbound call — resolved per workspace:
//   'twilio'    click-to-call bridge (TWILIO_* + AGENT_CELL_NUMBER configured)
//   'simulated' the demo line: scripted conversation, live transcript, co-pilot cues
//   'device'    the agent's own phone: we hand the number to the system dialer
//               (tel:) and they log the outcome when they come back to the app
//
// CALL_SIMULATOR (env) decides who gets the demo line when Twilio isn't set up:
//   all  — every workspace            (default outside production)
//   demo — only the demo workspace    (default in production)
//   off  — nobody ("none" works too); everyone dials from their own phone
const prisma = require('../../lib/prisma');
const config = require('../../config');
const twilio = require('./twilio');

function simulatorPolicy() {
  const v = String(process.env.CALL_SIMULATOR || '').trim().toLowerCase();
  if (v === 'all' || v === 'demo' || v === 'off') return v;
  if (v === 'none') return 'off';
  return config.isProd ? 'demo' : 'all';
}

// The demo workspace is whichever one the demo user lives in (re-seeds can recreate it).
async function demoWorkspaceId() {
  const email = String(process.env.DEMO_EMAIL || 'demo@keymatch.app').toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email }, select: { workspaceId: true } }).catch(() => null);
  return user ? user.workspaceId : null;
}

async function callModeFor(workspaceId) {
  if (twilio.enabled()) return 'twilio';
  const policy = simulatorPolicy();
  if (policy === 'all') return 'simulated';
  if (policy === 'demo' && workspaceId && workspaceId === (await demoWorkspaceId())) return 'simulated';
  return 'device';
}

module.exports = { callModeFor, simulatorPolicy, demoWorkspaceId };
