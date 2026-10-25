#!/usr/bin/env bash
#
# Pulls the latest dashboard from GitHub and puts it on screen. This is the
# routine path — run it as often as you like:
#
#     sudo bash /opt/wall-dashboard/deploy/update.sh
#
# It touches *only* the application. It never installs a package, never
# reconfigures X, and never goes near the desktop environment. provision.sh is
# the one-time job; this is the repeatable one.
#
#   --force   rebuild and restart even when git reports nothing new
set -euo pipefail

INSTALL_DIR=/opt/wall-dashboard
# Must match whatever provision.sh used; override the same way.
SERVICE_USER="${DASHBOARD_USER:-kiosk}"
FORCE=${1:-}

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo bash deploy/update.sh)"
[ -d "$INSTALL_DIR/.git" ] || die "$INSTALL_DIR is not a git clone — nothing to pull"

# git and npm run as the owning user so nothing in the tree ends up root-owned,
# which would break the next update and the service's own writes to data/.
as_user() { runuser -u "$SERVICE_USER" -- "$@"; }
in_dir() { as_user bash -lc "cd '$INSTALL_DIR' && $1"; }

cd "$INSTALL_DIR"

say "Fetching"
before_rev=$(as_user git -C "$INSTALL_DIR" rev-parse HEAD)
before_lock=$(sha256sum package-lock.json | cut -d' ' -f1)

# --ff-only on purpose. The Wyse is a deployment target, not somewhere to
# resolve a merge: if the histories have diverged, that is worth stopping for
# rather than committing a merge nobody will ever see.
as_user git -C "$INSTALL_DIR" pull --ff-only

after_rev=$(as_user git -C "$INSTALL_DIR" rev-parse HEAD)
after_lock=$(sha256sum package-lock.json | cut -d' ' -f1)

if [ "$before_rev" = "$after_rev" ] && [ "$FORCE" != "--force" ]; then
    echo "Already up to date at ${after_rev:0:8} — nothing to do. (--force to rebuild anyway.)"
    exit 0
fi

# npm ci wipes node_modules and reinstalls from scratch, which is minutes on a
# J5005. Most dashboard commits do not touch the lockfile, so only pay for it
# when the dependencies actually moved.
if [ "$before_lock" != "$after_lock" ] || [ "$FORCE" = "--force" ]; then
    say "Dependencies changed — reinstalling"
    in_dir "npm ci"
else
    say "Lockfile unchanged — skipping npm ci"
fi

say "Building"
in_dir "npm run build"

say "Restarting the server"
systemctl restart wall-dashboard.service

# Wait for it rather than assuming: a build that compiles can still fail to
# boot, and finding that out now beats finding it out from a blank wall.
for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://localhost:3000/api/health; then
        break
    fi
    sleep 1
done
curl -sf -o /dev/null http://localhost:3000/api/health \
    || die "server did not come back — check: journalctl -u wall-dashboard -n 50"

say "Reloading the display"
# The browser is holding the previous client bundle, so it has to be bounced.
# Killing it is the whole mechanism: kiosk.sh runs chromium in a loop that
# relaunches on any non-zero exit, so this comes straight back with the new
# bundle. No xdotool, no DISPLAY juggling, no second code path to maintain.
if pkill -f -- "--class=WallDashboard"; then
    echo "dashboard browser bounced; kiosk.sh will relaunch it"
else
    echo "no dashboard browser was running — leaving the session alone"
fi

echo
echo "Updated ${before_rev:0:8} -> ${after_rev:0:8}"
