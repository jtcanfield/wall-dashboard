#!/usr/bin/env bash
#
# Repairs a first boot that lands on "Unable to load a failsafe session"
# instead of XFCE.
#
#     sudo bash /opt/wall-dashboard/deploy/repair-desktop.sh
#
# Safe from a root shell (sudo su) as well as via sudo, and safe to run more
# than once. It reports what it found before changing anything, so the output
# is worth keeping even when it fixes the problem.
#
# Deliberately not `set -e`: every check should run and be reported even if an
# earlier one fails. A repair tool that stops at the first problem tells you
# about one thing when you wanted to know about all of them.
set -uo pipefail

SERVICE_USER="${DASHBOARD_USER:-kiosk}"
INSTALL_DIR=/opt/wall-dashboard
AUTOLOGIN_CONF=/etc/lightdm/lightdm.conf.d/50-wall-autologin.conf
STAMP="$(date +%Y%m%d-%H%M%S)"

BOLD=$'\033[1m'; CYAN=$'\033[1;36m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'

say()   { printf '\n%s==> %s%s\n' "$CYAN" "$1" "$OFF"; }
ok()    { printf '  %sok%s    %s\n' "$GREEN" "$OFF" "$1"; }
fixed() { printf '  %sfixed%s %s\n' "$YELLOW" "$OFF" "$1"; }
warn()  { printf '  %swarn%s  %s\n' "$YELLOW" "$OFF" "$1"; }
bad()   { printf '  %sFAIL%s  %s\n' "$RED" "$OFF" "$1"; }
die()   { printf '\n%sERROR: %s%s\n' "$RED" "$1" "$OFF" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo bash deploy/repair-desktop.sh)"
id -u "$SERVICE_USER" >/dev/null 2>&1 || die "no such user: $SERVICE_USER"

# Never $HOME. This script is expected to run from a root shell, where $HOME is
# /root — which is precisely the mistake being repaired.
USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
[ -n "$USER_HOME" ] || die "cannot determine a home directory for $SERVICE_USER"

printf '%sRepairing the desktop session for %s (%s)%s\n' "$BOLD" "$SERVICE_USER" "$USER_HOME" "$OFF"

# --------------------------------------------------------------- 1. ownership

say "Home directory ownership"
# The most likely cause. `install -d` on a nested path cannot be relied on to
# apply -o/-g to the parents it creates, so ~/.config could belong to root even
# though ~/.config/autostart belongs to the user. xfconfd then cannot write its
# settings, and xfce4-session fails in exactly the way this script is named for.
#
# Running the provisioning from a root shell makes stray root-owned files in the
# home directory more likely still.
STRAY="$(find "$USER_HOME" ! -user "$SERVICE_USER" -print 2>/dev/null | head -20)"
if [ -n "$STRAY" ]; then
    bad "files in $USER_HOME not owned by $SERVICE_USER:"
    printf '        %s\n' $STRAY
    chown -R "$SERVICE_USER:$SERVICE_USER" "$USER_HOME" \
        && fixed "chowned $USER_HOME recursively"
else
    ok "everything in $USER_HOME belongs to $SERVICE_USER"
fi

# ----------------------------------------------------------- 2. the xfce tree

say "XFCE per-user configuration"
if [ -d "$USER_HOME/.config/xfce4" ]; then
    # Nothing here is worth keeping on a machine that has never had a working
    # session, and a half-made tree is its own failure mode. Moved rather than
    # deleted, because a repair script should not destroy evidence.
    mv "$USER_HOME/.config/xfce4" "$USER_HOME/.config/xfce4.broken-$STAMP" \
        && fixed "moved aside to .config/xfce4.broken-$STAMP (XFCE rebuilds from /etc/xdg)"
else
    ok "no stale per-user XFCE config"
fi
install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$USER_HOME/.config"
chown -R "$SERVICE_USER:$SERVICE_USER" "$USER_HOME/.config"

# A root-owned dbus cookie directory breaks the session bus for the user.
for d in "$USER_HOME/.dbus" "$USER_HOME/.cache" "$USER_HOME/.local"; do
    [ -e "$d" ] && chown -R "$SERVICE_USER:$SERVICE_USER" "$d"
done
ok "config, cache and dbus directories belong to $SERVICE_USER"

# ------------------------------------------------------------- 3. apt sanity

say "APT preferences"
# A malformed file in preferences.d makes every apt operation fail, which would
# have aborted provisioning partway and left a half-installed desktop.
if apt-cache policy xfce4-session >/dev/null 2>&1; then
    ok "apt can read its preferences"
else
    bad "apt is unhappy — check /etc/apt/preferences.d/"
    apt-cache policy xfce4-session 2>&1 | head -5 | sed 's/^/        /'
fi

# ---------------------------------------------------------------- 4. packages

say "Required packages"
REQUIRED="xfce4 xfce4-session xfce4-settings xfconf xfwm4 xfce4-panel xfdesktop4 thunar dbus-x11 lightdm xfce4-terminal"
MISSING=""
for pkg in $REQUIRED; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    bad "missing:$MISSING"
    apt-get update -qq
    # shellcheck disable=SC2086
    if apt-get install -y $MISSING; then
        fixed "installed:$MISSING"
    else
        bad "install failed — read the apt output above before going further"
    fi
