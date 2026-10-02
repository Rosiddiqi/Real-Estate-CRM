# Deploying KeyMatch — server + TestFlight

KeyMatch ships as two pieces:

1. **The server** (`server/`): API, WebSocket, background jobs. It also serves the web app.
   It has to be reachable over **HTTPS** from the internet, because the iPhone app talks to it.
2. **The iOS app** (`web/ios`, Capacitor 8). It bundles the web UI, so it doesn't load
   pages from the server, and calls the server's API at the URL baked in at build time.

The pipeline matches RevMatch's: the same Apple team (`7J4S34CXCG`), the same App Store
Connect API key and the same manual-signing export. Everything RevMatch's
`deploy-testflight.sh` needs on the Mac also works for KeyMatch.

---

## 1. Server (one time, on the VPS)

These steps assume the RevMatch VPS (Ubuntu, nginx + Certbot, Node 20+). KeyMatch runs on
port **3400** next to RevMatch's 3200.

```bash
# DNS: point an A record (e.g. keymatch.yourdomain.com) at the VPS first.

# Postgres database
sudo -u postgres createdb estate_crm            # or reuse any Postgres 14+

# Code
git clone https://github.com/Rosiddiqi/Real-Estate-CRM.git ~/Real-Estate-CRM
cd ~/Real-Estate-CRM
git checkout main        # or claude/keymatch-luxury-crm until it's merged

# Config
cp .env.example server/.env
# Edit server/.env:
#   NODE_ENV=production
#   PORT=3400
#   APP_URL=https://keymatch.yourdomain.com
#   DATABASE_URL=postgresql://USER:PASS@localhost:5432/estate_crm
#   JWT_SECRET=$(openssl rand -hex 32)       # paste real values, no $( )
#   REFRESH_SECRET=$(openssl rand -hex 32)
#   ANTHROPIC_API_KEY=sk-ant-...             # turns on Serena + AI drafting
#   DEMO_LOGIN_ENABLED=1                     # keep for testers; 0 when it goes live
#   DEMO_DAILY_RESET=1                       # re-seed the demo nightly so its dates stay current
#   APP_TIMEZONE=America/New_York

# Install, create tables, build the web app
npm run install:all
npm run db:push
npm run build
npm run seed            # optional: demo book (demo@keymatch.app / keymatch).
                        # Only touches the demo workspace; with DEMO_DAILY_RESET=1 it's redone nightly.

# Run it as a service
mkdir -p ~/.config/systemd/user
cp infra/systemd/keymatch-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now keymatch-api
sudo loginctl enable-linger "$USER"

# nginx + HTTPS
sudo cp infra/nginx/keymatch.conf /etc/nginx/sites-available/keymatch
sudo sed -i 's/keymatch.example.com/keymatch.yourdomain.com/' /etc/nginx/sites-available/keymatch
sudo ln -s /etc/nginx/sites-available/keymatch /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d keymatch.yourdomain.com

curl https://keymatch.yourdomain.com/api/health      # → {"ok":true,...}
```

In production the server won't start if `JWT_SECRET` or `REFRESH_SECRET` is missing, shorter
than 24 characters, or still a placeholder, or if `DEV_AUTH_BYPASS` is on. This keeps
a public box from accepting forged tokens.

**Updates later:** `./scripts/server/deploy.sh` on the VPS. It fast-forward pulls, installs,
pushes the schema, builds and restarts, then runs a health check. Add
`DEPLOY_BRANCH=claude/keymatch-luxury-crm` to deploy that branch. If a schema change would
lose data, the script stops so you can review it before anything is dropped.

**Docker instead?** `docker compose up -d --build` runs Postgres and the app on port 3200.
Put `JWT_SECRET`, `REFRESH_SECRET` and `ANTHROPIC_API_KEY` in a root `.env` first;
compose refuses to start without the secrets. Point nginx at that port.

---

## 2. Apple setup (one time)

1. **Bundle ID** `com.revmatchai.keymatch`. The deploy script registers it on the first run
   through the App Store Connect API, so nothing to do here.
2. **App record.** Apple's API can't create this, so it's a one-time click-through:
   App Store Connect → **Apps** → **+** → **New App**
   - Platform **iOS**, Name **KeyMatch** (names are unique store-wide; if it's taken, use
     e.g. "KeyMatch CRM". The home-screen name stays "KeyMatch")
   - Primary language English (U.S.), Bundle ID **com.revmatchai.keymatch**, SKU `keymatch-ios`
   - The script checks this record exists *before* the long archive and prints these
     steps if it doesn't.
3. **Mac secrets.** These are already there from RevMatch:
   `~/.revmatch-deploy.env` (KEYCHAIN_PASSWORD, ASC_API_KEY_PATH/ID/ISSUER_ID), plus the
   Apple Distribution certificate and its private key in the login keychain.
4. **KeyMatch's server URL.** This is the only new setting:
   ```bash
   echo 'KEYMATCH_API_URL=https://keymatch.yourdomain.com' >> ~/.keymatch-deploy.env
   chmod 600 ~/.keymatch-deploy.env
   ```

