#!/bin/bash
# KeyMatch — update the server in place. Run ON THE SERVER from the repo:
#   ./scripts/server/deploy.sh                       # main
#   DEPLOY_BRANCH=claude/keymatch-luxury-crm ./scripts/server/deploy.sh
#
# Fast-forward pull → install → schema push → build the web app → restart →
# health check. Never discards local changes and never accepts data loss:
# a destructive schema change stops the deploy for a human to review.
set -euo pipefail

REPO_DIR="${KEYMATCH_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"
SERVICE="${KEYMATCH_SERVICE:-keymatch-api}"

cd "$REPO_DIR"
PORT=$(grep -E '^PORT=' server/.env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d "\"' " || true)
PORT="${PORT:-3400}"

echo "▸ Pulling $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "  at $(git log --oneline -1)"

echo "▸ Installing server dependencies"
npm --prefix server ci --no-audit --no-fund

echo "▸ Applying database schema"
(cd server && npx prisma db push)

echo "▸ Building web app"
npm --prefix web ci --no-audit --no-fund
npm --prefix web run build

echo "▸ Restarting $SERVICE"
systemctl --user restart "$SERVICE"

for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "✔ KeyMatch is healthy on :$PORT"
    exit 0
  fi
done
echo "✘ Health check failed — journalctl --user -u $SERVICE -n 80"
exit 1