else
    ok "all present"
fi

# ----------------------------------------------------------- 5. session name

say "Session registration"
if [ -d /usr/share/xsessions ]; then
    printf '        available: %s\n' "$(ls /usr/share/xsessions/ 2>/dev/null | tr '\n' ' ')"
fi

# LightDM falls back to a failsafe session when autologin-session names
# something that is not installed — and the failsafe path is what produces the
# dialog. So the configured name has to match a real file, not just look right.
SESSION=""
for cand in /usr/share/xsessions/xfce.desktop /usr/share/xsessions/xfce4.desktop; do
    if [ -f "$cand" ]; then
        SESSION="$(basename "$cand" .desktop)"
        break
    fi
done
if [ -z "$SESSION" ]; then
    SESSION="$(basename "$(ls /usr/share/xsessions/*.desktop 2>/dev/null | head -1)" .desktop 2>/dev/null)"
fi

if [ -z "$SESSION" ]; then
    bad "no session files at all in /usr/share/xsessions — xfce4-session is not properly installed"
else
    ok "using session '$SESSION'"
    if [ -f "$AUTOLOGIN_CONF" ]; then
        CURRENT="$(sed -n 's/^autologin-session=//p' "$AUTOLOGIN_CONF" | head -1)"
        if [ "$CURRENT" != "$SESSION" ]; then
            sed -i "s|^autologin-session=.*|autologin-session=${SESSION}|" "$AUTOLOGIN_CONF"
            fixed "autologin-session was '${CURRENT:-unset}', now '$SESSION'"
        else
            ok "autologin-session already matches"
        fi
        CURUSER="$(sed -n 's/^autologin-user=//p' "$AUTOLOGIN_CONF" | head -1)"
        if [ "$CURUSER" != "$SERVICE_USER" ]; then
            sed -i "s|^autologin-user=.*|autologin-user=${SERVICE_USER}|" "$AUTOLOGIN_CONF"
            fixed "autologin-user was '${CURUSER:-unset}', now '$SERVICE_USER'"
        else
            ok "autologin-user already '$SERVICE_USER'"
        fi
    else
        bad "$AUTOLOGIN_CONF is missing — provisioning did not get that far"
    fi
fi

# ------------------------------------------------------------- 6. the autostart

say "Dashboard autostart"
AUTOSTART="$USER_HOME/.config/autostart/wall-dashboard.desktop"
if [ -f "$INSTALL_DIR/deploy/wall-dashboard.desktop" ]; then
    install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$USER_HOME/.config/autostart"
    install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" \
        "$INSTALL_DIR/deploy/wall-dashboard.desktop" "$AUTOSTART"
    chmod +x "$INSTALL_DIR/deploy/kiosk.sh" "$INSTALL_DIR/deploy/ensure-kiosk.sh" 2>/dev/null
    ok "autostart entry in place"
else
    warn "$INSTALL_DIR/deploy/wall-dashboard.desktop not found — skipping"
fi

# ------------------------------------------------------- 7. the app directory

say "Application directory"
# Provisioning run from a root shell leaves node_modules and dist owned by root,
# which breaks the next update and the server's own writes to data/.
if [ -d "$INSTALL_DIR" ]; then
    if find "$INSTALL_DIR" ! -user "$SERVICE_USER" -print -quit 2>/dev/null | grep -q .; then
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" \
            && fixed "chowned $INSTALL_DIR recursively"
    else
        ok "$INSTALL_DIR belongs to $SERVICE_USER"
    fi
    [ -f "$INSTALL_DIR/.env" ] && ok ".env present" || bad ".env is missing — the panels will come up empty"
else
    bad "$INSTALL_DIR does not exist"
fi

# --------------------------------------------------------------- 8. services

say "Services"
if [ -f /etc/systemd/system/wall-dashboard.service ]; then
    UNITUSER="$(sed -n 's/^User=//p' /etc/systemd/system/wall-dashboard.service | head -1)"
    if [ "$UNITUSER" != "$SERVICE_USER" ]; then
        sed -i "s|^User=.*|User=${SERVICE_USER}|;s|^Group=.*|Group=${SERVICE_USER}|" \
            /etc/systemd/system/wall-dashboard.service
        systemctl daemon-reload
        fixed "unit ran as '${UNITUSER:-unset}', now '$SERVICE_USER'"
    else
        ok "unit runs as $SERVICE_USER"
    fi
    systemctl restart wall-dashboard.service 2>/dev/null
    sleep 2
    if curl -sf -o /dev/null http://localhost:3000/api/health; then
        ok "server answering on :3000"
    else
        bad "server not answering — journalctl -u wall-dashboard -n 40"
    fi
else
    warn "wall-dashboard.service not installed yet"
fi

systemctl is-enabled lightdm >/dev/null 2>&1 && ok "lightdm enabled" || {
    systemctl enable lightdm >/dev/null 2>&1 && fixed "enabled lightdm"; }

# ----------------------------------------------------------------- 9. restart

cat <<EOF

${BOLD}Done.${OFF} Restart the display manager to try the session again:

    systemctl restart lightdm

If it still fails, the useful evidence is:

    cat ${USER_HOME}/.xsession-errors
    journalctl -b -u lightdm --no-pager | tail -40

EOF
