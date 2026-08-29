#!/usr/bin/env bash
#
# Provisions a fresh Debian 13 (trixie) install on the Wyse 5070 into the wall
# display. Run as root, once, from a clone of this repo:
#
#     sudo bash deploy/provision.sh
#
# Idempotent enough to re-run after a failure. It does not touch .env — that is
# yours to write, and the script stops and tells you if it is missing.
set -euo pipefail

INSTALL_DIR=/opt/wall-dashboard
SERVICE_USER=wall
NODE_MAJOR=22

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo bash deploy/provision.sh)"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$REPO_DIR/package.json" ] || die "run this from inside the repo"

say "Installing packages"
apt-get update
# xserver-xorg + xinit + x11-xserver-utils: the minimum to get a screen and
#   xset. No desktop environment — nothing here needs one.
# openbox: so Chromium's --kiosk goes genuinely fullscreen.
# fonts-noto-core + fonts-noto-cjk: minimal Debian images have no Cyrillic
#   coverage, and the Russian headlines render as tofu boxes without it.
# unclutter: hides the pointer.
apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg \
    xserver-xorg xinit x11-xserver-utils openbox unclutter \
    chromium \
    fonts-noto-core fonts-noto-cjk \
    cron

say "Installing Node ${NODE_MAJOR} from NodeSource"
# Debian 13 ships Node 20.19; this repo's engines field requires >= 22.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    chmod a+r /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
    apt-get update
    apt-get install -y nodejs
fi
node --version

say "Creating the ${SERVICE_USER} user"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi
# video/input/tty are what let a non-root user own the VT and talk to the GPU.
usermod -aG video,input,tty "$SERVICE_USER"

say "Allowing a non-root X server"
# Debian ships console-only by default here, which makes startx refuse for a
# user that is not on a physical console — which is exactly our case, since
# systemd owns tty1.
cat > /etc/X11/Xwrapper.config <<'EOF'
allowed_users=anybody
needs_root_rights=yes
EOF

say "Installing the app to ${INSTALL_DIR}"
if [ "$REPO_DIR" != "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    # -a keeps timestamps so npm and tsc can still make sensible decisions.
    cp -a "$REPO_DIR/." "$INSTALL_DIR/"
fi
cd "$INSTALL_DIR"

[ -f "$INSTALL_DIR/.env" ] || die \
    "no .env at $INSTALL_DIR — copy .env.example to .env and fill in the credentials, then re-run"

say "Building"
# `npm ci` needs the dev dependencies to build, so no --omit=dev here.
npm ci
npm run build

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/deploy/kiosk.sh"

say "Installing services"
install -m 0644 "$INSTALL_DIR/deploy/wall-dashboard.service" /etc/systemd/system/
install -m 0644 "$INSTALL_DIR/deploy/wall-kiosk.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wall-dashboard.service

say "Waiting for the server"
for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://localhost:3000/api/health; then
        echo "server is up"
        break
    fi
    sleep 1
done
curl -sf -o /dev/null http://localhost:3000/api/health \
    || die "server did not come up — check: journalctl -u wall-dashboard -n 50"

systemctl enable --now wall-kiosk.service

cat <<EOF

Done. Two things are deliberately left for you:

  1. TV power scheduling. Edit deploy/tv-power.crontab with the television's
     reserved IP, then:  crontab -u ${SERVICE_USER} ${INSTALL_DIR}/deploy/tv-power.crontab

  2. BIOS: set AC Recovery to "Power On" so the machine comes back by itself
     after an outage. Without it the wall stays dark until someone presses the
     button, which is the one failure nobody notices remotely.

  systemctl status wall-dashboard wall-kiosk
  journalctl -u wall-dashboard -f
EOF
