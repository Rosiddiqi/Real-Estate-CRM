#!/bin/bash
set -e
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# ─── KeyMatch — Build & Deploy to TestFlight ─────────────────────────────
# Usage (on the Mac):
#   ./scripts/ios/deploy-testflight.sh
#   DEPLOY_BRANCH=claude/keymatch-luxury-crm ./scripts/ios/deploy-testflight.sh
#   SKIP_PULL=true ./scripts/ios/deploy-testflight.sh     # build the working tree as-is
#
# Same pipeline as RevMatch's deploy-testflight.sh (same Apple team, same ASC
# API key, same manual-sign export), adapted for KeyMatch:
#   0. Pulls fresh code (guarded — refuses to wipe unpushed local edits)
#   1. App Store Connect preflight: registers the bundle ID if needed and
#      checks the app record exists (fails in seconds, not after the archive)
#   2. Builds the web app with the production API URL baked in
#   3. Syncs Capacitor into the iOS project
#   4. Bumps version (patch) + timestamp build number, commits the bump
#   5. Archives, exports with an App Store profile (manual signing)
#   6. Uploads to TestFlight with altool
#
# Secrets/config (never committed):
#   ~/.revmatch-deploy.env   KEYCHAIN_PASSWORD, ASC_API_KEY_PATH/ID/ISSUER_ID (shared with RevMatch)
#   ~/.keymatch-deploy.env   KEYMATCH_API_URL=https://keymatch.yourdomain.com  (+ any overrides)

REPO_DIR="${KEYMATCH_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
WEB_DIR="$REPO_DIR/web"
IOS_DIR="$WEB_DIR/ios/App"
ARCHIVE_PATH="$HOME/KeyMatch.xcarchive"
EXPORT_PATH="$HOME/KeyMatchExport"
PBXPROJ_REL="web/ios/App/App.xcodeproj/project.pbxproj"

SCHEME="App"
PROJECT="App.xcodeproj"
BUNDLE_ID="${BUNDLE_ID:-com.revmatchai.keymatch}"
TEAM_ID="${TEAM_ID:-7J4S34CXCG}"
APP_NAME="${APP_NAME:-KeyMatch}"

# ─── Load deploy secrets ──────────────────────────────────────────────────
# RevMatch's env first (keychain password + ASC key — same Apple account),
# then KeyMatch's own file, which wins on any overlap.
for f in "$HOME/.revmatch-deploy.env" "$HOME/.keymatch-deploy.env"; do
  if [ -f "$f" ]; then source "$f"; fi
done

ASC_API_KEY_PATH="${ASC_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_644M57423T.p8}"
ASC_API_KEY_ID="${ASC_API_KEY_ID:-644M57423T}"
ASC_API_ISSUER_ID="${ASC_API_ISSUER_ID:-1045c13d-94a0-42dd-b815-c9a70e0e689f}"
export ASC_API_KEY_PATH ASC_API_KEY_ID ASC_API_ISSUER_ID

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▸ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✘ $1${NC}"; exit 1; }

# Commit with the Mac's git identity; fall back to a neutral one if unset.
git_commit() {
  if git config user.email >/dev/null 2>&1; then git commit "$@"
  else git -c user.name="KeyMatch Deploy" -c user.email="deploy@localhost" commit "$@"; fi
}

# ─── Preflight ────────────────────────────────────────────────────────────
command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found. Run this on a Mac with Xcode installed."
command -v node >/dev/null 2>&1 || fail "Node.js not found (need Node 20+)."
command -v git >/dev/null 2>&1 || fail "git not found."
[ -d "$REPO_DIR/.git" ] || fail "Repo not found at $REPO_DIR. Clone it: git clone https://github.com/Rosiddiqi/Real-Estate-CRM.git ~/Real-Estate-CRM"
[ -f "$ASC_API_KEY_PATH" ] || fail "ASC API key not found at $ASC_API_KEY_PATH (set ASC_API_KEY_PATH in ~/.revmatch-deploy.env)."
[ -n "$KEYCHAIN_PASSWORD" ] || fail "KEYCHAIN_PASSWORD is not set (put it in ~/.revmatch-deploy.env)."

KEYMATCH_API_URL="${KEYMATCH_API_URL%/}"
[ -n "$KEYMATCH_API_URL" ] || fail "KEYMATCH_API_URL is not set. Add it to ~/.keymatch-deploy.env, e.g.
  echo 'KEYMATCH_API_URL=https://keymatch.yourdomain.com' >> ~/.keymatch-deploy.env
(the public HTTPS address of the KeyMatch server — see docs/DEPLOY.md)."
case "$KEYMATCH_API_URL" in
  https://*) ;;
  *) [ "${ALLOW_HTTP:-}" = "true" ] || fail "KEYMATCH_API_URL must be https:// (iOS App Transport Security). Set ALLOW_HTTP=true only for a local test build." ;;