## 3. Ship a TestFlight build (every release)

On the Mac (Xcode 16+, Node 20+):

```bash
git clone https://github.com/Rosiddiqi/Real-Estate-CRM.git ~/Real-Estate-CRM   # first time
cd ~/Real-Estate-CRM
./scripts/ios/deploy-testflight.sh
# until the branch is merged:
DEPLOY_BRANCH=claude/keymatch-luxury-crm ./scripts/ios/deploy-testflight.sh
```

The script runs these steps:

1. Pulls the branch. It refuses to wipe local edits; use `SKIP_PULL=true` to build the
   working tree as-is, or `FORCE_RESET=true` to discard local edits.
2. App Store Connect preflight: registers the bundle ID if needed, checks the app record,
   and pings `KEYMATCH_API_URL/api/health`.
3. `VITE_API_URL=$KEYMATCH_API_URL npm run build`, verifies the URL made it into the
   bundle, then `npx cap sync ios`.
4. Bumps the version: the patch number goes up, and the build number is a timestamp
   (`YYYYMMDDHHMM`), so uploads never collide. The bump is committed and pushed before
   archiving.
5. Archives, creates an App Store profile through the API, exports with manual signing,
   and uploads with `altool`.

The build appears under App Store Connect → **TestFlight** in about 5–15 minutes.
The first build needs the following:

- **Export compliance** is pre-answered (`ITSAppUsesNonExemptEncryption = NO`).
- **Internal testers** (your team) can install right away. Add them under TestFlight →
  Internal Testing.
- **External testers** need Beta App Review. Use these review notes:
  > Sign in with the demo account: demo@keymatch.app / keymatch (or tap "Explore the demo book").
  > KeyMatch is a CRM for real estate agents; all demo data is fictional.

  Keep `DEMO_LOGIN_ENABLED=1` on the server while a review is pending.

### Other useful commands

```bash
cd web
npm run build:ios      # vite build + cap sync ios (uses VITE_API_URL if set)
npm run ios:open       # open the Xcode project (run on a device/simulator from Xcode)
```

For a quick device test without TestFlight: `VITE_API_URL=https://… npm run build:ios`,
then `npm run ios:open` and Run.

## 4. What's in the iOS shell

- `web/capacitor.config.ts`: app id `com.revmatchai.keymatch`, bundled assets (no
  `server.url`), dark status bar overlaying the web view, and keyboard `resize: none`
  (sheets and composers ride `--keyboard-height`). The web view never rubber-bands, and the
  splash screen is hidden once the app has rendered.
- `web/src/lib/native.js`: mirrors the session, server URL, theme and tab into Capacitor
  Preferences, so iOS purging web-view storage doesn't sign users out. It also drives
  native keyboard insets, resyncs the socket and badges when the app comes back to the
  foreground, and provides haptics.
- Sign-in screen (native only): shows which server the app points at, warns when it
  can't reach it, and lets a tester switch servers at runtime.
- Settings → Account → **Delete account** permanently erases the account and its workspace
  data. App Store review requires this for apps that offer sign-up. The shared demo account
  is protected and can't be deleted.
- The status bar and keyboard follow the in-app light or dark theme.
- `web/ios/App/App/Info.plist`: portrait iPhone app with a dark UI, usage strings for
  camera, photos, mic and speech, and `tel:`/`sms:`/`facetime:`/`maps:` link schemes.
- `PrivacyInfo.xcprivacy`: required-reason API declarations (UserDefaults, file
  timestamps), plus the data types collected for app functionality, with no tracking.
- Icon is `Assets.xcassets/AppIcon.appiconset` (1024², no alpha); splash is
  `Splash.imageset`. Replace them there to rebrand.

## 5. Renaming the app

"KeyMatch" is a working name. To rename:

- `web/src/brand.js` and `BRAND_NAME` in `server/.env` change the in-app name.
- `appName` in `web/capacitor.config.ts` and `CFBundleDisplayName` in
  `web/ios/App/App/Info.plist` change the home-screen name.
- The App Store name lives on the App Store Connect app record.
- Keep the bundle ID. Changing it means a new App Store Connect app.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no App Store Connect app record` | Do step 2.2, then re-run. |
| `No 'Apple Distribution' identity` | Import the distribution cert and its key (.p12) into the login keychain on this Mac. |
| `profile POST 403` | The ASC API key needs the Admin role (or App Manager with access to certificates, IDs and profiles). |
| App shows "Can't reach …" on sign-in | The server is down or the URL is wrong. Check `curl $KEYMATCH_API_URL/api/health`, or tap the server line to change it. |
| Signed out after iOS updates | This shouldn't happen, because tokens are mirrored to Preferences. If it does, check the server's `REFRESH_TOKEN_TTL_DAYS`. |
| `ITMS-91053 Missing API declaration` email | Add the reported API category to `web/ios/App/App/PrivacyInfo.xcprivacy`. |
