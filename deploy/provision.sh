#!/usr/bin/env bash
#
# One-time setup. Turns a fresh Debian 13 (trixie) install into the wall
# display: XFCE on autologin, the dashboard fullscreen inside that session, and
# the server as a system service.
#
#     sudo bash deploy/provision.sh
#
# **This is not the update path.** Use deploy/update.sh to ship dashboard
# changes — it touches only the app and never reinstalls a package or
# reconfigures the desktop. Re-running this script is safe (apt is a no-op when
# everything is already installed) but it is a slow way to deploy a commit.
#
# It does not touch .env — that is yours to write, and the script stops and
# tells you if it is missing.
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
# xfce4 brings the session, panel, window manager, Thunar and the settings
# GUI. Recommends are left on deliberately: this is meant to be a desktop
# somebody actually uses, and --no-install-recommends here produces one that is
# missing notifications and thumbnails.
#
# fonts-noto-core + fonts-noto-cjk: minimal Debian images have no Cyrillic
#   coverage, and the Russian headlines render as tofu boxes without it.
# unclutter: hides the pointer after a few idle seconds.
apt-get install -y \
    ca-certificates curl git gnupg \
    xserver-xorg xinit x11-xserver-utils \
    xfce4 xfce4-terminal \
    lightdm \
    chromium \
    unclutter \
    fonts-noto-core fonts-noto-cjk \
    cron

say "Removing everything that blanks or locks a screen"
# This is the load-bearing step of running the dashboard inside a desktop
# session, and the reason it is a purge rather than a pile of xfconf keys.
#
# Each of these has a legitimate job on a laptop and none at all on a
# mains-powered panel on a wall: they exist to turn the screen off or demand a
# password, and this machine has no password to demand. Configuring them off
# means four settings staying correct across upgrades; removing them means the
# code that blanks the screen is not installed.
#
# The xset calls in kiosk.sh are the second line of defence, not the first —
# a power manager starting after them would simply overrule them.
apt-get purge -y \
    xfce4-screensaver light-locker xscreensaver xfce4-power-manager \
    2>/dev/null || true
apt-get autoremove -y

say "Installing Node ${NODE_MAJOR} from NodeSource"
# Debian 13 ships Node 20.19; this repo's engines field requires >= 22.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
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
usermod -aG video,input,tty "$SERVICE_USER"
# Some LightDM PAM configurations gate passwordless login on membership of one
# of these. Creating them is harmless where they are unused.
groupadd -f autologin
groupadd -f nopasswdlogin
usermod -aG autologin,nopasswdlogin "$SERVICE_USER"

say "Configuring autologin"
install -d -m 0755 /etc/lightdm/lightdm.conf.d
install -m 0644 "$REPO_DIR/deploy/lightdm-autologin.conf" \
    /etc/lightdm/lightdm.conf.d/50-wall-autologin.conf
systemctl enable lightdm.service

say "Installing the app to ${INSTALL_DIR}"
if [ "$REPO_DIR" != "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    cp -a "$REPO_DIR/." "$INSTALL_DIR/"
    echo "NOTE: copied from $REPO_DIR. deploy/update.sh needs $INSTALL_DIR to be"
    echo "      a git clone — clone it there instead if you want one-command updates."
fi
cd "$INSTALL_DIR"

[ -f "$INSTALL_DIR/.env" ] || die \
    "no .env at $INSTALL_DIR — copy .env.example to .env and fill in the credentials, then re-run"

say "Building"
# npm ci needs the dev dependencies to build, so no --omit=dev here.
npm ci
npm run build

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/deploy/kiosk.sh" "$INSTALL_DIR/deploy/ensure-kiosk.sh"

say "Installing the server service"
install -m 0644 "$INSTALL_DIR/deploy/wall-dashboard.service" /etc/systemd/system/
# Supersedes an earlier design where the kiosk owned its own X server on tty1.
# XFCE's session owns the display now, so that unit would fight it for tty1.
if [ -f /etc/systemd/system/wall-kiosk.service ]; then
    systemctl disable --now wall-kiosk.service || true
    rm -f /etc/systemd/system/wall-kiosk.service
    echo "removed the superseded wall-kiosk.service"
fi
systemctl daemon-reload
systemctl enable --now wall-dashboard.service

say "Autostarting the dashboard in the desktop session"
AUTOSTART_DIR="/home/${SERVICE_USER}/.config/autostart"
install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$AUTOSTART_DIR"
install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" \
    "$INSTALL_DIR/deploy/wall-dashboard.desktop" "$AUTOSTART_DIR/"

# Don't restore last session's windows. Otherwise a reboot can reopen whatever
# happened to be on screen when it went down, on top of the dashboard.
runuser -u "$SERVICE_USER" -- \
    xfconf-query -c xfce4-session -p /general/SaveOnExit -n -t bool -s false \
    2>/dev/null || true

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

cat <<EOF

Done. Reboot to land in the XFCE session with the dashboard fullscreen.

Still left for you, deliberately:

  1. TV power scheduling. Put the television's reserved IP in
     deploy/tv-power.crontab, then:
       sudo crontab -u ${SERVICE_USER} ${INSTALL_DIR}/deploy/tv-power.crontab

  2. BIOS: AC Recovery = "Power On", so the machine comes back by itself after
     an outage. Without it the wall stays dark until someone presses the button.

To ship dashboard changes from here on, this script is NOT the tool:

  sudo bash ${INSTALL_DIR}/deploy/update.sh

  systemctl status wall-dashboard
  journalctl -u wall-dashboard -f
EOF