esac

# ─── Step 0: Pull fresh code ──────────────────────────────────────────────
cd "$REPO_DIR"
if [ "${SKIP_PULL:-}" = "true" ]; then
  step "Skipping pull — building the working tree at $(git rev-parse --abbrev-ref HEAD) $(git log --oneline -1)"
else
  step "Pulling $DEPLOY_BRANCH from GitHub..."
  # Discard leftover version-bump edits from a prior failed run so the pull is clean.
  git checkout -- "$PBXPROJ_REL" 2>/dev/null || true
  # Refuse to wipe unpushed local work (a half-finished native fix, an Xcode tweak).
  DIRTY=$(git status --porcelain | grep -v "^?? \(web/ios/App/.*xcuserdata\|build/\|DerivedData/\)" || true)
  if [ -n "$DIRTY" ] && [ "${FORCE_RESET:-}" != "true" ]; then
    echo -e "${RED}✘ This Mac has local changes:${NC}"
    echo "$DIRTY"
    echo -e "${YELLOW}Refusing to reset --hard. Options:${NC}"
    echo "  1. Commit + push them, then re-run."
    echo "  2. Stash them: git stash"
    echo "  3. Build them as-is: SKIP_PULL=true $0"
    echo "  4. Discard them: FORCE_RESET=true $0"
    exit 1
  fi
  git fetch origin "$DEPLOY_BRANCH"
  git checkout -B "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
  git reset --hard "origin/$DEPLOY_BRANCH"
  echo "  Now at: $(git log --oneline -1)"
fi

# ─── Step 1: App Store Connect + server preflight ─────────────────────────
step "App Store Connect preflight ($BUNDLE_ID)..."
node "$REPO_DIR/scripts/ios/asc-profile.js" ensure-bundle "$BUNDLE_ID" "$APP_NAME" >/dev/null \
  || fail "Could not verify/register the bundle ID (needs an Admin or App Manager ASC API key)."
set +e
node "$REPO_DIR/scripts/ios/asc-profile.js" check-app "$BUNDLE_ID" >/dev/null
APP_CHECK=$?
set -e
[ $APP_CHECK -eq 0 ] || fail "Create the App Store Connect app record first (instructions above), then re-run."

step "Checking the KeyMatch server at $KEYMATCH_API_URL ..."
if curl -fsS --max-time 10 "$KEYMATCH_API_URL/api/health" >/dev/null 2>&1; then
  echo "  Server is up."
else
  warn "$KEYMATCH_API_URL/api/health did not answer. The build will still point there — testers can change the server on the sign-in screen."
fi

# ─── Step 2: Build web app & sync to iOS ──────────────────────────────────
step "Installing web dependencies..."
cd "$WEB_DIR"
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

step "Building web app (API: $KEYMATCH_API_URL)..."
VITE_API_URL="$KEYMATCH_API_URL" npm run build
grep -rqF "$KEYMATCH_API_URL" dist/assets || fail "Built bundle does not contain the API URL — refusing to ship a build that can't reach the server."

step "Syncing Capacitor iOS..."
npx cap sync ios

