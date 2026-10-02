# KeyMatch — Builder Foundation Guide

KeyMatch is **RevMatch re-geared for luxury & exotic real estate agents**: the same mobile-first,
iMessage-native, AI-co-piloted personal CRM (battle plan, stats, inbox, threads, pipeline,
client cards, matchmaker, Serena), where the car **Garage** becomes a property **Portfolio** and
dealer **Inventory** becomes **Listings**. Reference app (read-only): `/home/user/revmatch`
(active code in `crm/web` + `crm/server`). Specs of every RevMatch surface (exact visuals,
behaviors, algorithms, real-estate mapping) are in
`/tmp/claude-0/-home-user-Real-Estate-CRM/3d428d58-1c87-5fa8-a6f4-9316d3ab3521/scratchpad/specs/`.

> North star (inherited): help the agent build a massive book of 4–5 star clients and whales,
> close more homes, earn more. Every feature serves more relationships, more closings, more GCI.

---

## 1. Run it

```bash
# Postgres is local: postgresql://postgres:postgres@localhost:5432/estate_crm (server/.env)
cd server && npm run seed            # idempotent demo book (demo@keymatch.app / keymatch)
cd server && npm run dev             # API :3200 (node --watch)
cd web && npx vite --port 5173       # PWA :5173, proxies /api /ws /uploads → :3200
```
Shared dev servers are already running on **:3200** and **:5173** — don't kill them. For your own
isolated testing run your own pair on the ports assigned to you:
```bash
cd server && PORT=<api> ENABLE_CRONS=0 node --watch-path=src src/index.js > /tmp/<you>-api.log 2>&1 &
cd web && VITE_PROXY_TARGET=http://localhost:<api> WEB_PORT=<web> npx vite --port <web> > /tmp/<you>-web.log 2>&1 &
```
Kill only processes you started (by port), never others'.

Visual QA (headless Chromium, iPhone viewport, auto demo-login, hash deep links):
```bash
node scripts/shot.mjs --url http://localhost:<web> --hash "#/inbox" --out /tmp/<you>/inbox.png
node scripts/shot.mjs --url ... --hash "#/clients?o=client:<id>" --click "[data-tab=phone]" --theme light --out x.png
```
Then **look at the PNG with the Read tool**. The script prints console errors + failed API calls —
fix every one. Check 390×844 (primary), 375×667 (small), and 1280×860 (desktop) for your main screens.

---

## 2. Parallel-work protocol (7 builders work at once)

- **Own your files.** Only create/edit files in your ownership list (§9). Shared files you may NOT
  edit: `server/src/index.js`, `server/src/realtime/hub.js`, `server/src/lib/*`, `server/src/ai/claude.js`,
  `web/src/components/ui/*`, `web/src/components/shell/*`, `web/src/lib/*`, `web/src/api/client.js`,
  `web/src/api/ws.js`, `web/src/hooks/*` (except hooks you create with your feature prefix),
  `web/src/styles/{tokens,base,components,animations,liquid-glass,shell}.css`. If you need a shared
  primitive, build it inside your feature folder. If a shared file has a real bug, note it in your
  final report instead of editing it.
- **Stubs:** your overlay/page files already exist as stubs at the fixed paths in §5 — replace them.
- **Schema (`server/prisma/schema.prisma`) is shared.** Prefer existing fields + Json columns. If you
  truly need a change: additive only (new optional fields/models; never rename/remove), re-Read the
  file right before editing, then apply with the lock:
  `flock /tmp/km-schema.lock -c "cd /home/user/Real-Estate-CRM/server && npx prisma db push --accept-data-loss"`.
  A schema push regenerates the client; restart your own API process afterwards.
- **Data:** the demo seed is shared. Create your own test rows through the API; don't wipe tables.
  Re-run `npm run seed` only if the data is broken (it resets just the demo workspace).
- **No git commits** — the lead integrates and commits.
- New server routes must go in your own route files (already mounted — see §9). New background
  jobs: drop a file in `server/src/jobs/` (auto-loaded; see `jobs/index.js`). New boot hooks
  (WS handlers etc.): drop a file in `server/src/init/` exporting `init({ app, server, hub })`.

---

## 3. Product & UX rules (non-negotiable — inherited from RevMatch's CLAUDE.md)

