# KeyMatch

**The personal CRM for luxury & exotic real estate agents** — RevMatch's foundation (battle plan,
stats, iMessage-grade inbox, pipeline, client cards, matchmaker, your own AI assistant) re-geared for real
estate: the car **Garage** becomes a property **Portfolio**, dealer **Inventory** becomes
**Listings**, test drives become **showings**, deliveries become **closings**.

Native iPhone app (Capacitor, TestFlight-ready) + mobile-first PWA that also works on desktop.

## What's inside

| Area | What it does |
|---|---|
| **Home · Battle Plan** | A time-ordered plan for the day built from your book: showings, calls to make, follow-ups and protected blocks. It has a live NOW line and an AI coach on each tile. |
| **Home · Stats** | Closings ring against your goal, volume, GCI, projected end of month, MTD and YTD pace, pipeline funnel and at-risk deals. |
| **Inbox** | An iMessage-style inbox with a "needs you first" triage card, pinned threads, buckets, swipe actions, AI reply chips, scheduled sends, quick text and a split view on desktop. |
| **Clients** | Clients, partners and vendors. The client card has a relationship ring, lifetime stats, a timeline that interleaves texts and activity, notes, appointments, and a **Portfolio** (owned, rented, sold, watching), which replaces RevMatch's Garage. |
| **Pipeline** | Buyer, listing, lease and new-development lanes with drag and one-tap advance. Closing shows a celebration screen and asks for the net. Also commissions (pay plan, cap and tiers, ICA parsing) and the Book of Business ledger. |
| **Listings · Matchmaker** | Your listings, MLS, pocket, whisper and new-development lanes. Add a listing by pasting text or a link, share a private showcase page (address can be hidden), and see every buyer at 80%+ fit. Matchmaker has Whisper, Listings, Off-Market and Price Drops views. |
| **Phone** | A "call now" list, recents, voicemail, and a live-call screen with briefing, transcript and co-pilot (in the demo), plus a post-call recap with one-tap follow-ups. |
| **Your AI assistant** | Each agent builds their own in onboarding: they name it and pick how it talks (the demo agent's is called Serena). It's a floating bubble on every screen. Its chat swipes between Chat, **To-Do** (your list plus what it caught in texts and calls) and Matchmaker. It has 31 tools, action cards with undo, and drafts that never send without your OK. The To-Do lives only here, not on the Battle Plan, same as RevMatch. |
| **Campaigns** | Text campaign builder (audience, message, event invite, reply lanes), Sender Guard pacing and automations such as home anniversaries. |
| **Calendar** | Showings, consults and closings, plus work schedule and routine, conflict checks and pre-meeting briefings. |

Every AI feature has a fallback that works without an API key. Fair Housing guardrails keep
protected-class details out of AI prompts, out of matching and out of campaigns.

## Stack

| Layer | Tech |
|---|---|
| Web | React 19 · Vite · plain CSS design tokens (Soul look, Volt highlight — see `docs/BRAND.md`) · @dnd-kit · recharts |
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
- `docs/BRAND.md` — the look and feel: colour, type, components, the KeyMatch mark, icon generator.
- `docs/DEPLOY.md` — server deploy (nginx/systemd/Docker) and the TestFlight pipeline.
- `.env.example` — every configuration option.
