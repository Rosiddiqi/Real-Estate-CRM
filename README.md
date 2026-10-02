# KeyMatch

**The personal CRM for luxury & exotic real estate agents** — RevMatch's foundation (battle plan,
stats, iMessage-grade inbox, pipeline, client cards, matchmaker, Serena AI) re-geared for real
estate: the car **Garage** becomes a property **Portfolio**, dealer **Inventory** becomes
**Listings**, test drives become **showings**, deliveries become **closings**.

Mobile-first PWA (iPhone Safari / Add to Home Screen) that also works on desktop.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19 · Vite · plain CSS design tokens + Liquid Glass · @dnd-kit · recharts |
| API | Node 20+ · Express 4 · Prisma 5 · PostgreSQL · `ws` WebSocket hub |
| AI | Anthropic Claude (`claude-opus-5-5`) via `@anthropic-ai/sdk` — every feature has a deterministic fallback |
| Messaging | Provider abstraction: demo simulator · Twilio SMS · RevMatch-Bridge-compatible iMessage bridge (Mac) |

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

Production: `npm run build && npm start` — the API serves the built PWA from `web/dist`.

## Docs

- `docs/FOUNDATION.md` — architecture, conventions, design system, navigation contract, ownership map.
- `.env.example` — every configuration option.