- **Apple-level feel.** iOS 26-inspired, premium, dark-first, SF Pro (`var(--font)`). Never a generic
  SaaS dashboard. Every transition animated; buttons press (`scale(.97)`); sheets slide; lists have
  momentum. If two similar elements look different, that's a bug.
- **Mobile-first**: works at 375px; iPhone Safari/PWA is primary; desktop must still look intentional.
- **Fixed chrome never scrolls**; each surface owns its scroll container (`.km-scroll`).
- **Tab bar is a floating pill**; every page leaves `calc(var(--tabbar-clearance) + var(--safe-bottom))`
  (110px) of bottom space so content clears it.
- **Page titles**: use `<PageHeader>` (24px/600 centered; glass circle controls). Tab roots may use
  `large` titles.
- **Page-like surfaces** (cards, threads, detail pages, menus pages) = `<PushPanel>` (slide in from
  right, edge-swipe back). **Pop-ups** = `<Sheet>` (floats above the footer, clears the keyboard,
  scrolls internally, rounded all corners). Never hand-roll either.
- **AI is a co-pilot, not an autopilot**: it suggests/drafts; any customer-facing message needs the
  agent's approval (Preview → Edit/Approve → Send). Campaign launches approve sends at campaign level.
  Every AI feature MUST work without AI (`ai.available()` false → deterministic fallback copy/logic).
  AI never blocks the UI (async + loading/skeleton states).
- **Channel colors**: iMessage = blue (`--imsg`), SMS/Android = green (`--sms`) — everywhere a
  channel appears.
- **No manual sync UI**: realtime via WebSocket; silent refetch on reconnect/foreground (`useResync`).
- **Empty states**: centered 64px icon tile + 17px title + 14px sub (`<EmptyState>`).
- Hairlines + space over boxes. Glow, don't drop-shadow. No emoji as UI icons (use `<Icon>`).
- Fair Housing: never store or infer protected-class info (race, religion, national origin,
  familial status, disability, sex…) or demographic neighborhood preferences — only property
  attributes and explicitly named locations. Applies to every AI prompt.

---

## 4. Server conventions (`server/src`)

- CommonJS. Routers export an `express.Router()`; mounted with `requireAuth` (see `index.js` ROUTES).
  `req.userId`, `req.workspaceId`, `await req.getUser()`. **Every query filters by `workspaceId`.**
- Helpers (`lib/http.js`): `ah(async (req,res)=>…)` wraps handlers; `throw new HttpError(404,'…')`;
  `parse(zodSchema, req.body)` → 400 on invalid; `paging(req)` → `{take, skip, page, limit}`.
- Responses: lists `{ <entities>: [...], total }`; single `{ <entity> }`; errors `{ error }`.
- Realtime: `const hub = require('../realtime/hub'); hub.broadcast(workspaceId, 'deal_updated', deal)`.
  Event envelope `{event, payload, timestamp}`. Event names: `message_received`, `message_updated`,
  `message_sent`, `conversation_updated`, `conversation_read`, `typing`, `reaction`, `deal_created`,
  `deal_updated`, `deal_deleted`, `activity_created`, `notification`, `plan_updated`, `task_updated`,
  `appointment_updated`, `call_updated`, `call_transcript`, `match_new`, `listing_updated`,
  `campaign_updated`, `client_updated`, `serena_event`.
- Timeline: `logActivity({workspaceId, clientId, type, title, body, meta, actor})` (`lib/activity.js`).
- Notifications: `notify({workspaceId, type, title, body, data})` (`lib/notify.js`).
- Phones: `normalizePhone`, `toE164`, `formatPhone`, `tzForPhone` (`lib/phone.js`). Stored phones are
  bare 10 digits. Client lookup: `findClientByHandle`, `clientName` (`lib/clients.js`).
- Time: **never** use server-local/UTC "today". Use `lib/dates.js` (`dayKey(date, tz)`,
  `dayBounds(dayStr, tz)`, `zonedTime(dayStr,h,m,tz)`, `monthBounds`, `yearBounds`, `minuteOfDay`)
  with `workspace.timezone` (default America/New_York).
