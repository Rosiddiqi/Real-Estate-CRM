// KeyMatch API server — Express + Prisma + one WebSocket hub.
//
// Routers are registered in ROUTES below and loaded with fault isolation: a
// router that throws while loading is logged and skipped (its endpoints return
// 503) instead of taking the whole API down. Background jobs are registered in
// src/jobs/index.js.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const hub = require('./realtime/hub');
const { errorHandler } = require('./lib/http');

// [mountPath, moduleFile (relative to ./routes), { public: true } for routes
// that do their own auth (auth endpoints, inbound webhooks, public pages)].
const ROUTES = [
  ['/api/auth', 'auth', { public: true }],
  ['/api/me', 'me'],
  ['/api/onboarding', 'onboarding'],
  ['/api/workspace', 'workspace'],
  ['/api/badges', 'badges'],
  ['/api/search', 'search'],
  ['/api/media', 'media'],
  ['/api/notifications', 'notifications'],
  ['/api/dashboard', 'dashboard'],
  ['/api/battle-plan', 'battlePlan'],
  ['/api/todos', 'todos'],
  ['/api/tasks', 'tasks'],
  ['/api/work-schedule', 'workSchedule'],
  ['/api/conversations', 'conversations'],
  ['/api/messages', 'messages'],
  ['/api/clients', 'clients'],
  ['/api/portfolio', 'portfolio'],
  ['/api/waitlists', 'waitlists'],
  ['/api/deals', 'deals'],
  ['/api/pipeline', 'pipeline'],
  ['/api/commissions', 'commissions'],
  ['/api/book', 'bookOfBusiness'],
  ['/api/listings', 'listings'],
  ['/api/matchmaker', 'matchmaker'],
  ['/api/appointments', 'appointments'],
  ['/api/calls', 'calls'],
  ['/api/campaigns', 'campaigns'],
  ['/api/ai', 'ai'],
  ['/api/serena', 'serena'],
  ['/api/import', 'importer'],
  ['/api/bridge', 'bridge'],
  ['/api/webhooks', 'webhooks', { public: true }],
  ['/api/public', 'publicPages', { public: true }],
];

function loadRouter(file) {
  const full = path.join(__dirname, 'routes', `${file}.js`);
  if (!fs.existsSync(full)) return { router: null, error: 'missing' };
  try {
    const mod = require(full);
    const router = mod && (mod.router || mod.default || mod);
    if (typeof router !== 'function') return { router: null, error: 'module does not export a router' };
    return { router, error: null };
  } catch (err) {
    console.error(`[routes] ✘ failed to load routes/${file}.js:\n`, err);
    return { router: null, error: err.message };
  }
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(cookieParser());

  const routeStatus = {};
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, brand: config.brand.name, time: new Date().toISOString(), ws: hub.stats(), routes: routeStatus });
  });

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', fallthrough: true }));

  const { requireAuth } = require('./middleware/auth');
  for (const [mount, file, opts = {}] of ROUTES) {
    const { router, error } = loadRouter(file);
    routeStatus[mount] = error ? `down: ${error}` : 'ok';
    if (!router) {
      if (error !== 'missing') {
        app.use(mount, (req, res) => res.status(503).json({ error: `${mount} is temporarily unavailable`, detail: error }));
      }
      continue;
    }
    if (opts.public) app.use(mount, router);
    else app.use(mount, requireAuth, router);
  }

  app.use('/api', (req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));

  // Production: serve the built PWA with SPA fallback.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api|ws|uploads).*/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

function start() {
  const app = createApp();
  const server = http.createServer(app);
  hub.attach(server);

  // Boot hooks: every file in src/init/ exports init({ app, server, hub }) —
  // WebSocket/bridge handlers, messaging providers, etc. Drop a file there to
  // add one; a hook that throws is logged and skipped.
  const initDir = path.join(__dirname, 'init');
  if (fs.existsSync(initDir)) {
    for (const f of fs.readdirSync(initDir).filter((x) => x.endsWith('.js')).sort()) {
      try {
        const m = require(path.join(initDir, f));
        if (m && typeof m.init === 'function') m.init({ app, server, hub });
      } catch (err) {
        console.error(`[boot] init/${f} failed:`, err);
      }
    }
  }

  server.listen(config.port, () => {
    console.log(`[${config.brand.name}] API listening on :${config.port} (${config.env})`);
    if (config.auth.devBypass) console.log('[auth] DEV_AUTH_BYPASS is ON — unauthenticated requests act as the demo user');
    if (config.enableCrons) {
      try { require('./jobs').start(); } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') console.error('[jobs] failed to start:', err);
      }
    }
  });

  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  return server;
}

if (require.main === module) start();

module.exports = { createApp, start };
