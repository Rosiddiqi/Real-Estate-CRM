# KeyMatch

**The personal CRM for luxury & exotic real estate agents** — RevMatch's foundation (battle plan,
stats, iMessage-grade inbox, pipeline, client cards, matchmaker, Serena AI) re-geared for real
estate: the car **Garage** becomes a property **Portfolio**, dealer **Inventory** becomes
**Listings**, test drives become **showings**, deliveries become **closings**.

Native iPhone app (Capacitor, TestFlight-ready) + mobile-first PWA that also works on desktop.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19 · Vite · plain CSS design tokens + Liquid Glass · @dnd-kit · recharts |
| API | Node 20+ · Express 4 · Prisma 5 · PostgreSQL · `ws` WebSocket hub |
| AI | Anthropic Claude (`claude-opus-5-5`) via `@anthropic-ai/sdk` — every feature has a deterministic fallback |
| Messaging | Provider abstraction: demo simulator · Twilio SMS |
| iOS | Capacitor 8 (SPM) · bundled assets · Preferences-backed session · native keyboard/status bar/haptics |

## Quick start

```bash
# 1. Postgres (any 14+), then:
cp .env.example server/.env          # edit DATABASE_URL / secrets as needed
npm run install:all
npm run db:push                      # create tables
npm run seed                         # demo book: demo@keymatch.app / keymatch

# 2. Run (two terminals)
npm run dev:api                      # http://localhost:3200
npm run dev:web                      # http://localhost:5173  (proxies /api, /ws, /uploads)
```

Open http://localhost:5173 and tap **Explore the demo book**.

Production: `npm run build && npm start` — the API serves the built PWA from `web/dist`
(set real `JWT_SECRET` / `REFRESH_SECRET`; the server refuses placeholder secrets in production).

## iPhone app → TestFlight

```bash
echo 'KEYMATCH_API_URL=https://keymatch.yourdomain.com' >> ~/.keymatch-deploy.env   # once
./scripts/ios/deploy-testflight.sh                                                # every release (on the Mac)
```

Same Apple team, API key and signing flow as RevMatch. One-time steps (server on HTTPS,
App Store Connect app record) are in **`docs/DEPLOY.md`**.

## Docs

- `docs/FOUNDATION.md` — architecture, conventions, design system, navigation contract, ownership map.
- `docs/DEPLOY.md` — server deploy (nginx/systemd/Docker) and the TestFlight pipeline.
- `.env.example` — every configuration option.
