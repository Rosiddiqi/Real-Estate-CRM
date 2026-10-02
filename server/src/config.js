// Central server configuration. Every env read lives here so the rest of the
// codebase never touches process.env directly (and so defaults are documented
// in one place). See /.env.example for the full list.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const env = process.env;
const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

const config = {
  brand: {
    name: env.BRAND_NAME || 'KeyMatch',
    assistantName: env.ASSISTANT_NAME || 'Serena',
  },
  env: env.NODE_ENV || 'development',
  isProd: (env.NODE_ENV || '') === 'production',
  port: Number(env.PORT || 3200),
  appUrl: env.APP_URL || 'http://localhost:5173',
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/estate_crm',

  auth: {
    jwtSecret: env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
    refreshSecret: env.REFRESH_SECRET || 'dev-only-refresh-secret-change-me',
    accessTtl: env.ACCESS_TOKEN_TTL || '30m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS || 60),
    // Local development convenience: when on, requests without a token are
    // treated as the seeded demo user. NEVER enable in production.
    devBypass: bool(env.DEV_AUTH_BYPASS, false),
    // One-tap demo login (seeded demo agent). Turn off once real clients and a
    // real messaging line are connected.
    demoLogin: bool(env.DEMO_LOGIN_ENABLED, true),
  },

  ai: {
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    // Strongest model for reasoning-heavy work (Serena, planning, drafting)...
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    // ...and a fast model for high-volume, latency-sensitive helpers.
    fastModel: env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001',
    dailyBudgetUsd: Number(env.AI_DAILY_BUDGET_USD || 10),
  },

  messaging: {
    // 'demo' simulates delivery + client replies; 'twilio' sends real SMS;
    // 'bridge' routes through a paired iMessage bridge (Mac) when connected.
    provider: env.MESSAGING_PROVIDER || 'demo',
    killSwitch: bool(env.KILL_SWITCH, false),
    demoAutoReplies: bool(env.DEMO_AUTO_REPLIES, true),
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: env.TWILIO_PHONE_NUMBER || '',
    agentCell: env.AGENT_CELL_NUMBER || '',
  },

  uploadsDir: env.UPLOADS_DIR || path.resolve(__dirname, '..', 'uploads'),
  webDist: env.WEB_DIST || path.resolve(__dirname, '..', '..', 'web', 'dist'),
  timezone: env.APP_TIMEZONE || 'America/New_York',
  enableCrons: bool(env.ENABLE_CRONS, true),
};

// Refuse to run a public server with forgeable tokens or the auth bypass on.
config.assertProductionSafe = function assertProductionSafe() {
  if (!config.isProd || bool(env.ALLOW_INSECURE_SECRETS, false)) return;
  const weak = (v) => !v || v.length < 24 || /change-me|dev-only/i.test(v);
  const problems = [];
  if (weak(config.auth.jwtSecret)) problems.push('JWT_SECRET is missing, short or a placeholder');
  if (weak(config.auth.refreshSecret)) problems.push('REFRESH_SECRET is missing, short or a placeholder');
  if (config.auth.devBypass) problems.push('DEV_AUTH_BYPASS is on');
  if (problems.length) {
    console.error(`[config] Refusing to start in production:\n  - ${problems.join('\n  - ')}\n` +
      'Generate secrets with: openssl rand -hex 32   (or set ALLOW_INSECURE_SECRETS=1 for a throwaway test box)');
    process.exit(1);
  }
};

module.exports = config;
