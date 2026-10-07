#!/usr/bin/env bash
# EMBR3 ESWMP — deploy one commit on the server, with health check and rollback.
#
# Run AS THE APP USER, never root. GitHub Actions streams this file over SSH
# (.github/workflows/deploy.yml); it can also be run by hand on the server:
#
#   DEPLOY_REF=main bash <app-root>/scripts/deploy/vps-deploy.sh
#
# It automates the manual update procedure:
#   1. refuse to run on a working tree with local edits
#   2. move the checkout to DEPLOY_REF (a SHA, branch, or tag)
#   3. reinstall server / front-end dependencies only if their lockfile changed
#   4. build the front-end and publish it to the web root
#   5. restart the API under the app user's PM2 daemon and save the process list
#   6. health-check the API; on failure restore the previous commit + build
#
# Server-specific values are NOT kept in this repository. They come from the
# environment or from a file on the server (default ~/.config/eswmp-deploy.env):
#   APP_ROOT    absolute path of the git checkout
#   WEB_ROOT    directory the web server serves the front-end build from
#   PM2_APP     PM2 process name of the API
#   HEALTH_URL  local health endpoint of the API
# See docs/CI_CD.md → "One-time server setup".
set -Eeuo pipefail

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }

DEPLOY_CONFIG="${DEPLOY_CONFIG:-$HOME/.config/eswmp-deploy.env}"
# shellcheck disable=SC1090
[ -f "$DEPLOY_CONFIG" ] && . "$DEPLOY_CONFIG"
DEPLOY_REF="${DEPLOY_REF:-main}"
for var in APP_ROOT WEB_ROOT PM2_APP HEALTH_URL; do
  [ -n "${!var:-}" ] || fail "$var is not set — add it to $DEPLOY_CONFIG (see docs/CI_CD.md)."
done

[ "$(id -u)" -ne 0 ] || fail "Run as the app user, not root — root-owned files break the API."

# nvm-managed Node, exactly as an interactive login gets it.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node >/dev/null || fail "node not found — is nvm installed for $(id -un)?"
command -v pm2 >/dev/null || fail "pm2 not found for $(id -un)."

cd "$APP_ROOT"

log "Checking the working tree"
# The lockfile churn the guide already tells operators to discard.
git checkout -- front-end/package-lock.json 2>/dev/null || true
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  fail "Local edits on the server. Commit, stash or discard them, then deploy again."
fi

PREV_SHA="$(git rev-parse HEAD)"
log "Fetching origin"
git fetch --prune --tags origin
TARGET_SHA="$(git rev-parse --verify --quiet "origin/$DEPLOY_REF^{commit}" || git rev-parse --verify "$DEPLOY_REF^{commit}")"
log "Deploying $(git log -1 --format='%h %s' "$TARGET_SHA") (was $(git rev-parse --short "$PREV_SHA"))"

lock_changed() { ! git diff --quiet "$1" "$2" -- "$3"; }

# ── rollback, armed once the checkout moves ─────────────────────────────────
ROLLBACK_READY=0
rollback() {
  [ "$ROLLBACK_READY" = 1 ] || return 0
  ROLLBACK_READY=0
  printf '\n!! Deploy failed — rolling back to %s\n' "$(git rev-parse --short "$PREV_SHA")" >&2
  git reset --hard "$PREV_SHA" || true
  if lock_changed "$PREV_SHA" "$TARGET_SHA" server/package-lock.json; then
    (cd server && npm ci --omit=dev --no-audit --no-fund) || true
  fi
  if [ -d "$WEB_ROOT.prev" ]; then
    rm -rf "$WEB_ROOT" && mv "$WEB_ROOT.prev" "$WEB_ROOT" || true
  fi
  pm2 restart "$PM2_APP" --update-env || true
  pm2 save || true
  echo "Rolled back. Inspect: pm2 logs $PM2_APP --lines 80" >&2
}
trap 'rollback' ERR

git reset --hard "$TARGET_SHA"
ROLLBACK_READY=1

log "Server dependencies"
if lock_changed "$PREV_SHA" "$TARGET_SHA" server/package-lock.json || [ ! -d server/node_modules ]; then
  (cd server && npm ci --omit=dev --no-audit --no-fund)
else
  echo "server/package-lock.json unchanged — skipping install"
fi

log "Front-end build"
if lock_changed "$PREV_SHA" "$TARGET_SHA" front-end/package-lock.json || [ ! -d front-end/node_modules ]; then
  (cd front-end && npm ci --no-audit --no-fund)
fi
(cd front-end && npm run build)

log "Publishing the build to $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "$WEB_ROOT.prev"
cp -a "$WEB_ROOT" "$WEB_ROOT.prev"
find "$WEB_ROOT" -mindepth 1 -delete
cp -a front-end/dist/. "$WEB_ROOT/"

log "Restarting $PM2_APP"
pm2 restart "$PM2_APP" --update-env
pm2 save

log "Health check $HEALTH_URL"
healthy=0
for i in $(seq 1 12); do
  code="$(curl -sS --ipv4 -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  echo "attempt $i → HTTP $code"
  if [ "$code" = "200" ]; then healthy=1; break; fi
  sleep 5
done
[ "$healthy" = 1 ] || { pm2 logs "$PM2_APP" --lines 40 --nostream || true; false; }

ROLLBACK_READY=0
trap - ERR
log "Deployed $(git rev-parse --short HEAD) successfully"
