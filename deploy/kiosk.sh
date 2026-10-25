#!/bin/sh
#
# Launches the dashboard browser inside the XFCE session.
#
# Autostarted from ~/.config/autostart/wall-dashboard.desktop, so this runs as
# part of the logged-in desktop rather than owning its own X server. That is a
# deliberate choice: the machine is a wall display most of the time and an
# ordinary computer occasionally, and one session means alt-tab gets you from
# one to the other with nothing to remember.
#
# The cost of that choice is that everything which blanks a screen now lives in
# the same session as the wall. provision.sh purges those packages; the xset
# calls below are the second line of defence.
set -u

DASHBOARD_URL="http://localhost:3000"

# A distinguishing class, so ensure-kiosk.sh can tell whether the dashboard is
# actually on screen without matching every chromium process on the box.
WM_CLASS="WallDashboard"

# Never blank, never sleep. Power is the TV's job, over the LAN via Roku ECP —
# see deploy/tv-power.crontab. DPMS is left enabled but with every timeout at
# zero, which means "on, and never triggers on its own".
xset s off
xset s noblank
xset +dpms
xset dpms 0 0 0

# -idle 3, not -idle 0. Zero hides the pointer the instant it stops moving,
# which is right for a pure kiosk and makes a desktop unusable — you cannot
# find the cursor to click anything. Three seconds keeps the wall clean and
# gives the pointer back as soon as you touch the mouse.
pgrep -u "$(id -u)" -x unclutter >/dev/null 2>&1 || unclutter -idle 3 &

# Chromium paints an error page if it beats the server to the port, and on a
# wall display there is nobody to press reload. Waiting costs a second at boot
# and removes a failure that would otherwise need a keyboard to clear.
until curl -sf -o /dev/null "$DASHBOARD_URL/api/health"; do
    sleep 1
done

# --autoplay-policy is not optional once the Twitch player is on screen:
# Chromium blocks autoplay without a user gesture even when the video is muted,
# and on a wall display there is never going to be a gesture. The failure is
# silent — a black player box and nothing in the console.
#
# --incognito keeps a crash from producing a "restore pages?" bubble across the
# whole display, which is the sort of thing nobody notices for a week.
while true; do
    chromium \
        --kiosk \
        --class="$WM_CLASS" \
        --noerrdialogs \
        --disable-infobars \
        --incognito \
        --autoplay-policy=no-user-gesture-required \
        --disable-session-crashed-bubble \
        --disable-features=TranslateUI \
        --check-for-update-interval=31536000 \
        "$DASHBOARD_URL"
    code=$?

    # Exit 0 means a person closed it on purpose — probably to use the desktop.
    # Relaunching over them would be obnoxious, so stop. Anything else is a
    # crash or a kill, and the wall should come back by itself. The 06:00 cron
    # entry puts it back on screen either way, so a deliberate close is never
    # permanent.
    if [ "$code" -eq 0 ]; then
        break
    fi
    sleep 3
done
