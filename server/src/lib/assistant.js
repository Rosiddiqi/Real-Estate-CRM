// The agent's own assistant — named (and given a personality) by each agent in
// onboarding. Server text that names the assistant goes through here, never a
// hard-coded name.
const prisma = require('./prisma');
const config = require('../config');

function nameFromUser(user) {
  const n = user && user.aiPreferences && user.aiPreferences.aiName;
  return (typeof n === 'string' && n.trim()) || config.brand.assistantName;
}

async function assistantName(userId) {
  if (!userId) return config.brand.assistantName;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { aiPreferences: true } });
    return nameFromUser(u);
  } catch {
    return config.brand.assistantName;
  }
}

module.exports = { nameFromUser, assistantName };
