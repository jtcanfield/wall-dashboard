#!/bin/sh
#
# Puts the dashboard back on screen if it isn't.
#
# This exists because the dashboard shares a session with a usable desktop. If
# you close the browser to do something else and forget, the wall shows the
# XFCE desktop until the next reboot — the one weakness of running both in one
# session. Run from cron at 06:00, just before the TV comes on, so the display
# is correct whenever anyone is actually looking at it.
#
# Safe to run when the dashboard is already up: it does nothing.
set -u

DISPLAY="${DISPLAY:-:0}"
export DISPLAY

# DISPLAY alone is not enough, and the gap is silent. The sound server
# lives in the user runtime directory, so a Chromium started from cron
# without XDG_RUNTIME_DIR shows video perfectly and plays no audio at
# all — which looks like a broken driver rather than a missing variable.
: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    export DBUS_SESSION_BUS_ADDRESS
fi

KIOSK="$(dirname "$(readlink -f "$0")")/kiosk.sh"

# Match the class kiosk.sh sets, not "chromium" — the point is to detect *this*
# window, and matching the binary would also match a browser opened by hand.
if pgrep -f -- "--class=WallDashboard" >/dev/null 2>&1; then
    exit 0
fi

# No X session to draw into yet. Nothing useful to do, and no point logging a
# failure every morning if the machine happens to be at a console.
if ! xset q >/dev/null 2>&1; then
    echo "no X session on $DISPLAY — not starting the dashboard" >&2
    exit 0
fi

exec "$KIOSK"