- AI: `const ai = require('../ai/claude')` → `ai.available()`, `ai.json({system, prompt, schema, effort:'low', feature, workspaceId})`,
  `ai.text(...)`, `ai.streamText({..., onText})`, `ai.agent({system, messages, tools, onText})`.
  Model is `claude-opus-5-5` with explicit effort (`low` quick helpers, `medium` drafts, `high` Serena/
  planning). Always wrap in try/catch and fall back deterministically. Keep stable system prompts
  first (they're cached). Include the Fair Housing guardrail in prompts that extract preferences.
- Money: whole dollars (Int). Rates: fractions (0.025). Prices like `$4.25M` are formatted client-side.
- Uploads: `POST /api/media/upload` (multipart) → `{files:[{url,…}]}` served at `/uploads/…`.
- Cross-cutting endpoints already built: `/api/auth/*`, `/api/me`, `/api/workspace`, `/api/badges`
  (+ `POST /api/badges/seen {kind:'calls'}`), `/api/search?q=`, `/api/notifications`, `/api/media/upload`.

## 5. Web conventions (`web/src`)

- React 19 + Vite, plain CSS with tokens (no Tailwind). Inline styles referencing CSS vars are fine
  (`style={{ color: 'var(--dim)' }}`); put larger feature CSS in `src/styles/<feature>.css` and import
  it from your feature's entry component.
- **Tokens** (`styles/tokens.css`): `--bg #06080C`, `--surface #0E131C`, `--surfaceHi #131A26`, `--line`,
  `--lineHi`, `--text`, `--dim`, `--faint`, `--blue`, `--bright`, `--deep`, `--glow`, `--tint`, `--green`,
  `--amber`, `--red`, `--violet`, `--imsg`, `--sms`, KIND colors `--kind-call/text/email/match/prep/
  personal/content/showing/openhouse/closing/listing`, radii `--r-card 16 / --r-sheet 24 / --r-md 12`,
  motion `--km-ease`, `--km-nav-ease`, `--km-spring`. Light theme via `data-theme="light"` — use vars,
  never hard-code dark colors. Accent palettes swap `--blue/--bright/--deep/--glow/--tint`.
- **Liquid glass** (`styles/liquid-glass.css`): `km-lg` (+`--solid`, `--menu`, `--line`, `--flat`,
  `km-lg-seg`, `--clear km-lg--dim` over photos), `km-mat` for content-layer frost, `km-scroll-edge`
  for top bars. Glass = functional layer only (floating controls/nav), never content cards.
- **Kit** (`components/ui`):
  - `Icon` (`<Icon name="house" size={20} />` — names in `Icon.jsx`; add none, use what exists),
  - `Avatar` (`name`, `seed`=client.id, `src`, `size`, `channel`, `badge`),
  - `PushPanel` (`onClose`, `title`, `subtitle`, `right`, `header`, `scroll`, `zIndex`) + `usePanel()`,
  - `Sheet` (`open`, `onClose`, `title`, `left`, `right:{label,onClick,disabled}`, `footer`, children may be fn `({close})`),
  - `PageHeader` (`title`, `subtitle`, `onBack`, `left`, `right`, `large`, children row),
  - `GlassButton` (`icon`, `onClick`, `label`, `accent`, `badge`, `size`),
  - `PillTabs` (segmented control: `items=[{id,label,count}]`, `value`, `onChange`),
  - `PropertyPhoto` (`src`, `seed`, `label`, `height|ratio`, `radius`) — always use for property images,
  - `kit.jsx`: `Button`, `Spinner`, `Chip` (tones blue/danger/ai/success/caution/neutral), `DotLabel`,
    `EmptyState`, `Skeleton`, `SkeletonRows`, `ScoreDial`, `scoreColor`, `Stars`, `Field`, `TextInput`,
    `TextArea`, `Select`, `Switch`, `ChipSelect`, `Section`, `Row`, `Group`, `Stat`,
  - `toast.jsx`: `toast('…')`, `toast.success/error`, `toast(msg,{action:{label,onClick}})`,
    `await confirm({title, message, confirmLabel, destructive})`.
- CSS classes: `km-screen` + `km-screen-body` (tab roots), `km-scroll`, `km-scroll-x`, `km-card`,
  `km-ai-card`, `km-row`, `km-list`, `km-pill(--on)`, `km-badge`, `km-input`, `km-eyebrow`, `km-num`,
  `km-truncate`, `km-clamp-2`, `km-press`, `km-row-in` (stagger ≤12 rows), `km-skel`, `km-fab`,
  `km-fluted` (architectural hero material — replaces RevMatch's carbon fiber).
- **Navigation** (`lib/nav.js`): never route any other way.
  `nav.go(tab)`; `nav.openClient(id)`, `nav.newClient(prefill)`, `nav.openWaitlists()`, `nav.openImport()`,
  `nav.openThread({conversationId|clientId|handle, draft})`, `nav.compose({to, clientId, body, listingId})`,
  `nav.quickText({clientId, body, context})`, `nav.openPipeline(focusDealId)`, `nav.openDeal(id)`,
  `nav.newDeal(prefill)`, `nav.openCommissions()`, `nav.openBook()`, `nav.openPayPlan()`,
  `nav.openListings(filter)`, `nav.openListing(id)`, `nav.newListing(prefill)`, `nav.openCalendar(date)`,
  `nav.openAppointment(id)`, `nav.newAppointment(prefill)`, `nav.openWorkSchedule()`,
  `nav.openCampaigns()`, `nav.openCampaign(id)`, `nav.newCampaign(prefill)`,
  `nav.openSerena(page, prompt)`, `nav.call({clientId, phone, name})`, `nav.openNotifications()`,
  `nav.openSearch()`, `nav.openSettings(section)`, `nav.openMenu()`.
  **Overlay contract:** each overlay component receives `{...props, overlayId, onClose}`; call
  `onClose` after the exit animation (`PushPanel`/`Sheet` do this — pass `onClose` straight through).
  **Layering is automatic:** AppShell gives each overlay a depth; `PushPanel` z = 200+20·depth and
  `Sheet` z = 210+20·depth (any `zIndex` prop you pass is treated as a minimum). Don't hard-code
  huge z-indexes. Before navigating away from a transient surface (a sheet, Serena's popup), close it.
  Tabs: `home | inbox | phone | clients | matchmaker`. Deep link: `#/<tab>?o=<type>:<id>,…`.
- **Data**: `import { api } from '../../api/client'` → `api.get(path, params)`, `post`, `patch`, `put`,
  `del`, `upload`; `mediaUrl(u)`. Put endpoint wrappers in `src/api/<feature>.js`. Realtime:
  `useSocket('event', handler)`, `useResync(refetch)` from `hooks/useSocket`. Optimistic UI with
  rollback + `toast.error` on failure. Cross-cutting: `api/system.js` (`uploadFiles`, `globalSearch`,
  `bumpBadges()`…).
- **Formatting** (`lib/format.js`): `fullName`, `firstName`, `getInitials`, `formatPhone`,
  `formatPhoneInput`, `money`, `moneyCompact` ($4.25M), `moneyRange`, `pct`, `num`, `sqft`,
  `pricePerSqft`, `specLine` (5 bd · 6.5 ba · 7,850 sq ft), `lotSize`, `listTime` (iMessage list
  times), `relativeTime`, `daysSince`, `formatDaySep`, `formatTime`, `formatDate`, `formatDateTime`,
  `separatorType`, `shouldGroup`, `greeting`, `plural`, `dateKey`.
- Mobile gestures: use pointer events; `touch-action` on draggable handles; respect
  `prefers-reduced-motion`. iOS inputs must be ≥16px font.

## 6. Real-estate glossary (RevMatch → KeyMatch)

| RevMatch | KeyMatch |
|---|---|
| Customer | Client (buyer, seller, investor, renter, landlord, developer, sphere) |
| Affiliates / Resources tabs | Partners (co-op agents, referral partners) / Vendors (lender, attorney, inspector, stager, photographer, title) |
| Garage: Current / History / Dream | **Portfolio**: Owned / Wishlist (BuyerSearch) / Sold — plus Rents & Watching |
| Vehicle / Inventory / dealer stock | Listing (own, MLS feed, pocket/coming soon, whisper, new development) |
| VIN / stock # / window sticker / configurator link | Parcel/APN / MLS # / listing sheet / listing URL (Zillow/MLS/brokerage) |
| Hunting / Dream intent | BuyerSearch bucket active / dream / inferred |
| Test drive | Private showing / tour |
| Delivery | Closing (keys) |
| Units sold, half deal | Sides closed; co-agent split share |
| Front/back gross, pay plan tiers | GCI = price × side rate × split share; brokerage split, cap, fees |
| Lease maturity / payoff | ARM reset, loan maturity, renter lease expiry, home-purchase anniversary, equity milestone |
| Grapevine / C2C / Price drop | Whisper (off-market intel) / Off-market pairing (client-owned home ↔ another client's search) / Price reductions |
| Allocation requests (specialty lists) | Waitlists (buildings, communities, releases) |
| Allocations lane (build-to-order) | New Development lane (pre-construction) |
| Content shoot block | Listing media / social content block |
| Dealership / sales floor | Brokerage / office; floor & open-house duty |
| SOLD! celebration | CLOSED! (buyer) / SOLD! (listing) with keys in the money rain |
| Whale (LTV ≥ $100K) | Whale (isWhale, or lifetime volume ≥ $10M / single side ≥ $5M) |

Pipeline canonical stage keys (server is the source of truth: `services/pipeline/stages.js`):
buyer `new_lead → consultation → touring → offer_submitted → under_contract → closed`;
listing `seller_lead → listing_appt → active → offer_received → under_contract → closed`;
`lost` terminal; new-dev lane `unit_selection → pricing_received → priority_list → reserved → building_delivered`.
Board phases: Engaged · Consult · Active · Offer · Under Contract (quiet) · Closed (money).

## 7. Cross-team contracts (build these FIRST, then iterate)

| Provider | Contract | Consumers |
|---|---|---|
| clients | `GET /api/clients?search=&kind=client\|partner\|vendor&limit=` → `{clients,total}`; `GET /api/clients/:id` → `{client}` (+ properties, searches, deals summary); `PATCH /api/clients/:id`; `POST /api/clients`. `components/client/ClientPicker.jsx` (`<ClientPicker open onClose onPick={(client)=>…} />` sheet) | everyone |
| inbox | `server/src/services/messaging/send.js` → `sendMessage({workspaceId, clientId?, conversationId?, handle?, body, attachments?, service?, source:'agent'\|'campaign'\|'serena', campaignId?, aiGenerated?})` → `{message, conversation}`; `components/thread/ThreadView.jsx` (`<ThreadView clientId \| conversationId embedded />` thread + composer for the client card Timeline); `GET /api/conversations/by-client/:clientId` | client card, campaigns, matchmaker, Serena, calls |
| dashboard | `GET/POST/PATCH/DELETE /api/appointments` (`?clientId=&from=&to=`), `GET /api/appointments/upcoming?limit=&withinHours=`; `GET/POST/PATCH /api/tasks` (`?clientId=&open=1`); `components/battleplan/TodoPanel.jsx`; `components/calendar/AddAppointmentSheet.jsx` (prefill `{clientId, listingId, dealId, type, startAt}`); `server/src/services/calendar.js` + `services/tasks.js` exports (`createAppointment`, `createTask`, …) | client card, Serena, calls recap, matchmaker |
| pipeline | `GET /api/deals?clientId=&stage=&open=1`, `POST/PATCH /api/deals/:id`, `GET /api/commissions/summary` (`{mtd:{sides,gci,net,volume}, ytd, lastMonth, projected:{weighted,unweighted}, goals, cap}`); `components/pipeline/NewDealSheet.jsx` (prefill `{clientId, side, listingId, portfolioPropertyId, price}`); `server/src/services/pipeline/*.js` exports (`createDeal`, `moveDeal`) | dashboard stats, client card, Serena |
| listings | `GET /api/listings`, `GET /api/listings/:id`; `GET /api/matchmaker/client/:clientId` (best matches per search); `server/src/services/matchmaker/score.js` (`scoreListingForSearch`) + `getRecentMatches({workspaceId, sinceDays, minScore})`; `components/matchmaker/MatchDigest.jsx` (compact hottest-matches list for Serena's 3rd page) | client card, battle plan, Serena |
| campaigns | `components/campaigns/AutomationsTab.jsx` (content of the Inbox "Automations" tab) | inbox |
| serena | `components/serena/SerenaBubble.jsx` (floating 44px glass bubble, `data-serena-bubble`), `components/serena/SerenaSheet.jsx` (3 pages: Chat · To-Do (`TodoPanel`) · Matchmaker (`MatchDigest`)) | shell |

If a contract you consume doesn't exist yet, code against it, guard failures gracefully (empty state,
no crash), and re-check before you finish.

## 8. Testing data (demo book)

Demo login `demo@keymatch.app` / `keymatch` (or the "Explore the demo book" button). Seeded:
~70 clients (whales, partners, vendors), ~45 portfolio properties, ~28 buyer searches, ~48 listings
(own, MLS, pocket, whisper, new-dev), ~30 deals, ~45 appointments (5–7 today), ~38 conversations
(unread inbound this morning, group chat, SMS clients), ~32 calls, campaigns, waitlists, notes,
tasks. Dates are relative to seed time — re-seed if the day rolled over.

## 9. Ownership map

| Builder | Web (owns) | Server (owns) |
|---|---|---|
| **dashboard** | `pages/dashboard/**`, `components/dashboard/**`, `components/calendar/**`, `components/battleplan/**`, `api/dashboard.js`, `api/battlePlan.js`, `api/appointments.js`, `api/tasks.js`, `styles/dashboard.css` | `routes/dashboard.js`, `routes/battlePlan.js`, `routes/todos.js`, `routes/tasks.js`, `routes/workSchedule.js`, `routes/appointments.js`, `services/battlePlan/**`, `services/calendar.js`, `services/tasks.js`, `jobs/battlePlan*.js`, `jobs/appointment*.js` |
| **inbox** | `pages/inbox/**`, `components/inbox/**`, `components/thread/**`, `api/conversations.js`, `api/messages.js`, `styles/inbox.css`, `styles/thread.css` | `routes/conversations.js`, `routes/messages.js`, `routes/bridge.js`, `routes/webhooks.js`, `services/messaging/**`, `init/messaging.js`, `jobs/scheduledSends.js`, `jobs/messaging*.js` |
| **pipeline** | `pages/pipeline/**`, `components/pipeline/**`, `api/deals.js`, `api/commissions.js`, `styles/pipeline.css` | `routes/deals.js`, `routes/pipeline.js`, `routes/commissions.js`, `routes/bookOfBusiness.js`, `services/pipeline/**`, `jobs/pipeline*.js` |
| **clients** | `pages/clients/**`, `components/client/**`, `components/portfolio/**`, `api/clients.js`, `api/portfolio.js`, `styles/clients.css` | `routes/clients.js`, `routes/portfolio.js`, `routes/waitlists.js`, `routes/importer.js`, `services/clients/**`, `jobs/client*.js` |
| **listings** | `pages/listings/**`, `pages/matchmaker/**`, `components/listings/**`, `components/matchmaker/**`, `api/listings.js`, `api/matchmaker.js`, `styles/listings.css`, `styles/matchmaker.css` | `routes/listings.js`, `routes/matchmaker.js`, `routes/publicPages.js`, `services/listings/**`, `services/matchmaker/**`, `jobs/match*.js`, `jobs/listing*.js` |
| **serena** | `components/serena/**`, `components/calls/**`, `pages/phone/**`, `components/system/**`, `api/serena.js`, `api/calls.js`, `styles/serena.css`, `styles/calls.css` | `routes/serena.js`, `routes/ai.js`, `routes/calls.js`, `services/serena/**`, `services/calls/**`, `init/calls.js`, `jobs/serena*.js`, `jobs/call*.js` |
| **campaigns** | `pages/campaigns/**`, `components/campaigns/**`, `api/campaigns.js`, `styles/campaigns.css` | `routes/campaigns.js`, `services/campaigns/**`, `jobs/campaign*.js` |
| lead | shell, ui kit, settings, auth | index.js, lib, hub, ai/claude.js, auth/me/workspace/badges/search/notifications/media |

Mounted API prefixes: `/api/dashboard`, `/api/battle-plan`, `/api/todos`, `/api/tasks`,
`/api/work-schedule`, `/api/appointments` · `/api/conversations`, `/api/messages`, `/api/bridge`,
`/api/webhooks` (public, no auth) · `/api/deals`, `/api/pipeline`, `/api/commissions`, `/api/book` ·
`/api/clients`, `/api/portfolio`, `/api/waitlists`, `/api/import` · `/api/listings`, `/api/matchmaker`,
`/api/public` (public, no auth) · `/api/serena`, `/api/ai`, `/api/calls` · `/api/campaigns`.