# ─── Step 3: Bump version ─────────────────────────────────────────────────
step "Bumping app version..."
cd "$IOS_DIR"
CURRENT_VERSION=$(grep -m1 'MARKETING_VERSION = ' "$PROJECT/project.pbxproj" | sed -E 's/.*MARKETING_VERSION = ([^;]+);.*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
MAJOR=${MAJOR:-1}; MINOR=${MINOR:-0}; PATCH=${PATCH:-0}
NEW_VERSION="${VERSION_OVERRIDE:-$MAJOR.$MINOR.$((PATCH + 1))}"
# Build number = timestamp (YYYYMMDDHHMM): every upload is unique even if the
# marketing version repeats, so App Store Connect never rejects a duplicate.
NEW_BUILD=${BUILD_OVERRIDE:-$(date +%Y%m%d%H%M)}
echo "  Version: $CURRENT_VERSION → $NEW_VERSION ($NEW_BUILD)"

sed -i '' "s/MARKETING_VERSION = $CURRENT_VERSION;/MARKETING_VERSION = $NEW_VERSION;/g" "$PROJECT/project.pbxproj"
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $NEW_BUILD;/g" "$PROJECT/project.pbxproj"
# Info.plist reads $(MARKETING_VERSION)/$(CURRENT_PROJECT_VERSION), so the
# project file is the single source of truth.

# Persist the bump BEFORE archiving: if the upload is finished by hand in
# Xcode (or export fails) the next run still continues from the new version.
( cd "$REPO_DIR" && git add "$PBXPROJ_REL" && \
  if ! git diff --cached --quiet; then \
    git_commit -m "chore(ios): bump to $NEW_VERSION ($NEW_BUILD)" >/dev/null 2>&1 && \
    if [ "${SKIP_PULL:-}" = "true" ]; then echo "  Committed version bump locally ($NEW_VERSION)."; \
    else ( git push origin "HEAD:$DEPLOY_BRANCH" >/dev/null 2>&1 && echo "  Persisted version bump to $DEPLOY_BRANCH ($NEW_VERSION)." || warn "could not push version bump — continuing (timestamp build keeps it unique)" ); fi; \
  fi ) || true
cd "$IOS_DIR"

# ─── Step 4: Unlock keychain & archive ────────────────────────────────────
step "Unlocking keychain for code signing..."
security unlock-keychain -p "$KEYCHAIN_PASSWORD" ~/Library/Keychains/login.keychain-db
security set-keychain-settings -t 3600 -l ~/Library/Keychains/login.keychain-db
# Let Apple's codesign tools use the signing key without a GUI prompt (a
# headless/SSH export otherwise hangs on the keychain dialog).
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" ~/Library/Keychains/login.keychain-db >/dev/null 2>&1 || true

step "Archiving (this takes a few minutes)..."
rm -rf "$ARCHIVE_PATH"
xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_API_KEY_PATH" \
  -authenticationKeyID "$ASC_API_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_API_ISSUER_ID" \
  -quiet \
  MARKETING_VERSION="$NEW_VERSION" \
  CURRENT_PROJECT_VERSION="$NEW_BUILD" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$TEAM_ID"

[ -d "$ARCHIVE_PATH" ] || fail "Archive failed — check Xcode signing and capabilities."

# ─── Step 5: Profile, export (manual sign) & upload ───────────────────────
# Automatic/cloud signing doesn't work for this account (the ASC key can't
# cloud-sign), so export signs MANUALLY with an App Store profile created via
# the API around the local Apple Distribution identity.
step "Creating App Store provisioning profile (manual signing)..."
DIST_HASH=$(security find-identity -v -p codesigning | awk '/Apple Distribution/{print $2; exit}')
[ -n "$DIST_HASH" ] || fail "No 'Apple Distribution' identity (cert + private key) in the login keychain. Import it, then re-run."
PROFILE_OUT="/tmp/keymatch-appstore.mobileprovision"
PROFILE_NAME=$(node "$REPO_DIR/scripts/ios/asc-profile.js" "$BUNDLE_ID" "$DIST_HASH" "$PROFILE_OUT" | sed -n 's/^PROFILE_NAME=//p')
[ -n "$PROFILE_NAME" ] || fail "Profile creation failed (need an Admin ASC API key with Cert/IDs/Profiles access)."
security cms -D -i "$PROFILE_OUT" -o /tmp/keymatch-pp.plist 2>/dev/null
PROFILE_UUID=$(/usr/libexec/PlistBuddy -c 'Print :UUID' /tmp/keymatch-pp.plist 2>/dev/null)
[ -n "$PROFILE_UUID" ] || fail "Could not read UUID from the created profile."
mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
cp "$PROFILE_OUT" "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
echo "  Installed '$PROFILE_NAME' ($PROFILE_UUID) — cert $DIST_HASH"

step "Exporting (manual sign)..."
rm -rf "$EXPORT_PATH"
MANUAL_EXPORT_PLIST="/tmp/KeyMatch-ExportOptions.plist"
cat > "$MANUAL_EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>$TEAM_ID</string>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>$DIST_HASH</string>
<key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$PROFILE_NAME</string></dict>
<key>destination</key><string>export</string>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

# /usr/bin first so Xcode's internal rsync is Apple's (Homebrew rsync lacks -E).
PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$MANUAL_EXPORT_PLIST" \
  -quiet 2>&1 | tee /tmp/keymatch-export.log || fail "xcodebuild export failed — check archive + signing."

IPA_PATH=$(ls "$EXPORT_PATH"/*.ipa 2>/dev/null | head -1)
[ -n "$IPA_PATH" ] || fail "No .ipa produced by the export step (see /tmp/keymatch-export.log)."

step "Uploading .ipa to App Store Connect..."
xcrun altool --upload-app -f "$IPA_PATH" -t ios \
  --apiKey "$ASC_API_KEY_ID" \
  --apiIssuer "$ASC_API_ISSUER_ID" 2>&1 | tee /tmp/keymatch-upload.log

if grep -q "UPLOAD SUCCEEDED\|No errors uploading" /tmp/keymatch-upload.log 2>/dev/null; then
  echo "  Upload confirmed."
else
  fail "altool upload failed — see /tmp/keymatch-upload.log."
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  KeyMatch uploaded to TestFlight!${NC}"
echo -e "${GREEN}  Version: $NEW_VERSION ($NEW_BUILD) · API: $KEYMATCH_API_URL${NC}"
echo -e "${GREEN}  It appears in App Store Connect → TestFlight in ~5–15 minutes.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
